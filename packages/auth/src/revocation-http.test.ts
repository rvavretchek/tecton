import { Writable } from 'node:stream';
import { createArgon2idAuthProvider, RevocationStoreUnavailableError } from '@tecton/providers';
import { assertNoSecretsLeaked, createMemoryTokenRevocationStore, createTestClock, createTestSigningKey, ed25519KeyPairPem, tokenFactory } from '#test-support';
import { decodeJwt } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccessTokenIssuer } from './adapters/jose/access-token-issuer.js';
import { buildSigningKeys } from './adapters/jose/signing-keys.js';
import type { Credential } from './core/credential.js';
import type { CredentialStore } from './core/credential-store.js';
import { createMemoryRefreshTokenStore } from './core/memory-refresh-token-store.test-helper.js';
import { createAuthService, LOG_REDACTION, type AuthServiceApp } from './service.js';

const PEPPER = 'revocation-test-pepper-with-32-bytes';
const PASSWORD = 'alice-password-123';
const SUBJECT = '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f';
const auth = createArgon2idAuthProvider({ peppers: [{ id: '1', key: Buffer.from(PEPPER, 'utf8') }], currentPepperId: '1' });
const apps: AuthServiceApp[] = [];
const CLEARED = 'tecton_refresh=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Strict';

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function service() {
  const keys = await buildSigningKeys({ privateKeyPem: ed25519KeyPairPem().privatePem });
  const credential: Credential = {
    id: SUBJECT,
    login: 'alice',
    passwordHash: await auth.hashPassword(PASSWORD),
    status: 'active',
    permissions: ['tenant:create'],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const store: CredentialStore = {
    count: async () => 1,
    findByLogin: async (login) => (login === 'alice' ? credential : undefined),
    findById: async (id) => (id === credential.id ? credential : undefined),
    create: async () => undefined,
    createIfEmpty: async () => false,
    updatePasswordHash: async () => true,
    close: async () => undefined,
  };
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const clock = createTestClock(new Date('2026-10-21T12:00:00.000Z'));
  const revocations = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('revocation store unavailable: down'));
  const refresh = createMemoryRefreshTokenStore();
  const app = await createAuthService({
    store,
    refreshTokens: refresh.store,
    revocations,
    auth,
    issuer: createAccessTokenIssuer({ keys, clock }),
    keys,
    clock,
    logger: { level: 'trace', redact: LOG_REDACTION, stream },
  });
  apps.push(app);
  const login = async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'alice', password: PASSWORD } });
    const cookie = /^tecton_refresh=([A-Za-z0-9_-]{43});/.exec(String(response.headers['set-cookie']))?.[1] ?? '';
    return { accessToken: (response.json() as { accessToken: string }).accessToken, cookie };
  };
  const logout = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/auth/logout', headers });
  const refreshWith = (cookie: string) => app.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie: `tecton_refresh=${cookie}` } });
  return { app, clock, revocations, refresh, login, logout, refreshWith, logs: () => lines.join('') };
}

describe('logout revokes the access token in use (Story 2.5, AC 5, P0-015)', () => {
  it('revokes the jti of a valid Bearer of this service until it expires, and the refresh family', async () => {
    const { login, logout, revocations, refresh } = await service();
    const { accessToken, cookie } = await login();
    const claims = decodeJwt(accessToken);

    const response = await logout({ authorization: `Bearer ${accessToken}`, cookie: `tecton_refresh=${cookie}` });

    expect(response.statusCode).toBe(200);
    expect(revocations.revokedTokens()).toEqual([{ tokenId: claims.jti, expiresAt: new Date((claims.exp as number) * 1000) }]);
    expect(refresh.families()[0]?.revokedReason).toBe('logout');
  });

  it.each([
    ['no Bearer', {}],
    ['a malformed Bearer', { authorization: 'Bearer not-a-token' }],
    ['a token from another signing key', { authorization: `Bearer ${tokenFactory(createTestSigningKey(), { now: new Date('2026-10-21T12:00:00.000Z') }).valid({ sub: SUBJECT })}` }],
  ])('revokes only the refresh family with %s', async (_label, headers) => {
    const { login, logout, revocations, refresh } = await service();
    const { cookie } = await login();

    expect((await logout({ ...headers, cookie: `tecton_refresh=${cookie}` })).statusCode).toBe(200);
    expect(revocations.revokedTokens()).toEqual([]);
    expect(refresh.families()[0]?.revokedReason).toBe('logout');
  });

  it('does not revoke an expired access token (it is already refused)', async () => {
    const { login, logout, revocations, clock } = await service();
    const { accessToken } = await login();
    clock.advance(3_600_000);

    expect((await logout({ authorization: `Bearer ${accessToken}` })).statusCode).toBe(200);
    expect(revocations.revokedTokens()).toEqual([]);
  });

  it('answers 503 when the store is down, with the cookie cleared and the family revoked', async () => {
    const { login, logout, revocations, refresh, logs } = await service();
    const { accessToken, cookie } = await login();
    revocations.setUnavailable(true);

    const response = await logout({ authorization: `Bearer ${accessToken}`, cookie: `tecton_refresh=${cookie}` });

    expect(response.statusCode).toBe(503);
    expect(response.headers['set-cookie']).toBe(CLEARED);
    expect(refresh.families()[0]?.revokedReason).toBe('logout');
    expect(logs()).toContain('auth.logout.revocation_failed');
    assertNoSecretsLeaked(logs(), { accessToken, cookie });
  });
});

describe('refresh token reuse revokes the access tokens of the subject (Story 2.5, AC 6, P0-015)', () => {
  it('revokes the subject at the instant of the reuse', async () => {
    const { login, refreshWith, revocations, clock } = await service();
    const { cookie } = await login();
    await refreshWith(cookie);

    expect((await refreshWith(cookie)).statusCode).toBe(401);
    expect(revocations.revokedSubjects()).toEqual([{ subject: SUBJECT, at: clock.now() }]);
  });

  it('still answers 401 and logs the failure when the store is down', async () => {
    const { login, refreshWith, revocations, logs } = await service();
    const { cookie } = await login();
    await refreshWith(cookie);
    revocations.setUnavailable(true);

    expect((await refreshWith(cookie)).statusCode).toBe(401);
    await new Promise((resolve) => setImmediate(resolve));
    expect(logs()).toContain('auth.refresh_token.reuse.revocation_failed');
    assertNoSecretsLeaked(logs(), { cookie });
  });
});
