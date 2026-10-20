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

/**
 * Called inside the rotation, after the presented token is marked used and before `next` is stored.
 * Returns whether the family's credential may continue (false revokes the family as `inactive`).
 * If it throws, the rotation is undone: the presented token stays unused, so a retry still works.
 */
export type RotationAuthorizer = (family: RefreshFamily) => Promise<boolean>;

/** Outcome of presenting a refresh token for rotation. */
export type RefreshRotation =
  /** The token was valid: it is now used, and `next` was stored in the same family. */
  | { kind: 'rotated'; family: RefreshFamily }
  /** The authorizer refused the credential: the token is used and the family is revoked (`inactive`). */
  | { kind: 'inactive'; family: RefreshFamily }
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
   * Atomically marks the token with `tokenHash` as used, asks `authorize`, and stores `next` in its
   * family. Checks run in this order: unknown, revoked, already used (reuse: the family is revoked),
   * expired. Marking is conditional on the token being unused, so of two concurrent rotations of
   * the same token only one is `rotated`; the other is `reused`. Expiry is checked against `now`
   * (from the Clock), never against the database clock.
   */
  rotate(tokenHash: string, next: NewRefreshToken, now: Date, authorize: RotationAuthorizer): Promise<RefreshRotation>;
  /** Revokes the family of the token with `tokenHash`, whatever its state. Returns whether a token was found. */
  revokeFamilyOf(tokenHash: string, now: Date, reason: RefreshRevocationReason): Promise<boolean>;
  close(): Promise<void>;
}
