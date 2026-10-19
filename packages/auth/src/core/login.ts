import type { AuthProvider, Clock } from '@tecton/providers';
import type { AccessTokenIssuer, IssuedAccessToken } from './access-token.js';
import { InvalidLoginError, normalizeLogin, type Credential } from './credential.js';
import type { CredentialStore } from './credential-store.js';

/**
 * Login refused. One error for every reason (unknown login, wrong password, disabled credential,
 * malformed login), so the response never reveals which logins exist.
 */
export class InvalidCredentialsError extends Error {
  override readonly name = 'InvalidCredentialsError';
  constructor() {
    super('invalid credentials');
  }
}

export interface LoginDependencies {
  store: CredentialStore;
  auth: AuthProvider;
  issuer: AccessTokenIssuer;
  clock: Clock;
  /**
   * A hash made at startup with the current AuthProvider, verified when the login does not exist,
   * so Argon2id costs the same whether the account exists or not.
   */
  dummyHash: string;
  /** Called when re-hashing a password after a successful login fails; the login still succeeds. */
  onRehashFailure?: (error: unknown) => void;
}

export interface LoginRequest {
  login: string;
  password: string;
}

function normalizedOrUndefined(login: string): string | undefined {
  try {
    return normalizeLogin(login);
  } catch (error) {
    if (error instanceof InvalidLoginError) return undefined;
    throw error;
  }
}

/** Authenticates by login and password and issues an access token (Story 2.2b). */
export async function login(dependencies: LoginDependencies, request: LoginRequest): Promise<IssuedAccessToken> {
  const { store, auth, issuer, clock, dummyHash } = dependencies;
  const normalized = normalizedOrUndefined(request.login);
  const credential: Credential | undefined = normalized === undefined ? undefined : await store.findByLogin(normalized);
  // Always exactly one Argon2id verification, whatever the outcome (Test Design P0-006).
  const verification = await auth.verifyPassword(request.password, credential?.passwordHash ?? dummyHash);
  if (!credential || !verification.valid || credential.status !== 'active') throw new InvalidCredentialsError();

  if (verification.needsRehash) {
    try {
      await store.updatePasswordHash(credential.id, await auth.hashPassword(request.password), clock.now());
    } catch (error) {
      dependencies.onRehashFailure?.(error);
    }
  }
  return issuer.issue(credential);
}
