import type { Clock } from '@tecton/providers';
import { v7 as uuidv7 } from 'uuid';
import type { AccessTokenIssuer, IssuedAccessToken } from './access-token.js';
import { InvalidCredentialError, type Credential } from './credential.js';
import type { CredentialStore } from './credential-store.js';
import { generateRefreshToken, hashRefreshToken, isWellFormedRefreshToken } from './refresh-token.js';
import type { NewRefreshToken, RefreshTokenStore } from './refresh-token-store.js';

/** Default and limits of the refresh token family lifetime, in seconds (7 days; 1 hour to 90 days). */
export const REFRESH_TOKEN_TTL = { default: 604_800, min: 3_600, max: 7_776_000 } as const;

/** Throws a RangeError unless `ttlSeconds` is an integer within REFRESH_TOKEN_TTL. */
export function assertRefreshTokenTtl(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < REFRESH_TOKEN_TTL.min || ttlSeconds > REFRESH_TOKEN_TTL.max) {
    throw new RangeError(`refresh token lifetime must be an integer between ${REFRESH_TOKEN_TTL.min} and ${REFRESH_TOKEN_TTL.max} seconds`);
  }
}

/**
 * Refresh refused. One error for every reason (unknown, malformed, expired, revoked, reused,
 * inactive or corrupt credential), so the response never tells them apart.
 */
export class InvalidRefreshTokenError extends Error {
  override readonly name = 'InvalidRefreshTokenError';
  constructor() {
    super('invalid refresh token');
  }
}

/** The opaque refresh token for the cookie, never for a response body. */
export interface IssuedRefreshToken {
  refreshToken: string;
  /** When the family expires: the cookie must not outlive it. */
  expiresAt: Date;
}

export interface SessionTokens {
  access: IssuedAccessToken;
  refresh: IssuedRefreshToken;
}

/** A refresh token was presented again after use: its family is revoked (security event). */
export interface RefreshReuseEvent {
  familyId: string;
  subject: string;
}

export interface OpenSessionDependencies {
  refreshTokens: RefreshTokenStore;
  clock: Clock;
  refreshTtlSeconds: number;
}

export interface SessionDependencies extends OpenSessionDependencies {
  credentials: CredentialStore;
  issuer: AccessTokenIssuer;
  /** Called once for every reuse detected, including a replay into an already revoked family. */
  /** Awaited before the refresh is refused: the response never goes out before what it triggers. */
  onReuseDetected?: (event: RefreshReuseEvent) => void | Promise<void>;
  /** Called when the credential of a session is corrupt; the refresh is refused. */
  onCorruptCredential?: (error: InvalidCredentialError) => void;
}

function newToken(createdAt: Date): { token: string; stored: NewRefreshToken } {
  const token = generateRefreshToken();
  return { token, stored: { id: uuidv7(), tokenHash: hashRefreshToken(token), createdAt } };
}

/** Opens a refresh token family for a credential that has just logged in (Story 2.3). */
export async function openSession(dependencies: OpenSessionDependencies, credential: Credential): Promise<IssuedRefreshToken> {
  const { refreshTokens, clock, refreshTtlSeconds } = dependencies;
  assertRefreshTokenTtl(refreshTtlSeconds);
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + refreshTtlSeconds * 1000);
  const { token, stored } = newToken(now);
  await refreshTokens.openFamily({ id: uuidv7(), credentialId: credential.id, createdAt: now, expiresAt }, stored);
  return { refreshToken: token, expiresAt };
}

/**
 * Rotates a refresh token: the presented one becomes used and a new one is issued in the same
 * family, with a new access token whose permissions come from the credential as it is now.
 */
export async function refreshSession(dependencies: SessionDependencies, presented: unknown): Promise<SessionTokens> {
  const { refreshTokens, credentials, issuer, clock } = dependencies;
  if (!isWellFormedRefreshToken(presented)) throw new InvalidRefreshTokenError();
  const now = clock.now();
  const next = newToken(now);
  let access: IssuedAccessToken | undefined;
  // Runs inside the rotation: a failing lookup or signature undoes it, so the client can retry
  // with the same cookie instead of being logged out as a reuse.
  const rotation = await refreshTokens.rotate(hashRefreshToken(presented), next.stored, now, async (family) => {
    let credential: Credential | undefined;
    try {
      credential = await credentials.findById(family.credentialId);
    } catch (error) {
      if (!(error instanceof InvalidCredentialError)) throw error;
      dependencies.onCorruptCredential?.(error);
      credential = undefined;
    }
    if (!credential || credential.status !== 'active') return false;
    access = await issuer.issue(credential);
    return true;
  });

  if (rotation.kind === 'reused' || (rotation.kind === 'revoked' && rotation.tokenWasUsed)) {
    await dependencies.onReuseDetected?.({ familyId: rotation.family.id, subject: rotation.family.credentialId });
  }
  if (rotation.kind !== 'rotated' || !access) throw new InvalidRefreshTokenError();
  return { access, refresh: { refreshToken: next.token, expiresAt: rotation.family.expiresAt } };
}

/** Most refresh cookies a logout acts on (a request with more is malformed or hostile). */
export const MAX_LOGOUT_TOKENS = 4;

/**
 * Logout: revokes the family of every well-formed token presented (several when a cookie with the
 * same name was planted next to the real one), at most MAX_LOGOUT_TOKENS. Never fails for an
 * unknown token.
 */
export async function endSession(dependencies: Pick<SessionDependencies, 'refreshTokens' | 'clock'>, presented: unknown): Promise<void> {
  const candidates = (Array.isArray(presented) ? presented : [presented]).filter(isWellFormedRefreshToken).slice(0, MAX_LOGOUT_TOKENS);
  const now = dependencies.clock.now();
  for (const token of new Set(candidates)) {
    await dependencies.refreshTokens.revokeFamilyOf(hashRefreshToken(token), now, 'logout');
  }
}
