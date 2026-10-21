import { Writable } from 'node:stream';
import { parseManifest, type TectonManifest } from '@tecton/manifest';
import { assertNoSecretsLeaked, createMemoryTokenRevocationStore, createTestClock, createTestSigningKey, jwksTls, tokenFactory, type JwksTlsServer } from '#test-support';
import { RevocationStoreUnavailableError } from '@tecton/providers';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTokenVerifier, InvalidTokenError, type TokenVerifier } from './auth/token-verifier.js';
import { registerActionRoutes, type ActionContext } from './routes.js';
import { createTectonServer } from './server.js';

function manifestOf(source: string): TectonManifest {
  const result = parseManifest(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.manifest;
}

const FINANCE = manifestOf(`manifestVersion: "0.1"
domain: finance
version: 0.1.0
description: "Finance."
actions:
  - name: closeMonth
    description: "Closes the month."
    input: { month: string }
    output: { closedBy: string }
    auth: { requires: [finance:close, finance:audit] }
  - name: status
    description: "Public status."
    input: {}
    output: { ok: boolean }
    auth: { public: true }
`);

const revocations = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('revocation store unavailable: down'), () => NOW);
const NOW = new Date('2026-10-20T12:00:00.000Z');
const USER_A = '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5a';
const key = createTestSigningKey();
const tokens = tokenFactory(key, { now: NOW });
const ALL_PERMS = ['finance:close', 'finance:audit'];
let jwks: JwksTlsServer;
const servers: Array<ReturnType<typeof createTectonServer>> = [];

beforeAll(async () => {
  jwks = await jwksTls({ keys: [key.publicJwk] });
}, 60_000);

afterAll(async () => {
  await jwks?.stop();
});

afterEach(async () => {
  for (const app of servers.splice(0)) await app.close();
});

async function serve(options: { verifier?: TokenVerifier } = {}) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const app = createTectonServer({ logger: { level: 'trace', stream } });
  servers.push(app);
  const seen: ActionContext[] = [];
  const closeMonth = vi.fn(async (_input: Record<string, unknown>, context: ActionContext) => {
    seen.push(context);
    return { closedBy: context.principal?.subject ?? 'nobody' };
  });
  const status = vi.fn(async () => ({ ok: true }));
  const verifier = options.verifier ?? createTokenVerifier({ revocations, jwksUrl: jwks.url, ca: jwks.ca, clock: createTestClock(NOW) });
  registerActionRoutes(app, FINANCE, { closeMonth, status }, { verifier });
  await app.ready();
  const call = (headers: Record<string, string> = {}, payload: unknown = { month: '2026-10' }) =>
    app.inject({ method: 'POST', url: '/finance/close-month', headers, payload: payload as Record<string, unknown> });
  return { app, call, closeMonth, status, seen, logs: () => lines.join('') };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('protected actions (Story 2.4, AC 1, AC 6)', () => {
  it('answers 401 with WWW-Authenticate before the handler when there is no Bearer token (P0-010)', async () => {
    const { call, closeMonth } = await serve();
    const response = await call();

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.json()).toMatchObject({ status: 401, slug: 'unauthorized' });
    expect(closeMonth).not.toHaveBeenCalled();
  });

  it('answers 401, not 400, to an invalid body without a token: the contract stays hidden', async () => {
    const { call } = await serve();

    expect((await call({}, { wrong: true })).statusCode).toBe(401);
    expect((await call({ 'content-type': 'application/json' }, '{not json')).statusCode).toBe(401);
  });

  it.each(Object.entries(tokens.forged()))('answers 401 to a direct call with a forged token: %s (P0-010, FR-13)', async (_label, token) => {
    const { call, closeMonth } = await serve();

    expect((await call(auth(token))).statusCode).toBe(401);
    expect(closeMonth).not.toHaveBeenCalled();
  });

  it('runs the handler with the verified principal for a valid token with every permission', async () => {
    const { call, seen } = await serve();
    const response = await call(auth(tokens.valid({ sub: USER_A, perms: [...ALL_PERMS, 'other:thing'] })));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ closedBy: USER_A });
    expect(seen[0]?.principal).toMatchObject({ subject: USER_A, permissions: [...ALL_PERMS, 'other:thing'] });
  });

  it('validates the body after the token: an authenticated invalid body is 400', async () => {
    const { call } = await serve();

    expect((await call(auth(tokens.valid({ perms: ALL_PERMS })), { wrong: true })).statusCode).toBe(400);
  });
});

describe('identity and permissions (Story 2.4, AC 5, AC 7)', () => {
  it('ignores identity headers: the call is user A whatever x-user-id, x-claims or Tecton-On-Behalf-Of say (P0-013)', async () => {
    const { call, seen } = await serve();
    const response = await call({
      ...auth(tokens.valid({ sub: USER_A, perms: ALL_PERMS })),
      'x-user-id': 'user-b',
      'x-claims': JSON.stringify({ sub: 'user-b', perms: ['admin:*'] }),
      'tecton-on-behalf-of': 'user-b',
    });

    expect(response.json()).toEqual({ closedBy: USER_A });
    expect(seen[0]?.principal?.subject).toBe(USER_A);
  });

  it.each([
    ['none of them', []],
    ['only one of two required', ['finance:close']],
    ['a similar name', ['finance:close', 'finance:audits']],
  ])('answers 403 with %s (every listed permission is required) (P0-013)', async (_label, perms) => {
    const { call, closeMonth } = await serve();
    const response = await call(auth(tokens.valid({ perms })));

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ status: 403, slug: 'forbidden' });
    expect(response.body).not.toContain('finance:audit');
    expect(closeMonth).not.toHaveBeenCalled();
  });

  it('hands each handler its own copy of the principal, even from a verifier that reuses one object', async () => {
    const shared = { subject: USER_A, permissions: [...ALL_PERMS], tokenId: 't', issuedAt: NOW, expiresAt: NOW };
    const { call, seen } = await serve({ verifier: { verify: async () => shared } });
    await call(auth('x'));
    seen[0]?.principal?.permissions.push('injected');
    await call(auth('x'));

    expect(seen[1]?.principal?.permissions).toEqual(ALL_PERMS);
    expect(shared.permissions).toEqual(ALL_PERMS);
  });
});

describe('public actions (Story 2.4, AC 8)', () => {
  it('runs without a token, and ignores an invalid one without verifying it (P0-013)', async () => {
    const verify = vi.fn(async () => Promise.reject(new InvalidTokenError()));
    const { app, status } = await serve({ verifier: { verify } });

    expect((await app.inject({ method: 'POST', url: '/finance/status' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/finance/status', headers: auth('garbage') })).statusCode).toBe(200);
    expect(status).toHaveBeenCalledTimes(2);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('verification unavailable (Story 2.4, AC 4)', () => {
  it('answers 503 with Retry-After when the JWKS cannot be fetched, never running the handler (P0-014)', async () => {
    const unreachable = createTokenVerifier({ revocations, jwksUrl: 'https://127.0.0.1:1/auth/.well-known/jwks.json', clock: createTestClock(NOW) });
    const { call, closeMonth } = await serve({ verifier: unreachable });
    const response = await call(auth(tokens.valid({ perms: ALL_PERMS })));

    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.json()).toMatchObject({ status: 503, slug: 'auth-unavailable' });
    expect(closeMonth).not.toHaveBeenCalled();
  });

  it('answers 500 for an unexpected verifier failure, never running the handler', async () => {
    const { call, closeMonth } = await serve({ verifier: { verify: async () => Promise.reject(new Error('boom')) } });

    expect((await call(auth('x'))).statusCode).toBe(500);
    expect(closeMonth).not.toHaveBeenCalled();
  });
});

describe('registration (Story 2.4, AC 10)', () => {
  it('refuses to register protected actions without a verifier, naming them', () => {
    const app = createTectonServer();
    servers.push(app);

    expect(() => registerActionRoutes(app, FINANCE, {})).toThrow(/closeMonth.*no token verifier/);
  });

  it('registers a manifest with only public actions without a verifier', async () => {
    const app = createTectonServer();
    servers.push(app);
    const PUBLIC = manifestOf(`manifestVersion: "0.1"
domain: ping
version: 0.1.0
description: "Ping."
actions:
  - name: ping
    description: "Answers."
    input: {}
    output: { ok: boolean }
    auth: { public: true }
`);

    expect(() => registerActionRoutes(app, PUBLIC, { ping: async () => ({ ok: true }) })).not.toThrow();
  });
});

describe('secrets (Story 2.4)', () => {
  it('never logs the token or echoes it in an error body', async () => {
    const { call, logs } = await serve();
    const valid = tokens.valid({ perms: [] });
    const forged = tokens.forged()['tampered payload'] as string;
    const responses = [await call(auth(valid)), await call(auth(forged))];

    assertNoSecretsLeaked(logs(), { valid, forged });
    assertNoSecretsLeaked(responses.map((response) => response.body).join(''), { valid, forged });
  });
});

describe('review fixes (Story 2.4 review)', () => {
  it('logs why verification is unavailable, without the token (P7)', async () => {
    const unreachable = createTokenVerifier({ revocations, jwksUrl: 'https://127.0.0.1:1/auth/.well-known/jwks.json', clock: createTestClock(NOW) });
    const { call, logs } = await serve({ verifier: unreachable });
    const token = tokens.valid({ perms: ALL_PERMS });

    expect((await call(auth(token))).statusCode).toBe(503);
    expect(logs()).toContain('token verification unavailable');
    expect(logs()).toContain('ECONNREFUSED');
    assertNoSecretsLeaked(logs(), { token });
  });

  it('refuses a hand-built manifest whose protected action requires no permission (P11)', () => {
    const app = createTectonServer();
    servers.push(app);
    const action = FINANCE.actions[0] as (typeof FINANCE.actions)[number];
    const unguarded = { ...FINANCE, actions: [{ ...action, auth: { requires: [] } }] };

    expect(() => registerActionRoutes(app, unguarded, {}, { verifier: { verify: async () => Promise.reject(new InvalidTokenError()) } })).toThrow(
      /must be public or require permissions: closeMonth/,
    );
  });

  it('copies the dates of the principal too (P13)', async () => {
    const shared = { subject: USER_A, permissions: [...ALL_PERMS], tokenId: 't', issuedAt: new Date(NOW), expiresAt: new Date(NOW) };
    const { call, seen } = await serve({ verifier: { verify: async () => shared } });
    await call(auth('x'));
    seen[0]?.principal?.expiresAt.setTime(0);

    expect(shared.expiresAt).toEqual(NOW);
  });
});

describe('revocation through the routes (Story 2.5, AC 2, AC 4)', () => {
  it('answers 401 to a revoked token and 503 when the revocation store is down', async () => {
    const store = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('revocation store unavailable: timeout'), () => NOW);
    const verifier = createTokenVerifier({ revocations: store, jwksUrl: jwks.url, ca: jwks.ca, clock: createTestClock(NOW) });
    const { call, closeMonth, logs } = await serve({ verifier });
    const token = tokens.valid({ jti: 'jti-revoked', perms: ALL_PERMS });

    expect((await call(auth(token))).statusCode).toBe(200);
    await store.revokeToken({ tokenId: 'jti-revoked', expiresAt: new Date(NOW.getTime() + 900_000) });
    expect((await call(auth(token))).statusCode).toBe(401);

    store.setUnavailable(true);
    const down = await call(auth(tokens.valid({ perms: ALL_PERMS })));
    expect(down.statusCode).toBe(503);
    expect(down.headers['retry-after']).toBe('5');
    expect(logs()).toContain('revocation could not be checked');
    expect(closeMonth).toHaveBeenCalledTimes(1);
  });
});
