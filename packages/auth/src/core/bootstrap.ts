import type { AuthProvider, Clock } from '@tecton/providers';
import { v7 as uuidv7 } from 'uuid';
import { assertValidPermissions, normalizeLogin, type Credential } from './credential.js';
import type { CredentialStore } from './credential-store.js';

/**
 * Permissions of the first administrator: registering services (Story 2.7) and creating
 * credentials (Story 4.3). The role model (EQ-1) is decided in Story 4.3.
 */
export const BOOTSTRAP_ADMIN_PERMISSIONS: readonly string[] = Object.freeze(['auth:service:register', 'auth:credential:create']);

export class AlreadyBootstrappedError extends Error {
  override readonly name = 'AlreadyBootstrappedError';
  constructor() {
    super('the Auth database already has credentials; nothing was changed');
  }
}

export interface BootstrapOptions {
  store: CredentialStore;
  auth: AuthProvider;
  clock: Clock;
  login: string;
  password: string;
}

/**
 * Creates the first administrator credential, only when the Auth database has none. Run
 * locally by an operator with direct database access; there is no HTTP endpoint for it (AD-7).
 * Two bootstraps racing is an accepted risk: it is a one-time operator command, and the unique
 * login still prevents a duplicate of the same login.
 */
export async function bootstrapAdmin({ store, auth, clock, login, password }: BootstrapOptions): Promise<Credential> {
  const normalized = normalizeLogin(login);
  if ((await store.count()) > 0) throw new AlreadyBootstrappedError();
  const permissions = [...BOOTSTRAP_ADMIN_PERMISSIONS];
  assertValidPermissions(permissions);
  const now = clock.now();
  const credential: Credential = {
    id: uuidv7(),
    login: normalized,
    passwordHash: await auth.hashPassword(password),
    status: 'active',
    permissions,
    createdAt: now,
    updatedAt: now,
  };
  await store.create(credential);
  return credential;
}
