import { createArgon2idAuthProvider } from '@tecton/providers';
import { assertNoSecretsLeaked, createTestClock, ed25519KeyPairPem, selectedDatabase, startDatabase, type StartedDatabase } from '#test-support';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapAdmin } from '../../core/bootstrap.js';
import type { Credential } from '../../core/credential.js';
import type { CredentialStore } from '../../core/credential-store.js';
import { generateRefreshToken, hashRefreshToken } from '../../core/refresh-token.js';
import type { NewRefreshToken, RefreshFamily, RefreshTokenStore } from '../../core/refresh-token-store.js';
import { createAuthService } from '../../service.js';
import { createAccessTokenIssuer } from '../jose/access-token-issuer.js';
import { buildSigningKeys } from '../jose/signing-keys.js';
import { createAuthPrismaClient, type AuthPrismaClient } from './client.js';
import { applyAuthMigrations } from './migrations.js';
import { createPrismaCredentialStore } from './prisma-credential-store.js';
import { createPrismaRefreshTokenStore } from './prisma-refresh-token-store.js';

const auth = createArgon2idAuthProvider({
  peppers: [{ id: '1', key: Buffer.from('refresh-persistence-pepper-32-bytes', 'utf8') }],
  currentPepperId: '1',
});
const AT = new Date('2026-10-20T12:34:56.789Z');
const WEEK_MS = 7 * 24 * 3600 * 1000;

function credentialOf(login: string): Credential {
  return {
    id: uuidv7(),
    login,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1,keyid=MQ$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g',
    status: 'active',
    permissions: ['tenant:create'],
    createdAt: AT,
    updatedAt: AT,
  };
}

const newToken = (createdAt = AT): { raw: string; stored: NewRefreshToken } => {
  const raw = generateRefreshToken();
  return { raw, stored: { id: uuidv7(), tokenHash: hashRefreshToken(raw), createdAt } };
};

// Story 2.3, AC 1 to 6: runs once per engine in the CI matrix (TECTON_TEST_DB).
describe(`Refresh token store on ${selectedDatabase()} (Story 2.3)`, () => {
  let database: StartedDatabase;
  let client: AuthPrismaClient;
  let credentials: CredentialStore;
  let store: RefreshTokenStore;

  beforeAll(async () => {
    database = await startDatabase();
    await applyAuthMigrations({ databaseUrl: database.url });
    client = createAuthPrismaClient(database.url);
    credentials = createPrismaCredentialStore({ client });
    store = createPrismaRefreshTokenStore({ client });
  }, 240_000);

  afterAll(async () => {
    await client?.close();
    await database?.stop();
  });

  async function openFor(login: string, expiresAt = new Date(AT.getTime() + WEEK_MS)) {
    const credential = credentialOf(login);
    await credentials.create(credential);
    const family: RefreshFamily = { id: uuidv7(), credentialId: credential.id, createdAt: AT, expiresAt };
    const first = newToken();
    await store.openFamily(family, first.stored);
    return { credential, family, first };
  }

  it('finds a credential by id (findById), and nothing for an unknown id', async () => {
    const { credential } = await openFor('by-id');

    expect(await credentials.findById(credential.id)).toEqual(credential);
    expect(await credentials.findById(uuidv7())).toBeUndefined();
  });

  it('rotates a valid token, keeping the family and its millisecond timestamps', async () => {
    const { family, first } = await openFor('rotate');
    const second = newToken(new Date(AT.getTime() + 1000));

    const result = await store.rotate(first.stored.tokenHash, second.stored, new Date(AT.getTime() + 1000));

    expect(result).toEqual({ kind: 'rotated', family });
    expect(await store.rotate(second.stored.tokenHash, newToken().stored, new Date(AT.getTime() + 2000))).toMatchObject({ kind: 'rotated' });
  });

  it('on reuse, revokes the family in the same transaction, so its newest token is refused too', async () => {
    const { family, first } = await openFor('reuse');
    const second = newToken();
    await store.rotate(first.stored.tokenHash, second.stored, AT);

    const reuse = await store.rotate(first.stored.tokenHash, newToken().stored, AT);
    expect(reuse).toMatchObject({ kind: 'reused', family: { id: family.id, revokedReason: 'reuse', revokedAt: AT } });
    expect(await store.rotate(second.stored.tokenHash, newToken().stored, AT)).toMatchObject({ kind: 'revoked', tokenWasUsed: false });
    expect(await store.rotate(first.stored.tokenHash, newToken().stored, AT)).toMatchObject({ kind: 'revoked', tokenWasUsed: true });
  });

  it('refuses an expired family without revoking it, and an unknown token', async () => {
    const { family, first } = await openFor('expired', new Date(AT.getTime() + 60_000));

    expect(await store.rotate(first.stored.tokenHash, newToken().stored, new Date(AT.getTime() + 60_000))).toEqual({ kind: 'expired' });
    expect(await store.rotate(hashRefreshToken(generateRefreshToken()), newToken().stored, AT)).toEqual({ kind: 'unknown' });
    expect(await store.rotate(first.stored.tokenHash, newToken().stored, new Date(AT.getTime() + 59_999))).toEqual({ kind: 'rotated', family });
  });

  it('revokes the family of a token in any state (logout), and reports an unknown token', async () => {
    const { first } = await openFor('logout');
    const second = newToken();
    await store.rotate(first.stored.tokenHash, second.stored, AT);

    expect(await store.revokeFamilyOf(first.stored.tokenHash, AT, 'logout')).toBe(true);
    expect(await store.rotate(second.stored.tokenHash, newToken().stored, AT)).toMatchObject({ kind: 'revoked', family: { revokedReason: 'logout' } });
    expect(await store.revokeFamilyOf(hashRefreshToken(generateRefreshToken()), AT, 'logout')).toBe(false);
    // A second revocation keeps the first reason and instant.
    await store.revokeFamily((await store.rotate(second.stored.tokenHash, newToken().stored, AT) as { family: RefreshFamily }).family.id, new Date(AT.getTime() + 5000), 'inactive');
    expect(await store.rotate(second.stored.tokenHash, newToken().stored, AT)).toMatchObject({ kind: 'revoked', family: { revokedReason: 'logout', revokedAt: AT } });
  });

  it('lets exactly one of several concurrent rotations of the same token win; the family ends revoked', async () => {
    const { first } = await openFor('concurrent');

    const results = await Promise.all(Array.from({ length: 5 }, () => store.rotate(first.stored.tokenHash, newToken().stored, AT)));

    expect(results.filter((result) => result.kind === 'rotated')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'reused')).toHaveLength(4);
    expect(await store.rotate(first.stored.tokenHash, newToken().stored, AT)).toMatchObject({ kind: 'revoked', family: { revokedReason: 'reuse' } });
  }, 60_000);

  it('deletes the families and tokens of a deleted credential (cascade)', async () => {
    const { credential, first } = await openFor('cascade');

    await (client.delegates.credential as { delete(args: { where: { id: string } }): Promise<unknown> }).delete({ where: { id: credential.id } });

    expect(await store.rotate(first.stored.tokenHash, newToken().stored, AT)).toEqual({ kind: 'unknown' });
  });
});

describe(`Refresh end to end on ${selectedDatabase()} (Story 2.3)`, () => {
  let database: StartedDatabase;

  beforeAll(async () => {
    database = await startDatabase();
    await applyAuthMigrations({ databaseUrl: database.url });
  }, 240_000);

  afterAll(async () => {
    await database?.stop();
  });

  it('logs in, refreshes, detects reuse and logs out against the real database', async () => {
    const keys = await buildSigningKeys({ privateKeyPem: ed25519KeyPairPem().privatePem });
    const clock = createTestClock(AT);
    const client = createAuthPrismaClient(database.url);
    const store = createPrismaCredentialStore({ client });
    await bootstrapAdmin({ store, auth, clock, login: 'admin', password: 'admin-password-123' });
    const app = await createAuthService({ store, refreshTokens: createPrismaRefreshTokenStore({ client }), auth, issuer: createAccessTokenIssuer({ keys, clock }), keys, clock });
    const tokenOf = (response: { headers: Record<string, unknown> }) => /^tecton_refresh=([A-Za-z0-9_-]{43});/.exec(String(response.headers['set-cookie']))?.[1] ?? '';
    const call = (url: string, token: string) => app.inject({ method: 'POST', url, payload: {}, headers: { cookie: `tecton_refresh=${token}` } });
    try {
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'admin', password: 'admin-password-123' } });
      const first = tokenOf(login);
      expect(first).toHaveLength(43);

      const refreshed = await call('/auth/refresh', first);
      expect(refreshed.statusCode).toBe(200);
      const second = tokenOf(refreshed);

      expect((await call('/auth/refresh', first)).statusCode).toBe(401);
      expect((await call('/auth/refresh', second)).statusCode).toBe(401);

      const again = tokenOf(await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'admin', password: 'admin-password-123' } }));
      expect((await call('/auth/logout', again)).statusCode).toBe(200);
      expect((await call('/auth/refresh', again)).statusCode).toBe(401);
      assertNoSecretsLeaked(JSON.stringify([login.body, refreshed.body]), { first, second });
    } finally {
      await app.close();
    }
  }, 120_000);
});
