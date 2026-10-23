import { LoginLockoutUnavailableError, type AuthProvider, type Clock, type LoginLockout } from '@tecton/providers';
import type { AccessTokenIssuer } from './access-token.js';
import { InvalidCredentialError, InvalidLoginError, normalizeLogin, type Credential } from './credential.js';
import type { CredentialStore } from './credential-store.js';
import type { RefreshTokenStore } from './refresh-token-store.js';
import { openSession, type SessionTokens } from './session.js';

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

/**
 * Login refused before any check: the identifier is locked after too many failures (Story 2.6).
 * The same for an existing and an unknown login.
 */
export class LoginLockedError extends Error {
  override readonly name = 'LoginLockedError';
  constructor(readonly retryAfterSeconds: number) {
    super('login temporarily locked');
  }
}

export interface LoginDependencies {
  store: CredentialStore;
  auth: AuthProvider;
  issuer: AccessTokenIssuer;
  clock: Clock;
  /** Where the login opens its refresh token family (Story 2.3). */
  refreshTokens: RefreshTokenStore;
  /** Fixed lifetime of the family opened by this login. */
  refreshTtlSeconds: number;
  /** Lockout by identifier (Story 2.6): counts failures, refuses a locked identifier. */
  lockout: LoginLockout;
  /** Called when a failure locks the identifier (security event). */
  onLocked?: (event: { identifier: string; lockSeconds: number }) => void;
  /** Called when clearing the failure count after a successful login fails; the login still succeeds. */
  onClearFailuresFailure?: (error: unknown) => void;
  /**
   * A hash made at startup with the current AuthProvider, verified when the login does not exist,
   * so Argon2id costs the same whether the account exists or not.
   */
  dummyHash: string;
  /** Called when re-hashing a password after a successful login fails; the login still succeeds. */
  onRehashFailure?: (error: unknown) => void;
  /** Called when a stored credential is corrupt; the login is refused like an unknown one. */
  onCorruptCredential?: (error: InvalidCredentialError) => void;
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

/**
 * Authenticates by login and password, issues an access token (Story 2.2b) and opens a refresh
 * token family (Story 2.3).
 */
export async function login(dependencies: LoginDependencies, request: LoginRequest): Promise<SessionTokens> {
  const { store, auth, issuer, clock, dummyHash, lockout } = dependencies;
  const normalized = normalizedOrUndefined(request.login);
  // A locked identifier is refused before anything else: no database lookup, no Argon2id (AC 2).
  // A malformed login has no identifier: not counted (the format rule is public).
  if (normalized !== undefined) {
    const state = await lockout.check(normalized);
    if (state.locked) throw new LoginLockedError(state.retryAfterSeconds);
  }
  let credential: Credential | undefined;
  try {
    credential = normalized === undefined ? undefined : await store.findByLogin(normalized);
  } catch (error) {
    // A corrupt row (bad status or permissions) answers like an unknown login: a fast 500 would
    // reveal that the login exists.
    if (!(error instanceof InvalidCredentialError)) throw error;
    dependencies.onCorruptCredential?.(error);
    credential = undefined;
  }
  // Always exactly one Argon2id verification, whatever the outcome (Test Design P0-006).
  const verification = await auth.verifyPassword(request.password, credential?.passwordHash ?? dummyHash);
  if (!credential || !verification.valid || credential.status !== 'active') {
    // Every refusal of a valid identifier counts, existing or not (AC 3).
    if (normalized !== undefined) {
      const failure = await lockout.recordFailure(normalized);
      if (failure.lockedNow) dependencies.onLocked?.({ identifier: normalized, lockSeconds: failure.lockSeconds });
    }
    throw new InvalidCredentialsError();
  }
  // Success clears the count of the identifier that was checked, never a lock set meanwhile. A
  // Valkey failure here must not refuse a verified password: the count just stays (AC 5).
  try {
    await lockout.clearFailures(normalized as string);
  } catch (error) {
    if (!(error instanceof LoginLockoutUnavailableError)) throw error;
    dependencies.onClearFailuresFailure?.(error);
  }

  if (verification.needsRehash) {
    try {
      await store.updatePasswordHash(credential.id, await auth.hashPassword(request.password), clock.now(), credential.passwordHash);
    } catch (error) {
      dependencies.onRehashFailure?.(error);
    }
  }
  const access = await issuer.issue(credential);
  return { access, refresh: await openSession(dependencies, credential) };
}
