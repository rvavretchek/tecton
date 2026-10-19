import { Writable } from 'node:stream';
import { createArgon2idAuthProvider } from '@tecton/providers';
import { assertNoSecretsLeaked, createTestClock, ed25519KeyPairPem } from '#test-support';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { createAccessTokenIssuer } from './adapters/jose/access-token-issuer.js';
import { buildSigningKeys } from './adapters/jose/signing-keys.js';
import type { Credential } from './core/credential.js';
import type { CredentialStore } from './core/credential-store.js';
import { createAuthService, JWKS_PATH, LOG_REDACTION, startAuthServiceFromEnv, type AuthServiceApp } from './service.js';

const PEPPER = 'service-test-pepper-with-32-bytes!!';
const PASSWORD = 'alice-password-123';
const auth = createArgon2idAuthProvider({ peppers: [{ id: '1', key: Buffer.from(PEPPER, 'utf8') }], currentPepperId: '1' });
const apps: AuthServiceApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function service(options: { previous?: number } = {}) {
  const pair = ed25519KeyPairPem();
  const previous = Array.from({ length: options.previous ?? 0 }, () => ed25519KeyPairPem().publicPem);
  const keys = await buildSigningKeys({ privateKeyPem: pair.privatePem, previousPublicKeyPems: previous });
  const credential: Credential = {
    id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
    login: 'alice',
    passwordHash: await auth.hashPassword(PASSWORD),
    status: 'active',
    permissions: ['tenant:create'],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  let closed = false;
  const store: CredentialStore = {
    count: async () => 1,
    findByLogin: async (login) => (login === 'alice' ? credential : undefined),
    create: async () => undefined,
    createIfEmpty: async () => false,
    updatePasswordHash: async () => undefined,
    close: async () => {
      closed = true;
    },
  };
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const clock = createTestClock(new Date('2026-10-19T12:00:00.000Z'));
  const app = await createAuthService({
    store,
    auth,
    issuer: createAccessTokenIssuer({ keys, clock }),
    keys,
    clock,
    logger: { level: 'trace', redact: LOG_REDACTION, stream },
  });
  apps.push(app);
  return { app, keys, pair, credential, clock, logs: () => lines.join(''), isClosed: () => closed };
}

describe('Auth service (AC 1, AC 2, AC 3)', () => {
  it('logs in and returns a token verifiable through its own JWKS', async () => {
    const { app, clock } = await service();
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'Alice', password: PASSWORD } });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { accessToken: string; tokenType: string; expiresIn: number };
    expect(body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    const jwks = (await app.inject({ method: 'GET', url: JWKS_PATH })).json() as { keys: never[] };
    const { payload } = await jwtVerify(body.accessToken, createLocalJWKSet(jwks), {
      issuer: 'urn:tecton:auth',
      audience: 'urn:tecton:api',
      algorithms: ['EdDSA'],
      currentDate: clock.now(),
    });
    expect(payload).toMatchObject({ sub: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f', typ: 'user', perms: ['tenant:create'] });
  });

  it('answers 401 with byte-identical responses for an unknown login and a wrong password', async () => {
    const { app } = await service();
    const unknown = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'nobody', password: PASSWORD } });
    const wrong = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'alice', password: 'wrong-password-1' } });

    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toBe(unknown.body);
    const headers = (response: typeof unknown) => {
      const { date: _date, ...rest } = response.headers;
      return rest;
    };
    expect(headers(wrong)).toEqual(headers(unknown));
    expect(unknown.json()).toEqual({ status: 401, slug: 'unauthorized', i18nKey: 'tecton.error.unauthorized', message: 'invalid credentials' });
  });

  it('answers 400 for a body that does not match the login input', async () => {
    const { app } = await service();

    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'alice' } })).statusCode).toBe(400);
  });

  it('publishes only public keys in the JWKS, including previous ones during a rotation', async () => {
    const { app, keys } = await service({ previous: 1 });
    const response = await app.inject({ method: 'GET', url: JWKS_PATH });
    const jwks = response.json() as { keys: Array<Record<string, unknown>> };

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=300');
    expect(jwks.keys.map((key) => key['kid'])).toEqual(keys.publicJwks.map((key) => key.kid));
    expect(jwks.keys).toHaveLength(2);
    for (const key of jwks.keys) expect(key).not.toHaveProperty('d');
  });

  it('answers 501 for the actions of later stories', async () => {
    const { app } = await service();

    for (const url of ['/auth/refresh', '/auth/logout']) {
      expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(501);
    }
  });

  it('closes the credential store when the service closes', async () => {
    const { app, isClosed } = await service();
    apps.splice(apps.indexOf(app), 1);
    await app.close();

    expect(isClosed()).toBe(true);
  });
});

describe('Auth service logs (AC 6)', () => {
  it('never contain the password, hash, Pepper, private key or token', async () => {
    const { app, pair, credential, logs } = await service();
    const ok = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { login: 'alice', password: PASSWORD },
      headers: { authorization: 'Bearer previous-token-value-123', cookie: 'session=cookie-value-123' },
    });
    await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'alice', password: 'wrong-password-1' } });
    await app.inject({ method: 'GET', url: JWKS_PATH });
    const token = (ok.json() as { accessToken: string }).accessToken;

    expect(logs()).toContain('request completed');
    assertNoSecretsLeaked(logs(), {
      password: PASSWORD,
      wrongPassword: 'wrong-password-1',
      hash: credential.passwordHash,
      pepper: PEPPER,
      privateKey: pair.privatePem.split('\n')[1] ?? pair.privatePem,
      token,
      header: 'previous-token-value-123',
      cookie: 'cookie-value-123',
    });
  });
});

describe('Auth service log redaction (AC 6)', () => {
  // Fastify's request serializer keeps only method, URL and host, so headers never reach the log;
  // LOG_REDACTION is a second layer behind it.
  it('keeps the authorization and cookie headers out of the log even when a request is logged with them', async () => {
    const { app, logs } = await service();
    app.log.info(
      { req: { headers: { authorization: 'Bearer redacted-token-value-123', cookie: 'refresh=redacted-cookie-value' } } },
      'request with headers',
    );

    expect(logs()).toContain('request with headers');
    assertNoSecretsLeaked(logs(), { token: 'redacted-token-value-123', cookie: 'redacted-cookie-value' });
  });
});

describe('startAuthServiceFromEnv (AC 4)', () => {
  const base = {
    TECTON_AUTH_DATABASE_URL: 'postgresql://tecton:db-password-123@127.0.0.1:1/auth',
    TECTON_AUTH_PEPPER: PEPPER,
    PORT: '0',
  };

  it('fails before listening when the signing key is missing', async () => {
    await expect(startAuthServiceFromEnv(base)).rejects.toThrow(/TECTON_AUTH_SIGNING_KEY is not set/);
  });

  it('fails before listening when the signing key is a public key, without echoing it', async () => {
    const { publicPem } = ed25519KeyPairPem();
    const error = await startAuthServiceFromEnv({ ...base, TECTON_AUTH_SIGNING_KEY: publicPem }).catch((caught: unknown) => caught as Error);

    expect(error).toBeInstanceOf(Error);
    assertNoSecretsLeaked((error as Error).message, { key: publicPem.split('\n')[1] ?? publicPem });
  });

  it('fails without the database URL or the Pepper', async () => {
    const { privatePem } = ed25519KeyPairPem();

    await expect(startAuthServiceFromEnv({ ...base, TECTON_AUTH_DATABASE_URL: '', TECTON_AUTH_SIGNING_KEY: privatePem })).rejects.toThrow(
      /TECTON_AUTH_DATABASE_URL is not set/,
    );
    await expect(startAuthServiceFromEnv({ ...base, TECTON_AUTH_PEPPER: '', TECTON_AUTH_SIGNING_KEY: privatePem })).rejects.toThrow(
      /TECTON_AUTH_PEPPER is not set/,
    );
  });
});
