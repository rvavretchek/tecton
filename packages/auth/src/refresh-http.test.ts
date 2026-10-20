import { Writable } from 'node:stream';
import { createArgon2idAuthProvider } from '@tecton/providers';
import { assertNoSecretsLeaked, createTestClock, ed25519KeyPairPem } from '#test-support';
import { decodeJwt } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccessTokenIssuer } from './adapters/jose/access-token-issuer.js';
import { buildSigningKeys } from './adapters/jose/signing-keys.js';
import type { Credential } from './core/credential.js';
import type { CredentialStore } from './core/credential-store.js';
import { createMemoryRefreshTokenStore } from './core/memory-refresh-token-store.test-helper.js';
import { hashRefreshToken } from './core/refresh-token.js';
import { createAuthService, LOG_REDACTION, type AuthServiceApp } from './service.js';

const PEPPER = 'refresh-test-pepper-with-32-bytes!!';
const PASSWORD = 'alice-password-123';
const WEEK = 604_800;
const auth = createArgon2idAuthProvider({ peppers: [{ id: '1', key: Buffer.from(PEPPER, 'utf8') }], currentPepperId: '1' });
const apps: AuthServiceApp[] = [];
const COOKIE = /^tecton_refresh=([A-Za-z0-9_-]{43}); Max-Age=(\d+); Path=\/auth; HttpOnly; Secure; SameSite=Strict$/;
const CLEARED = 'tecton_refresh=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Strict';

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function service() {
  const keys = await buildSigningKeys({ privateKeyPem: ed25519KeyPairPem().privatePem });
  let credential: Credential = {
    id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
    login: 'alice',
    passwordHash: await auth.hashPassword(PASSWORD),
    status: 'active',
    permissions: ['tenant:create'],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const store: CredentialStore = {
    count: async () => 1,
    findByLogin: async (login) => (login === credential.login ? credential : undefined),
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
  const clock = createTestClock(new Date('2026-10-20T12:00:00.000Z'));
  const memory = createMemoryRefreshTokenStore();
  const app = await createAuthService({
    store,
    refreshTokens: memory.store,
    auth,
    issuer: createAccessTokenIssuer({ keys, clock }),
    keys,
    clock,
    logger: { level: 'trace', redact: LOG_REDACTION, stream },
  });
  apps.push(app);

  const cookieOf = (response: { headers: Record<string, unknown> }) => {
    const header = response.headers['set-cookie'];
    expect(typeof header, 'one Set-Cookie header').toBe('string');
    return header as string;
  };
  const tokenOf = (response: { headers: Record<string, unknown> }) => {
    const match = COOKIE.exec(cookieOf(response));
    expect(match, cookieOf(response)).not.toBeNull();
    return match?.[1] as string;
  };
  const doLogin = () => app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'alice', password: PASSWORD } });
  const refresh = (token?: string) =>
    app.inject({ method: 'POST', url: '/auth/refresh', payload: {}, ...(token === undefined ? {} : { headers: { cookie: `tecton_refresh=${token}` } }) });
  const logout = (token?: string) =>
    app.inject({ method: 'POST', url: '/auth/logout', payload: {}, ...(token === undefined ? {} : { headers: { cookie: `tecton_refresh=${token}` } }) });
  return {
    app,
    clock,
    memory,
    cookieOf,
    tokenOf,
    doLogin,
    refresh,
    logout,
    logs: () => lines.join(''),
    setCredential: (change: Partial<Credential>) => void (credential = { ...credential, ...change }),
  };
}

describe('POST /auth/login sets the refresh cookie (Story 2.3, AC 1, P0-008, P0-009)', () => {
  it('sets tecton_refresh with the exact attributes and Max-Age of the family, never in the body', async () => {
    const { doLogin, cookieOf, tokenOf, memory } = await service();
    const response = await doLogin();

    expect(response.statusCode).toBe(200);
    expect(COOKIE.exec(cookieOf(response))?.[2]).toBe(String(WEEK));
    const token = tokenOf(response);
    expect(Object.keys(response.json() as object).sort()).toEqual(['accessToken', 'expiresIn', 'tokenType']);
    expect(response.body).not.toContain(token);
    expect(memory.tokens().map((stored) => stored.tokenHash)).toEqual([hashRefreshToken(token)]);
  });

  it('sets no cookie on a refused login', async () => {
    const { app } = await service();
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'alice', password: 'wrong-password-1' } });

    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

describe('POST /auth/refresh (Story 2.3, AC 2 to 5)', () => {
  it('rotates: new access token in the body, new cookie, the family expiring at a fixed time', async () => {
    const { doLogin, refresh, tokenOf, cookieOf, clock } = await service();
    const first = tokenOf(await doLogin());

    clock.advance(3600 * 1000);
    const response = await refresh(first);

    expect(response.statusCode).toBe(200);
    const body = response.json() as { accessToken: string; tokenType: string; expiresIn: number };
    expect(body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(decodeJwt(body.accessToken)).toMatchObject({ sub: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f', typ: 'user' });
    const second = tokenOf(response);
    expect(second).not.toBe(first);
    expect(COOKIE.exec(cookieOf(response))?.[2]).toBe(String(WEEK - 3600));
    expect(response.body).not.toContain(second);
  });

  it('puts the current permissions of the credential in the new access token', async () => {
    const { doLogin, refresh, tokenOf, setCredential } = await service();
    const first = tokenOf(await doLogin());
    setCredential({ permissions: ['tenant:create', 'tenant:archive'] });

    const body = (await refresh(first)).json() as { accessToken: string };
    expect(decodeJwt(body.accessToken)['perms']).toEqual(['tenant:create', 'tenant:archive']);
  });

  it('answers byte-identical 401s, clearing the cookie, for unknown, malformed, missing, expired, revoked, reused and inactive', async () => {
    const cases: Array<[string, () => Promise<Awaited<ReturnType<Awaited<ReturnType<typeof service>>['refresh']>>>]> = [];
    const s = await service();
    const reusedToken = s.tokenOf(await s.doLogin());
    await s.refresh(reusedToken);
    const revokedToken = s.tokenOf(await s.doLogin());
    await s.logout(revokedToken);
    const expired = await service();
    const expiredToken = expired.tokenOf(await expired.doLogin());
    expired.clock.advance(WEEK * 1000);
    const inactive = await service();
    const inactiveToken = inactive.tokenOf(await inactive.doLogin());
    inactive.setCredential({ status: 'disabled' });

    cases.push(
      ['unknown', () => s.refresh('A'.repeat(43))],
      ['malformed', () => s.refresh('not-a-token')],
      ['missing', () => s.refresh()],
      ['expired', () => expired.refresh(expiredToken)],
      ['revoked', () => s.refresh(revokedToken)],
      ['reused', () => s.refresh(reusedToken)],
      ['inactive', () => inactive.refresh(inactiveToken)],
    );
    const responses = [];
    for (const [label, call] of cases) {
      const response = await call();
      expect(response.statusCode, label).toBe(401);
      expect(response.headers['set-cookie'], label).toBe(CLEARED);
      responses.push(response);
    }
    const strip = ({ date: _date, ...rest }: Record<string, unknown>) => rest;
    for (const response of responses.slice(1)) {
      expect(response.body).toBe(responses[0]?.body);
      expect(strip(response.headers)).toEqual(strip(responses[0]?.headers ?? {}));
    }
    expect(responses[0]?.json()).toMatchObject({ status: 401, slug: 'unauthorized' });
  });

  it('on reuse, revokes the whole family and logs a security event in English without the token', async () => {
    const { doLogin, refresh, tokenOf, logs, memory } = await service();
    const first = tokenOf(await doLogin());
    const second = tokenOf(await refresh(first));

    expect((await refresh(first)).statusCode).toBe(401);
    expect((await refresh(second)).statusCode).toBe(401);

    const family = memory.families()[0];
    expect(family?.revokedReason).toBe('reuse');
    const event = logs()
      .split('\n')
      .filter((line) => line.includes('auth.refresh_token.reuse'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(event).toEqual([
      expect.objectContaining({ level: 40, familyId: family?.id, subject: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f', msg: 'refresh token reuse detected; family revoked' }),
    ]);
    assertNoSecretsLeaked(logs(), { first, second, firstHash: hashRefreshToken(first), secondHash: hashRefreshToken(second), password: PASSWORD, pepper: PEPPER });
  });

  it('documents concurrent refreshes with one cookie (P1-010): one 200, one 401, and the session is gone', async () => {
    const { doLogin, refresh, tokenOf } = await service();
    const first = tokenOf(await doLogin());

    const responses = await Promise.all([refresh(first), refresh(first)]);
    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([200, 401]);
    const winner = responses.find((response) => response.statusCode === 200);
    expect((await refresh(tokenOf(winner as NonNullable<typeof winner>))).statusCode).toBe(401);
  });

  it('accepts an empty JSON object and refuses a body with fields (input: {})', async () => {
    const { app, doLogin, tokenOf } = await service();
    const token = tokenOf(await doLogin());
    const headers = { cookie: `tecton_refresh=${token}` };

    expect((await app.inject({ method: 'POST', url: '/auth/refresh', headers, payload: { extra: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/auth/refresh', headers, payload: {} })).statusCode).toBe(200);
  });
});

describe('POST /auth/logout (Story 2.3, AC 6)', () => {
  it('revokes the family and clears the cookie', async () => {
    const { doLogin, logout, refresh, tokenOf, memory } = await service();
    const token = tokenOf(await doLogin());

    const response = await logout(token);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({});
    expect(response.headers['set-cookie']).toBe(CLEARED);
    expect(memory.families()[0]?.revokedReason).toBe('logout');
    expect((await refresh(token)).statusCode).toBe(401);
  });

  it('answers the same 200 for no cookie, an unknown or malformed one and an already revoked session', async () => {
    const { doLogin, logout, tokenOf } = await service();
    const token = tokenOf(await doLogin());
    await logout(token);

    for (const presented of [undefined, 'A'.repeat(43), 'bad', token]) {
      const response = await logout(presented);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({});
      expect(response.headers['set-cookie']).toBe(CLEARED);
    }
  });
});

describe('caching and logs (Story 2.3, AC 7, AC 8)', () => {
  it('sends no-store on login, refresh and logout', async () => {
    const { doLogin, refresh, logout, tokenOf } = await service();
    const login = await doLogin();
    const rotated = await refresh(tokenOf(login));

    for (const response of [login, rotated, await refresh('bad'), await logout(tokenOf(rotated))]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['pragma']).toBe('no-cache');
    }
  });

  it('never logs the refresh token, its hash or the cookie, even at trace level', async () => {
    const { doLogin, refresh, logout, tokenOf, logs } = await service();
    const first = tokenOf(await doLogin());
    const second = tokenOf(await refresh(first));
    await logout(second);

    assertNoSecretsLeaked(logs(), { first, second, firstHash: hashRefreshToken(first), secondHash: hashRefreshToken(second), cookie: `tecton_refresh=${first}` });
  });
});
