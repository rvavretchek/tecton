/**
 * Port for token revocation (FR-14, AD-1): checked by every service after verifying a token, so a
 * revoked token is refused before it expires. Implementations must fail closed: when they cannot
 * answer, they throw RevocationStoreUnavailableError, never "not revoked".
 */
export interface TokenRevocationStore {
  /** Revokes one access token by `jti` until it expires. Nothing to do for an expired token. */
  revokeToken(token: { tokenId: string; expiresAt: Date }): Promise<void>;
  /** Revokes every token of `subject` issued at or before `at`. A later call never moves `at` back. */
  revokeSubject(revocation: { subject: string; at: Date }): Promise<void>;
  /** Whether the token is revoked, by its `jti` or by a revocation of its subject. */
  isRevoked(token: { tokenId: string; subject: string; issuedAt: Date }): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * The revocation store could not answer (unreachable, too slow, unexpected reply). Callers must
 * refuse the request (fail closed). The message never carries the URL or a password.
 */
export class RevocationStoreUnavailableError extends Error {
  override readonly name = 'RevocationStoreUnavailableError';
}

/** Longest `jti` or subject accepted as part of a key. */
export const MAX_REVOCATION_ID_LENGTH = 128;

/** Throws a RangeError for an id that cannot be part of a key: a programming error, not a bad token. */
export function assertRevocationId(name: string, value: unknown): asserts value is string {
  // Control characters are refused: ids end up inside storage keys.
  if (typeof value !== 'string' || value === '' || value.length > MAX_REVOCATION_ID_LENGTH || /[\x00-\x1f\x7f]/.test(value)) {
    throw new RangeError(`${name} must be a non-empty string of at most ${MAX_REVOCATION_ID_LENGTH} characters without control characters`);
  }
}
