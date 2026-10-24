import { Writable } from 'node:stream';
import { parseManifest, type TectonManifest } from '@tecton/manifest';
import { assertNoSecretsLeaked, createMemoryTokenRevocationStore, createTestClock, createTestSigningKey, jwksTls, tokenFactory, type JwksTlsServer } from '#test-support';
import { RevocationStoreUnavailableError } from '@tecton/providers';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTokenVerifier, InvalidTokenError, TokenVerificationUnavailableError, type Principal, type TokenVerifier } from './auth/token-verifier.js';
import { registerActionRoutes, requireUser, type ActionContext } from './routes.js';
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

  it('answers 503 when the revocation of the user token cannot be checked', async () => {
    const { call } = await serve();
    const service = billing();
    const userToken = user(['finance:close'], { jti: 'user-revocation-down' });
    const isRevoked = revocations.isRevoked.bind(revocations);
    // Down only for the user token, whatever the order of the checks.
    revocations.isRevoked = async (token) => {
      if (token.tokenId === 'user-revocation-down') throw new RevocationStoreUnavailableError('revocation store unavailable: down');
      return isRevoked(token);
    };
    try {
      const response = await call(onBehalfOf(service, userToken));
      expect(response.statusCode).toBe(503);
      expect(response.headers['retry-after']).toBe('5');
    } finally {
      revocations.isRevoked = isRevoked;
    }
  });

  it('answers 503 when the keys for the user token cannot be fetched (review P7)', async () => {
    // Keyed on the token: the service token verifies, the user token finds the JWKS unavailable.
    const service: Principal = { kind: 'service', subject: 'service:billing', permissions: ['call:finance', 'finance:close'], tokenId: 's', issuedAt: NOW, expiresAt: NOW };
    const verifier: TokenVerifier = {
      verify: async (authorization) => {
        if (authorization === 'Bearer service.token.value') return service;
        throw new TokenVerificationUnavailableError('the JWKS could not be used: timeout');
      },
    };
    const { call, closeMonth } = await serve({ verifier });

    const response = await call(onBehalfOf('service.token.value', 'user.token.value'));

    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(closeMonth).not.toHaveBeenCalled();
  });

  it('checks in sequence: an invalid service token is 401 even when the user token could not be verified', async () => {
    const seen: string[] = [];
    const verifier: TokenVerifier = {
      verify: async (authorization) => {
        seen.push(String(authorization));
        if (authorization === 'Bearer a.b.c') throw new InvalidTokenError();
        throw new TokenVerificationUnavailableError('down');
      },
    };
    const { call } = await serve({ verifier });

    expect((await call(onBehalfOf('a.b.c', 'd.e.f'))).statusCode).toBe(401);
    expect(seen).toEqual(['Bearer a.b.c']);
  });

  // P9: forgeries shaped as service tokens, in Authorization.
  it.each([
    ['tampered signature', () => {
      const [h, p, s] = billing().split('.') as [string, string, string];
      return `${h}.${p}.${s.slice(0, 10)}${s[10] === 'A' ? 'B' : 'A'}${s.slice(11)}`;
    }],
    ['other signing key', () => tokenFactory(createTestSigningKey(key.kid), { now: NOW }).service('billing', { perms: ['call:finance', 'finance:close'] })],
    ['wrong audience', () => billing(['call:finance', 'finance:close'], { aud: 'urn:other:api' })],
    ['wrong issuer', () => billing(['call:finance', 'finance:close'], { iss: 'urn:evil:auth' })],
    ['expired', () => billing(['call:finance', 'finance:close'], { iat: Math.floor(NOW.getTime() / 1000) - 3600, exp: Math.floor(NOW.getTime() / 1000) - 60 })],
    ['alg none', () => {
      const [, p] = billing().split('.') as [string, string, string];
      return `${Buffer.from(JSON.stringify({ alg: 'none', kid: key.kid, typ: 'at+jwt' })).toString('base64url')}.${p}.`;
    }],
  ])('answers 401 to a forged service token in Authorization: %s', async (_name, forge) => {
    const { call, closeMonth } = await serve();

    expect((await call(bearer(forge()))).statusCode).toBe(401);
    expect((await call(onBehalfOf(forge(), user()))).statusCode).toBe(401);
    expect(closeMonth).not.toHaveBeenCalled();
  });

  // P8: no token in any error body.
  it('never echoes either token in an error body (401, 403, 503)', async () => {
    const { call } = await serve();
    const service = billing(['call:catalog']);
    const userToken = user();
    const bodies = [
      (await call(onBehalfOf(service, `${userToken}x`))).body,
      (await call(onBehalfOf(service, userToken))).body,
      (await call(bearer(userToken))).body,
    ];
    revocations.setUnavailable(true);
    bodies.push((await call(onBehalfOf(billing(), userToken))).body);

    assertNoSecretsLeaked(bodies.join('\n'), { service, userToken });
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

describe('principals checked again by the routes (review P3)', () => {
  it.each([
    ['a service kind with a user subject', { kind: 'service', subject: USER }],
    ['a service kind with an invalid domain', { kind: 'service', subject: 'service:Bad_Domain' }],
    ['a user kind with a service subject', { kind: 'user', subject: 'service:billing' }],
    ['a user kind with an empty subject', { kind: 'user', subject: '' }],
  ])('refuses %s from a verifier written by hand', async (_name, shape) => {
    const principal = { permissions: ['call:finance', 'finance:close'], tokenId: 't', issuedAt: NOW, expiresAt: NOW, ...shape } as Principal;
    const { call } = await serve({ verifier: { verify: async () => principal }, directUserCalls: true });

    expect((await call(bearer('x'))).statusCode).toBe(401);
  });
});

describe('requireUser (review P5)', () => {
  const context = (principal?: Principal) => ({ principal }) as unknown as ActionContext;
  const base = { permissions: [], tokenId: 't', issuedAt: NOW, expiresAt: NOW };

  it('returns the user', () => {
    const principal: Principal = { kind: 'user', subject: USER, ...base };

    expect(requireUser(context(principal))).toBe(principal);
  });

  it.each([
    ['a service without a user', { kind: 'service', subject: 'service:billing', ...base } as Principal],
    ['no principal', undefined],
    ['a user kind with a service subject', { kind: 'user', subject: 'service:billing', ...base } as Principal],
  ])('answers 403 to %s', (_name, principal) => {
    expect(() => requireUser(context(principal))).toThrow(expect.objectContaining({ status: 403 }));
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
