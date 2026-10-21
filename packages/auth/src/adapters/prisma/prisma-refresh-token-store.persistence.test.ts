import { Writable } from 'node:stream';
import { createArgon2idAuthProvider, RevocationStoreUnavailableError } from '@tecton/providers';
import { assertNoSecretsLeaked, createMemoryTokenRevocationStore, createTestClock, ed25519KeyPairPem, selectedDatabase, startDatabase, type StartedDatabase } from '#test-support';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapAdmin } from '../../core/bootstrap.js';
import type { Credential } from '../../core/credential.js';
import type { CredentialStore } from '../../core/credential-store.js';
import { generateRefreshToken, hashRefreshToken } from '../../core/refresh-token.js';
import type { NewRefreshToken, RefreshFamily, RefreshTokenStore, RotationAuthorizer } from '../../core/refresh-token-store.js';
import { createAuthService, LOG_REDACTION } from '../../service.js';
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

  const allow: RotationAuthorizer = async () => true;
  const rotate = (tokenHash: string, next: NewRefreshToken, now: Date, authorize: RotationAuthorizer = allow) => store.rotate(tokenHash, next, now, authorize);

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

    const result = await rotate(first.stored.tokenHash, second.stored, new Date(AT.getTime() + 1000));

    expect(result).toEqual({ kind: 'rotated', family });
    expect(await rotate(second.stored.tokenHash, newToken().stored, new Date(AT.getTime() + 2000))).toMatchObject({ kind: 'rotated' });
  });

  it('on reuse, revokes the family in the same transaction, so its newest token is refused too', async () => {
    const { family, first } = await openFor('reuse');
    const second = newToken();
    await rotate(first.stored.tokenHash, second.stored, AT);

    const reuse = await rotate(first.stored.tokenHash, newToken().stored, AT);
    expect(reuse).toMatchObject({ kind: 'reused', family: { id: family.id, revokedReason: 'reuse', revokedAt: AT } });
    expect(await rotate(second.stored.tokenHash, newToken().stored, AT)).toMatchObject({ kind: 'revoked', tokenWasUsed: false });
    expect(await rotate(first.stored.tokenHash, newToken().stored, AT)).toMatchObject({ kind: 'revoked', tokenWasUsed: true });
  });

  it('rolls the rotation back when the authorizer throws: the token stays usable (review P1)', async () => {
    const { family, first } = await openFor('rollback');
    const failing: RotationAuthorizer = async () => {
      throw new Error('database blip');
    };

    await expect(rotate(first.stored.tokenHash, newToken().stored, AT, failing)).rejects.toThrow('database blip');
    expect(await rotate(first.stored.tokenHash, newToken().stored, AT)).toEqual({ kind: 'rotated', family });
  });

  it('revokes the family as inactive when the authorizer refuses, storing no new token', async () => {
    const { family, first } = await openFor('inactive');
    const next = newToken();

    expect(await rotate(first.stored.tokenHash, next.stored, AT, async () => false)).toMatchObject({ kind: 'inactive', family: { id: family.id } });
    expect(await rotate(next.stored.tokenHash, newToken().stored, AT)).toEqual({ kind: 'unknown' });
    expect(await rotate(first.stored.tokenHash, newToken().stored, AT)).toMatchObject({ kind: 'revoked', family: { revokedReason: 'inactive' } });
  });

  it('reports a used token presented after the family expired as a reuse (review P6)', async () => {
    const { first } = await openFor('late-replay', new Date(AT.getTime() + 60_000));
    await rotate(first.stored.tokenHash, newToken().stored, AT);

    expect(await rotate(first.stored.tokenHash, newToken().stored, new Date(AT.getTime() + 120_000))).toMatchObject({ kind: 'reused' });
  });

  it('refuses an expired family without revoking it, and an unknown token', async () => {
    const { family, first } = await openFor('expired', new Date(AT.getTime() + 60_000));

    expect(await rotate(first.stored.tokenHash, newToken().stored, new Date(AT.getTime() + 60_000))).toEqual({ kind: 'expired' });
    expect(await rotate(hashRefreshToken(generateRefreshToken()), newToken().stored, AT)).toEqual({ kind: 'unknown' });
    expect(await rotate(first.stored.tokenHash, newToken().stored, new Date(AT.getTime() + 59_999))).toEqual({ kind: 'rotated', family });
  });

  it('revokes the family of a token in any state (logout), and reports an unknown token', async () => {
    const { first } = await openFor('logout');
    const second = newToken();
    await rotate(first.stored.tokenHash, second.stored, AT);

    expect(await store.revokeFamilyOf(first.stored.tokenHash, AT, 'logout')).toBe(true);
    expect(await rotate(second.stored.tokenHash, newToken().stored, AT)).toMatchObject({ kind: 'revoked', family: { revokedReason: 'logout' } });
    expect(await store.revokeFamilyOf(hashRefreshToken(generateRefreshToken()), AT, 'logout')).toBe(false);
    // A second revocation keeps the first reason and instant.
    await store.revokeFamilyOf(second.stored.tokenHash, new Date(AT.getTime() + 5000), 'inactive');
    expect(await rotate(second.stored.tokenHash, newToken().stored, AT)).toMatchObject({ kind: 'revoked', family: { revokedReason: 'logout', revokedAt: AT } });
  });

  it('lets exactly one of several concurrent rotations of the same token win; the family ends revoked', async () => {
    const { first } = await openFor('concurrent');

    const results = await Promise.all(Array.from({ length: 5 }, () => rotate(first.stored.tokenHash, newToken().stored, AT)));

    expect(results.filter((result) => result.kind === 'rotated')).toHaveLength(1);
    // The first loser revokes the family; losers that read it afterwards find it already revoked.
    // Both are refused, and both are reported as reuse by the core (tokenWasUsed).
    const losers = results.filter((result) => result.kind !== 'rotated');
    expect(losers.some((result) => result.kind === 'reused')).toBe(true);
    for (const loser of losers) {
      expect(loser.kind === 'reused' || (loser.kind === 'revoked' && loser.tokenWasUsed), JSON.stringify(loser)).toBe(true);
    }
    expect(await rotate(first.stored.tokenHash, newToken().stored, AT)).toMatchObject({ kind: 'revoked', family: { revokedReason: 'reuse' } });
  }, 60_000);

  it('deletes the families and tokens of a deleted credential (cascade)', async () => {
    const { credential, first } = await openFor('cascade');

    await (client.delegates.credential as { delete(args: { where: { id: string } }): Promise<unknown> }).delete({ where: { id: credential.id } });

    expect(await rotate(first.stored.tokenHash, newToken().stored, AT)).toEqual({ kind: 'unknown' });
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
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const app = await createAuthService({
    revocations: createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('down')),
      store,
      refreshTokens: createPrismaRefreshTokenStore({ client }),
      auth,
      issuer: createAccessTokenIssuer({ keys, clock }),
      keys,
      clock,
      logger: { level: 'trace', redact: LOG_REDACTION, stream },
    });
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
      const logout = await call('/auth/logout', again);
      expect(logout.statusCode).toBe(200);
      expect((await call('/auth/refresh', again)).statusCode).toBe(401);
      const logs = lines.join('');
      expect(logs).toContain('auth.refresh_token.reuse');
      const secrets = { first, second, again, firstHash: hashRefreshToken(first), password: 'admin-password-123' };
      assertNoSecretsLeaked(JSON.stringify([login.body, refreshed.body, logout.body]), secrets);
      assertNoSecretsLeaked(logs, secrets);
    } finally {
      await app.close();
    }
  }, 120_000);
});
