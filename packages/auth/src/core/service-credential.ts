import { randomBytes } from 'node:crypto';
import { DOMAIN_NAME_PATTERN } from '@tecton/manifest';
import type { AuthProvider, Clock, TokenRevocationStore } from '@tecton/providers';
import { v7 as uuidv7 } from 'uuid';
import type { IssuedAccessToken } from './access-token.js';
import { assertValidPermissions, InvalidCredentialError } from './credential.js';

// Service credentials (Story 2.7a, FR-13, D3): client credentials of a domain service, exchanged
// for short-lived service tokens. Only the Auth service holds them (AD-9).

export type ServiceCredentialStatus = 'active' | 'revoked';

export interface ServiceCredential {
  id: string;
  /** Domain of the service (kebab-case, as in its manifest). */
  domain: string;
  /** PHC string of the AuthProvider; never the secret. */
  secretHash: string;
  /** Permissions granted by the administrator at registration. */
  permissions: string[];
  /** Domains of the manifest `dependencies`: the service token carries call:<domain> for each. */
  callees: string[];
  status: ServiceCredentialStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** The domain already has a credential; registering it again needs an explicit rotation. */
export class ServiceAlreadyRegisteredError extends Error {
  override readonly name = 'ServiceAlreadyRegisteredError';
  constructor(readonly domain: string) {
    super(`service "${domain}" already has a credential; use rotation to replace it`);
  }
}

/** A registration with an invalid domain, dependency or permission. The message says which. */
export class InvalidServiceRegistrationError extends Error {
  override readonly name = 'InvalidServiceRegistrationError';
}

/** Service token refused. One error for every reason (unknown service, wrong secret, revoked). */
export class InvalidServiceCredentialsError extends Error {
  override readonly name = 'InvalidServiceCredentialsError';
  constructor() {
    super('invalid service credentials');
  }
}

/** Port for the service credentials in the Auth database (AD-1): the core never imports Prisma. */
export interface ServiceCredentialStore {
  /** Throws InvalidCredentialError on a corrupt row. */
  findByDomain(domain: string): Promise<ServiceCredential | undefined>;
  /** Throws ServiceAlreadyRegisteredError when the domain already has a credential. */
  register(credential: ServiceCredential): Promise<void>;
  /** Replaces the credential of `credential.domain` atomically; resolves false when there was none. */
  replace(credential: ServiceCredential): Promise<boolean>;
  close(): Promise<void>;
}

/** The subject of every token of a service. */
export const serviceSubject = (domain: string) => `service:${domain}`;

/** Permission a service token carries for each domain it may call (checked by the callee, Story 2.7b). */
export const callPermission = (domain: string) => `call:${domain}`;

/** Bytes of a service secret: 256 random bits, shown once at registration. */
export const SERVICE_SECRET_BYTES = 32;

const DOMAIN_NAME = new RegExp(DOMAIN_NAME_PATTERN);
/** Ready-made services that are not domains and never get a service credential. */
const RESERVED_SERVICES: readonly string[] = ['auth'];

function assertDomain(name: string, value: string): void {
  if (!DOMAIN_NAME.test(value)) throw new InvalidServiceRegistrationError(`${name} "${value}" is not a valid domain name (kebab-case)`);
}

/** Validates and normalizes a registration request; the lists come de-duplicated and sorted. */
export function validatedRegistration(request: { domain: string; dependencies: readonly string[]; permissions: readonly string[] }) {
  assertDomain('domain', request.domain);
  if (RESERVED_SERVICES.includes(request.domain)) throw new InvalidServiceRegistrationError(`"${request.domain}" is a ready-made service, not a domain`);
  const callees = [...new Set(request.dependencies)].sort();
  for (const callee of callees) {
    assertDomain('dependency', callee);
    if (callee === request.domain) throw new InvalidServiceRegistrationError('a service cannot depend on itself');
  }
  const permissions = [...new Set(request.permissions)].sort();
  try {
    assertValidPermissions(permissions);
  } catch (error) {
    if (error instanceof InvalidCredentialError) throw new InvalidServiceRegistrationError(error.message);
    throw error;
  }
  // call:<domain> comes only from the dependencies, never granted by hand.
  const handmade = permissions.find((permission) => permission.startsWith('call:'));
  if (handmade) throw new InvalidServiceRegistrationError(`"${handmade}" is derived from the manifest dependencies and cannot be granted`);
  return { domain: request.domain, callees, permissions };
}

export interface RegisterServiceDependencies {
  services: ServiceCredentialStore;
  auth: AuthProvider;
  revocations: TokenRevocationStore;
  clock: Clock;
}

export interface RegisterServiceRequest {
  domain: string;
  dependencies: readonly string[];
  permissions: readonly string[];
  /** Replace an existing credential, revoking every token issued with the old one. */
  rotate: boolean;
}

/**
 * Registers (or, with `rotate`, replaces) the credential of a service. Returns the secret in clear
 * text: the only time it exists outside the caller (AC 1). On rotation, every token issued to the
 * service until now is revoked (AC 3).
 */
export async function registerService(
  dependencies: RegisterServiceDependencies,
  request: RegisterServiceRequest,
): Promise<{ domain: string; secret: string; rotated: boolean }> {
  const { services, auth, revocations, clock } = dependencies;
  const { domain, callees, permissions } = validatedRegistration(request);
  const secret = randomBytes(SERVICE_SECRET_BYTES).toString('base64url');
  const now = clock.now();
  const credential: ServiceCredential = {
    id: uuidv7(),
    domain,
    secretHash: await auth.hashPassword(secret),
    permissions,
    callees,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  if (!request.rotate) {
    await services.register(credential);
    return { domain, secret, rotated: false };
  }
  // The old secret stops working at once; tokens already issued with it are revoked too.
  const replaced = await services.replace(credential);
  if (!replaced) await services.register(credential);
  await revocations.revokeSubject({ subject: serviceSubject(domain), at: now });
  return { domain, secret, rotated: replaced };
}

/** Port for signing service tokens (AD-7): same key, issuer and audience as user tokens. */
export interface ServiceTokenIssuer {
  issue(service: { domain: string; permissions: readonly string[] }): Promise<IssuedAccessToken>;
}

export interface IssueServiceTokenDependencies {
  services: ServiceCredentialStore;
  auth: AuthProvider;
  tokens: ServiceTokenIssuer;
  /** A hash made at startup, verified when the service does not exist (same Argon2id cost). */
  dummyHash: string;
  onCorruptCredential?: (error: InvalidCredentialError) => void;
}

/** Exchanges a service credential for a short-lived service token (AC 4 to 7). Never a refresh. */
export async function issueServiceToken(
  dependencies: IssueServiceTokenDependencies,
  request: { serviceId: string; secret: string },
): Promise<IssuedAccessToken> {
  const { services, auth, tokens, dummyHash } = dependencies;
  let credential: ServiceCredential | undefined;
  if (DOMAIN_NAME.test(request.serviceId)) {
    try {
      credential = await services.findByDomain(request.serviceId);
    } catch (error) {
      if (!(error instanceof InvalidCredentialError)) throw error;
      dependencies.onCorruptCredential?.(error);
      credential = undefined;
    }
  }
  // Always exactly one Argon2id verification, whatever the outcome (no enumeration).
  const verification = await auth.verifyPassword(request.secret, credential?.secretHash ?? dummyHash);
  if (!credential || !verification.valid || credential.status !== 'active') throw new InvalidServiceCredentialsError();
  return tokens.issue({ domain: credential.domain, permissions: [...credential.permissions, ...credential.callees.map(callPermission)] });
}

/** Fail closed on a service credential that breaks the model (a row edited by hand). */
export function assertValidServiceCredential(credential: ServiceCredential): void {
  if (credential.status !== 'active' && credential.status !== 'revoked') {
    throw new InvalidCredentialError(`invalid service credential status ${JSON.stringify(credential.status)}`);
  }
  if (!DOMAIN_NAME.test(credential.domain)) throw new InvalidCredentialError('invalid service credential domain');
  if (!Array.isArray(credential.permissions) || !Array.isArray(credential.callees)) {
    throw new InvalidCredentialError('service credential permissions and callees must be lists');
  }
  assertValidPermissions(credential.permissions);
  for (const callee of credential.callees) {
    if (typeof callee !== 'string' || !DOMAIN_NAME.test(callee)) throw new InvalidCredentialError('invalid service credential callee');
  }
}
