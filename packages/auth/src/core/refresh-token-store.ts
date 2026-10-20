/** Why a refresh token family was revoked. */
export type RefreshRevocationReason = 'logout' | 'reuse' | 'inactive';

export const REFRESH_REVOCATION_REASONS: readonly RefreshRevocationReason[] = ['logout', 'reuse', 'inactive'];

/** One login session: every refresh token rotated from the same login. */
export interface RefreshFamily {
  id: string;
  credentialId: string;
  createdAt: Date;
  /** Fixed at login; rotation never extends it. */
  expiresAt: Date;
  revokedAt?: Date;
  revokedReason?: RefreshRevocationReason;
}

/** A refresh token as stored: only its hash, never the token. */
export interface NewRefreshToken {
  id: string;
  tokenHash: string;
  createdAt: Date;
}

/** Outcome of presenting a refresh token for rotation. */
export type RefreshRotation =
  /** The token was valid: it is now used, and `next` was stored in the same family. */
  | { kind: 'rotated'; family: RefreshFamily }
  /** The token had already been used (or lost a concurrent rotation): the family is now revoked. */
  | { kind: 'reused'; family: RefreshFamily }
  /** The family was revoked before; `tokenWasUsed` tells a replay of a used token apart. */
  | { kind: 'revoked'; family: RefreshFamily; tokenWasUsed: boolean }
  | { kind: 'expired' }
  | { kind: 'unknown' };

/** Port for refresh token families in the Auth database (AD-1): the core never imports Prisma. */
export interface RefreshTokenStore {
  /** Stores a new family and its first token, atomically. */
  openFamily(family: RefreshFamily, token: NewRefreshToken): Promise<void>;
  /**
   * Atomically marks the token with `tokenHash` as used and stores `next` in its family. Marking is
   * conditional on the token being unused, so of two concurrent rotations of the same token only
   * one is `rotated`; the other is `reused`, and the family is revoked in the same transaction.
   * Expiry is checked against `now` (from the Clock), never against the database clock.
   */
  rotate(tokenHash: string, next: NewRefreshToken, now: Date): Promise<RefreshRotation>;
  /** Revokes a family (a no-op when it is already revoked or does not exist). */
  revokeFamily(familyId: string, now: Date, reason: RefreshRevocationReason): Promise<void>;
  /** Revokes the family of the token with `tokenHash`, whatever its state. Returns whether a token was found. */
  revokeFamilyOf(tokenHash: string, now: Date, reason: RefreshRevocationReason): Promise<boolean>;
  close(): Promise<void>;
}
