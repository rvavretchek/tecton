import type { AuthProvider, Clock } from '@tecton/providers';
import { v7 as uuidv7 } from 'uuid';
import { assertValidCredential, normalizeLogin, type Credential } from './credential.js';
import type { CredentialStore } from './credential-store.js';

/**
 * Permissions of the first administrator: registering services (Story 2.7) and creating
 * credentials (Story 4.3). The role model (EQ-1) is decided in Story 4.3.
 */
export const BOOTSTRAP_ADMIN_PERMISSIONS: readonly string[] = Object.freeze(['auth:service:register', 'auth:credential:create']);

/** Minimum length of the first administrator's password, in characters (code points). */
export const MIN_ADMIN_PASSWORD_LENGTH = 12;

export class AlreadyBootstrappedError extends Error {
  override readonly name = 'AlreadyBootstrappedError';
  constructor() {
    super('the Auth database already has credentials; nothing was changed');
  }
}

/** The password does not meet the bootstrap policy. The message never contains it. */
export class PasswordPolicyError extends Error {
  override readonly name = 'PasswordPolicyError';
}

export interface BootstrapOptions {
  store: CredentialStore;
  auth: AuthProvider;
  clock: Clock;
  login: string;
  password: string;
}

function assertAdminPassword(password: string): void {
  if (typeof password !== 'string' || password.trim() === '') throw new PasswordPolicyError('the password must not be empty');
  if ([...password].length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`the administrator password must have at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
  }
}

/**
 * Creates the first administrator credential, only when the Auth database has none. Run
 * locally by an operator with direct database access; there is no HTTP endpoint for it (AD-7).
 * The final check and the insert happen in one serializable transaction, so two concurrent
 * bootstraps never both succeed.
 */
export async function bootstrapAdmin({ store, auth, clock, login, password }: BootstrapOptions): Promise<Credential> {
  const normalized = normalizeLogin(login);
  assertAdminPassword(password);
  // Fast path: refuse before spending an Argon2id hash.
  if ((await store.count()) > 0) throw new AlreadyBootstrappedError();
  const now = clock.now();
  const credential: Credential = {
    id: uuidv7(),
    login: normalized,
    passwordHash: await auth.hashPassword(password),
    status: 'active',
    permissions: [...BOOTSTRAP_ADMIN_PERMISSIONS],
    createdAt: now,
    updatedAt: now,
  };
  assertValidCredential(credential);
  if (!(await store.createIfEmpty(credential))) throw new AlreadyBootstrappedError();
  return credential;
}
