import { Writable } from 'node:stream';
import { parseManifest, type TectonManifest } from '@tecton/manifest';
import { assertNoSecretsLeaked, createMemoryTokenRevocationStore, createTestClock, createTestSigningKey, jwksTls, tokenFactory, type JwksTlsServer } from '#test-support';
import { RevocationStoreUnavailableError } from '@tecton/providers';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTokenVerifier, TokenVerificationUnavailableError, type Principal, type TokenVerifier } from './auth/token-verifier.js';
import { registerActionRoutes, type ActionContext } from './routes.js';
import { createTectonServer } from './server.js';

// Story 2.7b: calls between services (service token, Tecton-On-Behalf-Of, call:<domain>) and the
// AD-7 amendment of 2026-10-24 (a user token alone is refused unless directUserCalls).

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
    auth: { requires: [finance:close] }
  - name: status
    description: "Public status."
    input: {}
    output: { ok: boolean }
    auth: { public: true }
`);

const NOW = new Date('2026-10-24T12:00:00.000Z');
const USER = '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5a';
const revocations = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('revocation store unavailable: down'), () => NOW);
const key = createTestSigningKey();
const tokens = tokenFactory(key, { now: NOW });
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
  revocations.setUnavailable(false);
});

async function serve(options: { verifier?: TokenVerifier; directUserCalls?: boolean } = {}) {
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
  const real = createTokenVerifier({ revocations, jwksUrl: jwks.url, ca: jwks.ca, clock: createTestClock(NOW) });
  const verifier = options.verifier ?? real;
  const verify = vi.spyOn(verifier, 'verify');
  registerActionRoutes(app, FINANCE, { closeMonth }, { verifier, ...(options.directUserCalls === undefined ? {} : { directUserCalls: options.directUserCalls }) });
  await app.ready();
  const call = (headers: Record<string, string> = {}, url = '/finance/close-month') =>
    app.inject({ method: 'POST', url, headers, payload: url.endsWith('close-month') ? { month: '2026-10' } : {} });
  return { app, call, closeMonth, seen, verify, logs: () => lines.join('') };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const user = (perms: string[] = ['finance:close'], overrides = {}) => tokens.valid({ sub: USER, perms, ...overrides });
const billing = (perms: string[] = ['call:finance'], overrides = {}) => tokens.service('billing', { perms, ...overrides });
const onBehalfOf = (service: string, userToken: string) => ({ ...bearer(service), 'tecton-on-behalf-of': userToken });

describe('a service calling without a user (AC 1, AC 4)', () => {
  it('evaluates auth.requires against the service, with call:<domain>', async () => {
    const { call, seen } = await serve();

    const response = await call(bearer(billing(['call:finance', 'finance:close'])));

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ closedBy: 'service:billing' });
    expect(seen[0]?.principal).toMatchObject({ kind: 'service', subject: 'service:billing' });
    expect(seen[0]?.service).toMatchObject({ kind: 'service', subject: 'service:billing' });
    expect(seen[0]?.principal).not.toBe(seen[0]?.service);
  });

  it('answers 403 when the service lacks a permission of auth.requires', async () => {
    const { call, closeMonth } = await serve();

    expect((await call(bearer(billing(['call:finance'])))).statusCode).toBe(403);
    expect(closeMonth).not.toHaveBeenCalled();
  });
});

describe('a service calling on behalf of a user (AC 3)', () => {
  it('evaluates auth.requires against the user, never the service', async () => {
    const { call, seen } = await serve();

    const allowed = await call(onBehalfOf(billing(['call:finance']), user(['finance:close'])));
    const refused = await call(onBehalfOf(billing(['call:finance', 'finance:close']), user([])));

    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ closedBy: USER });
    expect(seen[0]?.principal).toMatchObject({ kind: 'user', subject: USER, permissions: ['finance:close'] });
    expect(seen[0]?.service).toMatchObject({ kind: 'service', subject: 'service:billing' });
    expect(refused.statusCode).toBe(403);
  });
});

describe('call:<domain> (AC 2, P0-020)', () => {
  it.each([
    ['without a user', (service: string) => bearer(service)],
    ['with a valid user', (service: string) => onBehalfOf(service, user())],
  ])('answers 403 to a service without call:finance %s, and logs it without tokens', async (_name, headers) => {
    const { call, closeMonth, logs } = await serve();
    const service = billing(['call:catalog', 'finance:close']);

    const response = await call(headers(service));

    expect(response.statusCode).toBe(403);
    expect(closeMonth).not.toHaveBeenCalled();
    expect(logs()).toMatch(/"event":"service_call_refused","caller":"service:billing","domain":"finance"/);
    assertNoSecretsLeaked(logs(), { service });
  });
});

describe('a token refused (AC 5, P0-019)', () => {
  it.each(Object.entries(tokens.forged()))('answers 401 to a forged user token in Tecton-On-Behalf-Of: %s', async (_label, forged) => {
    const { call, closeMonth } = await serve();

    expect((await call(onBehalfOf(billing(), forged))).statusCode).toBe(401);
    expect(closeMonth).not.toHaveBeenCalled();
  });

  it.each([
    ['expired service token', () => onBehalfOf(billing(['call:finance'], { iat: Math.floor(NOW.getTime() / 1000) - 3600, exp: Math.floor(NOW.getTime() / 1000) - 60 }), user())],
    ['expired user token', () => onBehalfOf(billing(), user(['finance:close'], { iat: Math.floor(NOW.getTime() / 1000) - 3600, exp: Math.floor(NOW.getTime() / 1000) - 60 }))],
    ['service token in Tecton-On-Behalf-Of', () => onBehalfOf(billing(), tokens.service('catalog', { perms: ['finance:close'] }))],
    ['empty Tecton-On-Behalf-Of', () => onBehalfOf(billing(), '')],
    ['blank Tecton-On-Behalf-Of', () => onBehalfOf(billing(), '   ')],
    ['Bearer in Tecton-On-Behalf-Of', () => onBehalfOf(billing(), `Bearer ${user()}`)],
    ['repeated Tecton-On-Behalf-Of', () => onBehalfOf(billing(), `${user()}, ${user()}`)],
    ['too long Tecton-On-Behalf-Of', () => onBehalfOf(billing(), 'a'.repeat(8193))],
  ])('answers 401 to %s', async (_name, headers) => {
    const { call, closeMonth } = await serve();

    expect((await call(headers())).statusCode).toBe(401);
    expect(closeMonth).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['with Bearer', 'Bearer a.b.c'],
    ['repeated', 'a.b.c, d.e.f'],
    ['too long', 'a'.repeat(8193)],
  ])('refuses a %s Tecton-On-Behalf-Of before verifying it', async (_name, value) => {
    const { call, verify } = await serve();

    expect((await call(onBehalfOf(billing(), value))).statusCode).toBe(401);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('answers 401 to a revoked service token and to a revoked user token', async () => {
    // Subjects of their own: the revocation store is shared by every test of this file.
    const revokedUser = '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e7e';
    const { call } = await serve();
    const service = tokens.service('ledger', { perms: ['call:finance', 'finance:close'] });
    const userToken = user(['finance:close'], { sub: revokedUser });
    expect((await call(onBehalfOf(service, userToken))).statusCode).toBe(200);

    await revocations.revokeSubject({ subject: revokedUser, at: NOW });
    expect((await call(onBehalfOf(service, userToken))).statusCode).toBe(401);
    // Rotation of the service credential (Story 2.7a) revokes its subject.
    expect((await call(bearer(service))).statusCode).toBe(200);
    await revocations.revokeSubject({ subject: 'service:ledger', at: NOW });
    expect((await call(bearer(service))).statusCode).toBe(401);
  });

  it('answers the same 401 whichever token failed', async () => {
    const { call } = await serve();
    const responses = [
      await call(onBehalfOf(tokens.forged()['tampered signature'] as string, user())),
      await call(onBehalfOf(billing(), tokens.forged()['tampered signature'] as string)),
      await call(onBehalfOf(billing(), tokens.service('catalog'))),
      await call(bearer(user())),
    ];
    const shape = (response: (typeof responses)[number]) => {
      const { date: _date, 'request-id': _id, ...headers } = response.headers;
      return { status: response.statusCode, body: response.body, headers };
    };

    for (const response of responses) expect(shape(response)).toEqual(shape(responses[0] as (typeof responses)[number]));
    expect(responses[0]?.headers['www-authenticate']).toBe('Bearer');
  });

  it('answers 401, not 403, to a service without call: with an invalid user (every token check first)', async () => {
    const { call } = await serve();

    expect((await call(onBehalfOf(billing(['call:catalog']), 'not-a-token'))).statusCode).toBe(401);
  });

  it('answers 503 when the user token cannot be verified (revocation store down)', async () => {
    const { call } = await serve();
    const service = billing();
    let calls = 0;
    const isRevoked = revocations.isRevoked.bind(revocations);
    revocations.isRevoked = async (token) => {
      calls += 1;
      if (calls === 2) throw new RevocationStoreUnavailableError('revocation store unavailable: down');
      return isRevoked(token);
    };
    try {
      const response = await call(onBehalfOf(service, user()));
      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBe('5');
    } finally {
      revocations.isRevoked = isRevoked;
    }
  });

  it('checks in sequence: an invalid service token is 401 even when the user token could not be verified', async () => {
    const { InvalidTokenError } = await import('./auth/token-verifier.js');
    let calls = 0;
    const verifier: TokenVerifier = {
      verify: async () => {
        calls += 1;
        if (calls === 1) throw new InvalidTokenError();
        throw new TokenVerificationUnavailableError('down');
      },
    };
    const { call } = await serve({ verifier });

    expect((await call(onBehalfOf('a.b.c', 'd.e.f'))).statusCode).toBe(401);
    expect(calls).toBe(1);
  });
});

describe('a user token alone (AD-7 amendment, AC 7)', () => {
  it('is refused with 401 by default', async () => {
    const { call, closeMonth } = await serve();

    expect((await call(bearer(user()))).statusCode).toBe(401);
    expect(closeMonth).not.toHaveBeenCalled();
  });

  it('is accepted as in Story 2.4 with directUserCalls, without call: and ignoring Tecton-On-Behalf-Of', async () => {
    const { call, seen, verify } = await serve({ directUserCalls: true });

    const response = await call({ ...bearer(user()), 'tecton-on-behalf-of': tokens.valid({ sub: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4eff', perms: ['finance:close'] }) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ closedBy: USER });
    expect(seen[0]?.service).toBeUndefined();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('never verifies a token on a public action', async () => {
    const { call, verify } = await serve();

    // No handler: 501, but only after skipping every token check.
    expect((await call(onBehalfOf(billing(), user()), '/finance/status')).statusCode).toBe(501);
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('principals handed to the handler (AC 6)', () => {
  it('fails closed on a verifier that gives no kind', async () => {
    const { call } = await serve({
      verifier: { verify: async () => ({ subject: USER, permissions: ['finance:close'], tokenId: 't', issuedAt: NOW, expiresAt: NOW }) as unknown as Principal },
      directUserCalls: true,
    });

    expect((await call(bearer('x'))).statusCode).toBe(401);
  });

  it('gives each handler its own copies of principal and service', async () => {
    const shared: Principal = { kind: 'service', subject: 'service:billing', permissions: ['call:finance', 'finance:close'], tokenId: 't', issuedAt: new Date(NOW), expiresAt: new Date(NOW) };
    const { call, seen } = await serve({ verifier: { verify: async () => shared } });
    await call(bearer('x'));
    seen[0]?.principal?.permissions.push('injected');
    seen[0]?.service?.expiresAt.setTime(0);
    await call(bearer('x'));

    expect(seen[1]?.principal?.permissions).toEqual(['call:finance', 'finance:close']);
    expect(seen[1]?.service?.expiresAt).toEqual(NOW);
    expect(shared.permissions).toEqual(['call:finance', 'finance:close']);
  });

  it('never logs either token', async () => {
    const { call, logs } = await serve();
    const service = billing();
    const userToken = user();

    await call(onBehalfOf(service, userToken));
    await call(onBehalfOf(service, `${userToken}x`));

    assertNoSecretsLeaked(logs(), { service, userToken });
  });
});
