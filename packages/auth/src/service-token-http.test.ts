import { Writable } from 'node:stream';
import { createArgon2idAuthProvider, LoginLockoutUnavailableError, RevocationStoreUnavailableError } from '@tecton/providers';
import { assertNoSecretsLeaked, createMemoryLoginLockout, createMemoryTokenRevocationStore, createTestClock, ed25519KeyPairPem } from '#test-support';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccessTokenIssuer, createServiceTokenIssuer } from './adapters/jose/access-token-issuer.js';
import { buildSigningKeys } from './adapters/jose/signing-keys.js';
import type { Credential } from './core/credential.js';
import type { CredentialStore } from './core/credential-store.js';
import { createMemoryRefreshTokenStore } from './core/memory-refresh-token-store.test-helper.js';
import { createMemoryServiceCredentialStore } from './core/memory-service-credential-store.test-helper.js';
import { createAuthService, LOG_REDACTION, type AuthServiceApp } from './service.js';

const PEPPER = 'service-token-test-pepper-32-bytes';
const PASSWORD = 'admin-password-123';
const auth = createArgon2idAuthProvider({ peppers: [{ id: '1', key: Buffer.from(PEPPER, 'utf8') }], currentPepperId: '1' });
const apps: AuthServiceApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

function credentialOf(id: string, login: string, passwordHash: string, permissions: string[]): Credential {
  return { id, login, passwordHash, status: 'active', permissions, createdAt: new Date(0), updatedAt: new Date(0) };
}

async function service(options: { withServices?: boolean } = {}) {
  const keys = await buildSigningKeys({ privateKeyPem: ed25519KeyPairPem().privatePem });
  const hash = await auth.hashPassword(PASSWORD);
  const credentials = [
    credentialOf('0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f', 'admin', hash, ['auth:service:register']),
    credentialOf('0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e60', 'alice', hash, ['tenant:create']),
  ];
  const store: CredentialStore = {
    count: async () => credentials.length,
    findByLogin: async (login) => credentials.find((credential) => credential.login === login),
    findById: async (id) => credentials.find((credential) => credential.id === id),
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
  const clock = createTestClock(new Date('2026-10-23T12:00:00.000Z'));
  const revocations = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('revocation store unavailable: down'), () => clock.now());
  const services = createMemoryServiceCredentialStore();
  const closeServices = vi.spyOn(services.store, 'close');
  const app = await createAuthService({
    store,
    refreshTokens: createMemoryRefreshTokenStore().store,
    revocations,
    lockout: createMemoryLoginLockout(() => new LoginLockoutUnavailableError('down'), () => clock.now()),
    auth,
    issuer: createAccessTokenIssuer({ keys, clock }),
    keys,
    clock,
    ...(options.withServices === false ? {} : { services: services.store, serviceTokens: createServiceTokenIssuer({ keys, clock }) }),
    logger: { level: 'trace', redact: LOG_REDACTION, stream },
  });
  apps.push(app);
  const login = async (who = 'admin') => {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: who, password: PASSWORD } });
    return (response.json() as { accessToken: string }).accessToken;
  };
  const register = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/auth/register-service', payload, headers });
  const serviceToken = (serviceId: string, secret: string) => app.inject({ method: 'POST', url: '/auth/service-token', payload: { serviceId, secret } });
  return { app, clock, revocations, services, closeServices, login, register, serviceToken, logs: () => lines.join('') };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('POST /auth/register-service (Story 2.7a, AC 1 to 3, P0-017)', () => {
  it('registers with an administrator token: 200, the secret once, no-store, an audit event', async () => {
    const { login, register, services, logs } = await service();

    const response = await register({ domain: 'billing', dependencies: 'tenant, catalog', permissions: 'invoice:write' }, bearer(await login()));

    expect(response.statusCode).toBe(200);
    const body = response.json() as { domain: string; secret: string; rotated: boolean };
    expect(body).toEqual({ domain: 'billing', secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), rotated: false });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(services.rows.get('billing')).toMatchObject({ callees: ['catalog', 'tenant'], permissions: ['invoice:write'] });
    expect(logs()).toMatch(/"event":"auth.service.registered".*"domain":"billing".*"by":"0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f"/);
    assertNoSecretsLeaked(logs(), { secret: body.secret, hash: services.rows.get('billing')?.secretHash ?? '' });
  });

  it('answers 401 without a token or with an invalid one, and creates nothing (AC 2)', async () => {
    const { register, services } = await service();

    expect((await register({ domain: 'billing' })).statusCode).toBe(401);
    expect((await register({ domain: 'billing' }, bearer('not.a.token'))).statusCode).toBe(401);
    expect(services.rows.size).toBe(0);
  });

  it('answers 403 to a user without auth:service:register (AC 2)', async () => {
    const { login, register, services } = await service();

    const response = await register({ domain: 'billing' }, bearer(await login('alice')));

    expect(response.statusCode).toBe(403);
    expect(services.rows.size).toBe(0);
  });

  it('answers 401 to an administrator token revoked by logout', async () => {
    const { app, login, register, services } = await service();
    const token = await login();
    expect((await app.inject({ method: 'POST', url: '/auth/logout', headers: bearer(token) })).statusCode).toBe(200);

    expect((await register({ domain: 'billing' }, bearer(token))).statusCode).toBe(401);
    expect(services.rows.size).toBe(0);
  });

  it('answers 503 when revocation cannot be checked', async () => {
    const { login, register, revocations } = await service();
    const token = await login();
    revocations.setUnavailable(true);

    const response = await register({ domain: 'billing' }, bearer(token));

    expect(response.statusCode).toBe(503);
  });

  it('refuses a service token as administrator (typ service)', async () => {
    const { login, register, serviceToken } = await service();
    const { secret } = (await register({ domain: 'billing' }, bearer(await login()))).json() as { secret: string };
    const { accessToken } = (await serviceToken('billing', secret)).json() as { accessToken: string };

    expect((await register({ domain: 'catalog' }, bearer(accessToken))).statusCode).toBe(401);
  });

  it('answers 409 to a second registration without rotate, keeping the first secret (AC 3)', async () => {
    const { login, register, serviceToken } = await service();
    const token = await login();
    const { secret } = (await register({ domain: 'billing' }, bearer(token))).json() as { secret: string };

    const again = await register({ domain: 'billing' }, bearer(token));

    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ status: 409, slug: 'conflict' });
    expect((await serviceToken('billing', secret)).statusCode).toBe(200);
  });

  it('rotates: the old secret and its tokens stop working, the new secret works (AC 3)', async () => {
    const { login, register, serviceToken, revocations, clock, logs } = await service();
    const token = await login();
    const first = (await register({ domain: 'billing' }, bearer(token))).json() as { secret: string };
    const oldToken = (await serviceToken('billing', first.secret)).json() as { accessToken: string };
    clock.advance(1000);

    const rotated = await register({ domain: 'billing', rotate: true }, bearer(token));

    expect(rotated.statusCode).toBe(200);
    const second = rotated.json() as { secret: string; rotated: boolean };
    expect(second.rotated).toBe(true);
    expect((await serviceToken('billing', first.secret)).statusCode).toBe(401);
    expect((await serviceToken('billing', second.secret)).statusCode).toBe(200);
    const old = decodeJwt(oldToken.accessToken);
    expect(await revocations.isRevoked({ tokenId: old.jti as string, subject: 'service:billing', issuedAt: new Date((old.iat as number) * 1000) })).toBe(true);
    expect(logs()).toContain('"event":"auth.service.rotated"');
  });

  it.each([
    ['an invalid domain', { domain: 'Billing' }],
    ['the Auth service', { domain: 'auth' }],
    ['a dependency on itself', { domain: 'billing', dependencies: 'billing' }],
    ['a hand-granted call: permission', { domain: 'billing', permissions: 'call:tenant' }],
  ])('answers 400 to %s', async (_name, payload) => {
    const { login, register, services } = await service();

    const response = await register(payload, bearer(await login()));

    expect(response.statusCode).toBe(400);
    expect(services.rows.size).toBe(0);
  });
});

describe('POST /auth/service-token (Story 2.7a, AC 4 to 8, P0-018)', () => {
  async function registered() {
    const context = await service();
    const response = await context.register({ domain: 'billing', dependencies: 'tenant', permissions: 'invoice:write' }, bearer(await context.login()));
    return { ...context, secret: (response.json() as { secret: string }).secret };
  }

  it('issues a short-lived service token, no refresh cookie, no-store (AC 4, AC 5, AC 6)', async () => {
    const { serviceToken, secret, logs, services } = await registered();

    const response = await serviceToken('billing', secret);

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json() as { accessToken: string; tokenType: string; expiresIn: number };
    expect(body).toMatchObject({ tokenType: 'Bearer', expiresIn: 300 });
    expect(decodeProtectedHeader(body.accessToken)).toMatchObject({ alg: 'EdDSA', typ: 'at+jwt' });
    expect(decodeJwt(body.accessToken)).toMatchObject({ typ: 'service', sub: 'service:billing', perms: ['invoice:write', 'call:tenant'] });
    assertNoSecretsLeaked(logs(), { secret, token: body.accessToken, hash: services.rows.get('billing')?.secretHash ?? '' });
  });

  it('answers the same 401 to an unknown service, a wrong secret and a revoked credential (AC 7)', async () => {
    const { serviceToken, secret, services } = await registered();
    const row = services.rows.get('billing');
    services.putRaw({ ...(row as NonNullable<typeof row>), domain: 'revoked-one', status: 'revoked' });
    const verify = vi.spyOn(auth, 'verifyPassword');

    const responses = [await serviceToken('nobody', secret), await serviceToken('billing', 'wrong-secret'), await serviceToken('revoked-one', secret)];

    const shape = (response: (typeof responses)[number]) => {
      const { date: _date, ...headers } = response.headers;
      return { status: response.statusCode, body: response.body, headers };
    };
    for (const response of responses) expect(shape(response)).toEqual(shape(responses[0] as (typeof responses)[number]));
    expect(responses[0]?.statusCode).toBe(401);
    expect(verify).toHaveBeenCalledTimes(3);
    verify.mockRestore();
  });

  it('a service token is not a user credential: refresh and login refuse it, logout revokes nothing for it (AC 8)', async () => {
    const { app, serviceToken, secret, revocations } = await registered();
    const { accessToken } = (await serviceToken('billing', secret)).json() as { accessToken: string };

    expect((await app.inject({ method: 'POST', url: '/auth/refresh', headers: bearer(accessToken) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'service:billing', password: secret } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'billing', password: secret } })).statusCode).toBe(401);
    const before = revocations.revokedTokens().length;
    expect((await app.inject({ method: 'POST', url: '/auth/logout', headers: bearer(accessToken) })).statusCode).toBe(200);
    expect(revocations.revokedTokens()).toHaveLength(before);
  });
});

describe('Auth service without service credentials', () => {
  it('answers 501 to serviceToken and registerService', async () => {
    const { login, register, serviceToken } = await service({ withServices: false });

    expect((await serviceToken('billing', 'x')).statusCode).toBe(501);
    expect((await register({ domain: 'billing' }, bearer(await login()))).statusCode).toBe(501);
  });
});

describe('closing', () => {
  it('closes the service credential store with the app', async () => {
    const { app, closeServices } = await service();
    apps.splice(apps.indexOf(app), 1);

    await app.close();

    expect(closeServices).toHaveBeenCalledOnce();
  });
});
