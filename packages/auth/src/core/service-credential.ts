import { randomBytes } from 'node:crypto';
import { AUTH_SERVICE_DOMAIN, DOMAIN_NAME_PATTERN } from '@tecton/manifest';
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

/** Field of the registration request an InvalidServiceRegistrationError is about. */
export type ServiceRegistrationField = 'domain' | 'dependencies' | 'permissions';

/** A registration with an invalid domain, dependency or permission. The message says which. */
export class InvalidServiceRegistrationError extends Error {
  override readonly name = 'InvalidServiceRegistrationError';
  constructor(
    message: string,
    readonly field: ServiceRegistrationField,
  ) {
    super(message);
  }
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
  /**
   * Re-hashes the secret (Pepper rotation), only while the stored hash is still `expectedHash`;
   * resolves false otherwise. Never changes `updatedAt`, which dates the secret.
   */
  updateSecretHash(domain: string, newHash: string, expectedHash: string): Promise<boolean>;
  close(): Promise<void>;
}

/** The subject of every token of a service. */
export const serviceSubject = (domain: string) => `service:${domain}`;

/** Permission a service token carries for each domain it may call (checked by the callee, Story 2.7b). */
export const callPermission = (domain: string) => `call:${domain}`;

/** Bytes of a service secret: 256 random bits, shown once at registration. */
export const SERVICE_SECRET_BYTES = 32;

/**
 * A rotation revokes the tokens of the service issued until `updatedAt` plus this margin, so a
 * token signed with the old secret while the rotation is written is revoked too. Tokens of the new
 * secret are dated after it (`issuedAfter`), so they are never born revoked: token instants have
 * second precision, the revocation instant has millisecond precision.
 */
export const ROTATION_REVOCATION_MARGIN_MS = 1_000;

/**
 * How far ahead of the clock a rotation may date the tokens of the new secret. Rotations in a
 * burst push that instant forward; past this, the verifiers (30-s tolerance for a future `iat`)
 * would refuse the new tokens, so the rotation is refused instead (try again a few seconds later).
 */
export const MAX_ROTATION_LEAD_MS = 10_000;

/** Too many rotations in a burst: `retryAfterSeconds` until the next one is accepted. */
export class RotationTooSoonError extends Error {
  override readonly name = 'RotationTooSoonError';
  constructor(readonly retryAfterSeconds: number) {
    super(`the credential was rotated too recently; try again in ${retryAfterSeconds} s`);
  }
}

/** The instant every token of `credential` must be issued after (see ROTATION_REVOCATION_MARGIN_MS). */
export const tokensIssuedAfter = (credential: Pick<ServiceCredential, 'updatedAt'>) =>
  new Date(credential.updatedAt.getTime() + ROTATION_REVOCATION_MARGIN_MS);

/** The earliest `iat` (in ms) a token of `credential` can carry: the second after tokensIssuedAfter. */
const earliestTokenInstant = (credential: Pick<ServiceCredential, 'updatedAt'>) =>
  (Math.floor(tokensIssuedAfter(credential).getTime() / 1000) + 1) * 1000;

const DOMAIN_NAME = new RegExp(DOMAIN_NAME_PATTERN);
/** Ready-made services that are not domains and never get a service credential. */
const RESERVED_SERVICES: readonly string[] = [AUTH_SERVICE_DOMAIN];

function assertDomain(name: string, value: string, field: ServiceRegistrationField): void {
  if (!DOMAIN_NAME.test(value)) throw new InvalidServiceRegistrationError(`${name} "${value}" is not a valid domain name (kebab-case)`, field);
}

/** Validates and normalizes a registration request; the lists come de-duplicated and sorted. */
export function validatedRegistration(request: { domain: string; dependencies: readonly string[]; permissions: readonly string[] }) {
  assertDomain('domain', request.domain, 'domain');
  if (RESERVED_SERVICES.includes(request.domain)) throw new InvalidServiceRegistrationError(`"${request.domain}" is a ready-made service, not a domain`, 'domain');
  const callees = [...new Set(request.dependencies)].sort();
  for (const callee of callees) {
    assertDomain('dependency', callee, 'dependencies');
    if (callee === request.domain) throw new InvalidServiceRegistrationError('a service cannot depend on itself', 'dependencies');
  }
  const permissions = [...new Set(request.permissions)].sort();
  try {
    assertValidPermissions(permissions);
  } catch (error) {
    if (error instanceof InvalidCredentialError) throw new InvalidServiceRegistrationError(error.message, 'permissions');
    throw error;
  }
  // call:<domain> comes only from the dependencies, never granted by hand.
  const handmade = permissions.find((permission) => permission.startsWith('call:'));
  if (handmade) throw new InvalidServiceRegistrationError(`"${handmade}" is derived from the manifest dependencies and cannot be granted`, 'permissions');
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
  // The revocation instant covers every token of the old secret: those it signs while the
  // replacement is written (now plus the margin) and, after a recent registration or rotation,
  // those dated ahead of the clock (earliestTokenInstant). The new secret dates its tokens after
  // that instant, so its updatedAt may be a second or two ahead of the clock.
  const previous = await services.findByDomain(domain).catch((error: unknown) => {
    if (error instanceof InvalidCredentialError) return undefined;
    throw error;
  });
  const revokedAt = Math.max(now.getTime() + ROTATION_REVOCATION_MARGIN_MS, previous ? earliestTokenInstant(previous) : 0);
  const lead = revokedAt - now.getTime();
  if (lead > MAX_ROTATION_LEAD_MS) throw new RotationTooSoonError(Math.ceil((lead - MAX_ROTATION_LEAD_MS) / 1000));
  credential.updatedAt = new Date(revokedAt - ROTATION_REVOCATION_MARGIN_MS);
  // Revoked first: if the revocation store is down, the rotation fails with nothing changed, never
  // with the new secret written and lost.
  await revocations.revokeSubject({ subject: serviceSubject(domain), at: new Date(revokedAt) });
  // The old secret stops working at once.
  if (await services.replace(credential)) return { domain, secret, rotated: true };
  try {
    await services.register(credential);
    return { domain, secret, rotated: false };
  } catch (error) {
    // Registered by a concurrent request in between: still a rotation, not a conflict.
    if (!(error instanceof ServiceAlreadyRegisteredError) || !(await services.replace(credential))) throw error;
    return { domain, secret, rotated: true };
  }
}

/** Port for signing service tokens (AD-7): same key, issuer and audience as user tokens. */
export interface ServiceTokenIssuer {
  /** `issuedAfter`: the token's `iat` is strictly after this instant (see tokensIssuedAfter). */
  issue(service: { domain: string; permissions: readonly string[]; issuedAfter: Date }): Promise<IssuedAccessToken>;
}

export interface IssueServiceTokenDependencies {
  services: ServiceCredentialStore;
  auth: AuthProvider;
  tokens: ServiceTokenIssuer;
  /** A hash made at startup, verified when the service does not exist (same Argon2id cost). */
  dummyHash: string;
  onCorruptCredential?: (error: InvalidCredentialError) => void;
  /** The re-hash after a Pepper rotation failed; the token is issued anyway. */
  onRehashFailure?: (error: unknown) => void;
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
  // Read again after the slow verification: a rotation in between makes this secret the old one,
  // and a token signed now could outlive the rotation's revocation.
  const current = await services.findByDomain(credential.domain).catch((error: unknown) => {
    if (!(error instanceof InvalidCredentialError)) throw error;
    dependencies.onCorruptCredential?.(error);
    return undefined;
  });
  if (!current || current.secretHash !== credential.secretHash || current.status !== 'active') throw new InvalidServiceCredentialsError();
  if (verification.needsRehash) {
    try {
      await services.updateSecretHash(current.domain, await auth.hashPassword(request.secret), current.secretHash);
    } catch (error) {
      dependencies.onRehashFailure?.(error);
    }
  }
  return tokens.issue({
    domain: current.domain,
    permissions: [...current.permissions, ...current.callees.map(callPermission)],
    issuedAfter: tokensIssuedAfter(current),
  });
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
