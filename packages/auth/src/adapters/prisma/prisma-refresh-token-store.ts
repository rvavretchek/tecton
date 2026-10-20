import {
  REFRESH_REVOCATION_REASONS,
  type NewRefreshToken,
  type RefreshFamily,
  type RefreshRevocationReason,
  type RefreshRotation,
  type RefreshTokenStore,
  type RotationAuthorizer,
} from '../../core/refresh-token-store.js';
import { createAuthPrismaClient, isWriteConflict, type AuthPrismaClient } from './client.js';

export type PrismaRefreshTokenStoreOptions = { databaseUrl: string } | { client: AuthPrismaClient };

interface FamilyRow {
  id: string;
  credentialId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

interface TokenRow {
  id: string;
  familyId: string;
  tokenHash: string;
  createdAt: Date;
  usedAt: Date | null;
  family: FamilyRow;
}

/** The operations this adapter uses; both generated clients satisfy them. */
interface FamilyDelegate {
  create(args: { data: Omit<FamilyRow, 'revokedAt' | 'revokedReason'> }): Promise<unknown>;
  findUnique(args: { where: { id: string } }): Promise<FamilyRow | null>;
  updateMany(args: {
    where: { id: string; revokedAt: null };
    data: { revokedAt: Date; revokedReason: RefreshRevocationReason };
  }): Promise<{ count: number }>;
}

interface TokenDelegate {
  create(args: { data: NewRefreshToken & { familyId: string } }): Promise<unknown>;
  findUnique(args: { where: { tokenHash: string }; include: { family: true } }): Promise<TokenRow | null>;
  updateMany(args: { where: { id: string; usedAt: null }; data: { usedAt: Date } }): Promise<{ count: number }>;
}

const isDate = (value: unknown): value is Date => value instanceof Date && !Number.isNaN(value.getTime());

/** A family read back from the database, or undefined when the row is invalid (fail closed). */
function toFamily(row: FamilyRow): RefreshFamily | undefined {
  if (!isDate(row.createdAt) || !isDate(row.expiresAt)) return undefined;
  const family: RefreshFamily = { id: row.id, credentialId: row.credentialId, createdAt: row.createdAt, expiresAt: row.expiresAt };
  if (row.revokedAt === null && row.revokedReason === null) return family;
  const reason = row.revokedReason as RefreshRevocationReason;
  if (!isDate(row.revokedAt) || !REFRESH_REVOCATION_REASONS.includes(reason)) return undefined;
  return { ...family, revokedAt: row.revokedAt, revokedReason: reason };
}

/** A token row with its family, or undefined when either row is invalid (fail closed: unknown). */
function toToken(row: TokenRow): { used: boolean; family: RefreshFamily } | undefined {
  const family = toFamily(row.family);
  if (!family || !isDate(row.createdAt) || (row.usedAt !== null && !isDate(row.usedAt))) return undefined;
  return { used: row.usedAt !== null, family };
}

/** RefreshTokenStore backed by the Auth database through Prisma 7 (Story 2.3). */
export function createPrismaRefreshTokenStore(options: PrismaRefreshTokenStoreOptions): RefreshTokenStore {
  const client = 'client' in options ? options.client : createAuthPrismaClient(options.databaseUrl);
  const families = (delegates: AuthPrismaClient['delegates']) => delegates.refreshFamily as FamilyDelegate;
  const tokens = (delegates: AuthPrismaClient['delegates']) => delegates.refreshToken as TokenDelegate;
  const revoke = (delegates: AuthPrismaClient['delegates'], familyId: string, now: Date, reason: RefreshRevocationReason) =>
    families(delegates).updateMany({ where: { id: familyId, revokedAt: null }, data: { revokedAt: now, revokedReason: reason } });

  /** The family after revoking it for reuse; a row that turns invalid still counts as revoked. */
  const reused = async (delegates: AuthPrismaClient['delegates'], family: RefreshFamily, now: Date): Promise<RefreshRotation> => {
    await revoke(delegates, family.id, now, 'reuse');
    const row = await families(delegates).findUnique({ where: { id: family.id } });
    return { kind: 'reused', family: (row && toFamily(row)) ?? { ...family, revokedAt: now, revokedReason: 'reuse' } };
  };

  /**
   * The outcome decided by the stored state alone, in the port's order (unknown, revoked, used,
   * expired), or `fresh` when the token may be rotated. A used token is a reuse even after expiry,
   * so a late replay of a stolen token is still reported.
   */
  const classify = async (
    delegates: AuthPrismaClient['delegates'],
    tokenHash: string,
    now: Date,
  ): Promise<RefreshRotation | { kind: 'fresh'; tokenId: string; family: RefreshFamily }> => {
    const row = await tokens(delegates).findUnique({ where: { tokenHash }, include: { family: true } });
    const token = row ? toToken(row) : undefined;
    if (!row || !token) return { kind: 'unknown' };
    const { family } = token;
    if (family.revokedAt) return { kind: 'revoked', family, tokenWasUsed: token.used };
    if (token.used) return reused(delegates, family, now);
    if (family.expiresAt.getTime() <= now.getTime()) return { kind: 'expired' };
    return { kind: 'fresh', tokenId: row.id, family };
  };

  const attempt = (tokenHash: string, next: NewRefreshToken, now: Date, authorize: RotationAuthorizer) =>
    client.transaction(async (tx): Promise<RefreshRotation> => {
      const state = await classify(tx, tokenHash, now);
      if (state.kind !== 'fresh') return state;
      const { family } = state;
      // Conditional: of two concurrent rotations of the same token, only one marks it.
      const { count } = await tokens(tx).updateMany({ where: { id: state.tokenId, usedAt: null }, data: { usedAt: now } });
      if (count !== 1) return reused(tx, family, now);
      // Inside the transaction: if the credential lookup or the token issuance throws, the
      // rotation rolls back and the presented token stays usable for a retry.
      if (!(await authorize(family))) {
        await revoke(tx, family.id, now, 'inactive');
        return { kind: 'inactive', family };
      }
      await tokens(tx).create({ data: { ...next, familyId: family.id } });
      return { kind: 'rotated', family };
    });

  return {
    async openFamily(family, token) {
      await client.transaction(async (tx) => {
        await families(tx).create({
          data: { id: family.id, credentialId: family.credentialId, createdAt: family.createdAt, expiresAt: family.expiresAt },
        });
        await tokens(tx).create({ data: { ...token, familyId: family.id } });
      });
    },

    async rotate(tokenHash, next, now, authorize) {
      for (let retried = false; ; retried = true) {
        try {
          return await attempt(tokenHash, next, now, authorize);
        } catch (error) {
          if (!isWriteConflict(error)) throw error;
          // The transaction rolled back. Decide again from what is stored now: a concurrent
          // rotation of the same token that won makes this one a reuse. A conflict with something
          // else (a logout, another session) leaves the token unused: try once more, then refuse
          // without revoking anything.
          const state = await classify(client.delegates, tokenHash, now);
          if (state.kind !== 'fresh') return state;
          if (retried) return { kind: 'unknown' };
        }
      }
    },

    async revokeFamilyOf(tokenHash, now, reason) {
      const row = await tokens(client.delegates).findUnique({ where: { tokenHash }, include: { family: true } });
      if (!row) return false;
      await revoke(client.delegates, row.familyId, now, reason);
      return true;
    },

    close: () => client.close(),
  };
}
