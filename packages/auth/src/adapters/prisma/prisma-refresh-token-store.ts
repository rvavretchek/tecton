import {
  REFRESH_REVOCATION_REASONS,
  type NewRefreshToken,
  type RefreshFamily,
  type RefreshRevocationReason,
  type RefreshRotation,
  type RefreshTokenStore,
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

  return {
    async openFamily(family, token) {
      await client.transaction(async (tx) => {
        await families(tx).create({
          data: { id: family.id, credentialId: family.credentialId, createdAt: family.createdAt, expiresAt: family.expiresAt },
        });
        await tokens(tx).create({ data: { ...token, familyId: family.id } });
      });
    },

    async rotate(tokenHash, next, now) {
      try {
        return await client.transaction(async (tx): Promise<RefreshRotation> => {
          const row = await tokens(tx).findUnique({ where: { tokenHash }, include: { family: true } });
          const family = row ? toFamily(row.family) : undefined;
          if (!row || !family) return { kind: 'unknown' };
          if (family.revokedAt) return { kind: 'revoked', family, tokenWasUsed: row.usedAt !== null };
          if (family.expiresAt.getTime() <= now.getTime()) return { kind: 'expired' };
          if (row.usedAt !== null) return reused(tx, family, now);
          // Conditional: of two concurrent rotations of the same token, only one marks it.
          const { count } = await tokens(tx).updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
          if (count !== 1) return reused(tx, family, now);
          await tokens(tx).create({ data: { ...next, familyId: family.id } });
          return { kind: 'rotated', family };
        });
      } catch (error) {
        if (!isWriteConflict(error)) throw error;
        // A concurrent rotation of the same token won the write: this one is a reuse, as with
        // count 0 above. The transaction rolled back, so the family is revoked on its own.
        const row = await tokens(client.delegates).findUnique({ where: { tokenHash }, include: { family: true } });
        const family = row ? toFamily(row.family) : undefined;
        if (!family) return { kind: 'unknown' };
        return reused(client.delegates, family, now);
      }
    },

    async revokeFamily(familyId, now, reason) {
      await revoke(client.delegates, familyId, now, reason);
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
