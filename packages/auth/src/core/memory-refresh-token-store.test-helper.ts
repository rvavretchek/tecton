import type { NewRefreshToken, RefreshFamily, RefreshRevocationReason, RefreshRotation, RefreshTokenStore } from './refresh-token-store.js';

interface StoredToken extends NewRefreshToken {
  familyId: string;
  usedAt?: Date;
}

/**
 * In-memory RefreshTokenStore for tests (not built into the package). It follows the port contract
 * of the Prisma adapter: same rotation order, conditional "mark as used" and fresh copies on read.
 */
export function createMemoryRefreshTokenStore() {
  const families = new Map<string, RefreshFamily>();
  const tokens = new Map<string, StoredToken>();
  const copy = (family: RefreshFamily): RefreshFamily => ({ ...family });
  const revoke = (familyId: string, now: Date, reason: RefreshRevocationReason) => {
    const family = families.get(familyId);
    if (family && !family.revokedAt) families.set(familyId, { ...family, revokedAt: now, revokedReason: reason });
  };

  const store: RefreshTokenStore = {
    async openFamily(family, token) {
      families.set(family.id, copy(family));
      tokens.set(token.tokenHash, { ...token, familyId: family.id });
    },
    async rotate(tokenHash, next, now): Promise<RefreshRotation> {
      const token = tokens.get(tokenHash);
      const family = token ? families.get(token.familyId) : undefined;
      if (!token || !family) return { kind: 'unknown' };
      if (family.revokedAt) return { kind: 'revoked', family: copy(family), tokenWasUsed: token.usedAt !== undefined };
      if (family.expiresAt.getTime() <= now.getTime()) return { kind: 'expired' };
      if (token.usedAt) {
        revoke(family.id, now, 'reuse');
        return { kind: 'reused', family: copy(families.get(family.id) as RefreshFamily) };
      }
      tokens.set(tokenHash, { ...token, usedAt: now });
      tokens.set(next.tokenHash, { ...next, familyId: family.id });
      return { kind: 'rotated', family: copy(family) };
    },
    async revokeFamily(familyId, now, reason) {
      revoke(familyId, now, reason);
    },
    async revokeFamilyOf(tokenHash, now, reason) {
      const token = tokens.get(tokenHash);
      if (!token) return false;
      revoke(token.familyId, now, reason);
      return true;
    },
    async close() {},
  };
  return {
    store,
    families: () => [...families.values()].map(copy),
    tokens: () => [...tokens.values()].map((token) => ({ ...token })),
  };
}
