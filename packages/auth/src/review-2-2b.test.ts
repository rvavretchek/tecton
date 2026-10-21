import { Writable } from 'node:stream';
import { createArgon2idAuthProvider, RevocationStoreUnavailableError } from '@tecton/providers';
import { assertNoSecretsLeaked, createMemoryTokenRevocationStore, createTestClock, ed25519KeyPairPem } from '#test-support';
import { describe, expect, it, vi } from 'vitest';
import { AuthConfigError, previousPeppersFromEnv, signingKeysFromEnv, tokenSettingsFromEnv, listenSettingsFromEnv } from './adapters/env/config-from-env.js';
import { createAccessTokenIssuer } from './adapters/jose/access-token-issuer.js';
import { buildSigningKeys, SigningKeyConfigError } from './adapters/jose/signing-keys.js';
import { InvalidCredentialError, type Credential } from './core/credential.js';
import type { CredentialStore } from './core/credential-store.js';
import { login } from './core/login.js';
import { createMemoryRefreshTokenStore } from './core/memory-refresh-token-store.test-helper.js';
import { createAuthService, startAuthServiceFromEnv } from './service.js';

// Regression tests for the code review of Story 2.2b (2026-10-19), one block per finding.

const PEPPER = 'review-2-2b-test-pepper-32-bytes-ok!';
const PASSWORD = 'alice-password-123';
const auth = createArgon2idAuthProvider({ peppers: [{ id: '1', key: Buffer.from(PEPPER, 'utf8') }], currentPepperId: '1' });
const bs = String.fromCodePoint(92);

async function credentialOf(overrides: Partial<Credential> = {}): Promise<Credential> {
  return {
    id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
    login: 'alice',
    passwordHash: await auth.hashPassword(PASSWORD),
    status: 'active',
    permissions: ['tenant:create'],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function storeWith(rows: Record<string, Credential | Error>): CredentialStore {
  return {
    count: async () => Object.keys(rows).length,
    findByLogin: async (value) => {
      const row = rows[value];
      if (row instanceof Error) throw row;
      return row;
    },
    findById: async () => undefined,
    create: async () => undefined,
    createIfEmpty: async () => false,
    updatePasswordHash: async () => true,
    close: async () => undefined,
  };
}

async function serviceWith(rows: Record<string, Credential | Error>) {
  const keys = await buildSigningKeys({ privateKeyPem: ed25519KeyPairPem().privatePem });
  const clock = createTestClock();
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const app = await createAuthService({
    revocations: createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('down')), store: storeWith(rows), refreshTokens: createMemoryRefreshTokenStore().store, auth, issuer: createAccessTokenIssuer({ keys, clock }), keys, clock, logger: { level: 'info', stream } });
  return { app, logs: () => lines.join('') };
}

describe('P2: publishing the next signing key before it signs', () => {
  it('publishes next public keys in the JWKS without signing with them', async () => {
    const current = ed25519KeyPairPem();
    const next = ed25519KeyPairPem();
    const keys = await signingKeysFromEnv({ TECTON_AUTH_SIGNING_KEY: current.privatePem, TECTON_AUTH_NEXT_PUBLIC_KEYS: next.publicPem });
    const nextKid = (await buildSigningKeys({ privateKeyPem: next.privatePem })).current.kid;

    expect(keys.publicJwks.map((jwk) => jwk.kid)).toEqual([keys.current.kid, nextKid]);
    expect(keys.current.kid).not.toBe(nextKid);
  });
});

describe('P6: PEM values as they come from environments', () => {
  it('accepts a one-line PEM with literal \\n that also ends with a real newline, and the CRLF form', async () => {
    const { privatePem } = ed25519KeyPairPem();
    const lines = privatePem.trimEnd().split(String.fromCodePoint(10));

    await expect(signingKeysFromEnv({ TECTON_AUTH_SIGNING_KEY: `${lines.join(`${bs}n`)}${String.fromCodePoint(10)}` })).resolves.toBeDefined();
    await expect(signingKeysFromEnv({ TECTON_AUTH_SIGNING_KEY: lines.join(`${bs}r${bs}n`) })).resolves.toBeDefined();
  });

  it('accepts several one-line public keys separated by real newlines (one per line)', async () => {
    const oneLine = (pem: string) => pem.trimEnd().split(String.fromCodePoint(10)).join(`${bs}n`);
    const keys = await signingKeysFromEnv({
      TECTON_AUTH_SIGNING_KEY: ed25519KeyPairPem().privatePem,
      TECTON_AUTH_PREVIOUS_PUBLIC_KEYS: [oneLine(ed25519KeyPairPem().publicPem), oneLine(ed25519KeyPairPem().publicPem)].join(String.fromCodePoint(10)),
    });

    expect(keys.publicJwks).toHaveLength(3);
  });

  it.each([
    ['a truncated second block', (pem: string) => `${pem}${String.fromCodePoint(10)}-----BEGIN PUBLIC KEY-----${String.fromCodePoint(10)}MCowBQYDK2VwAyEA`],
    ['stray text', (pem: string) => `${pem}${String.fromCodePoint(10)}leftover`],
    ['a private key', () => ed25519KeyPairPem().privatePem],
  ])('refuses previous public keys with %s instead of dropping it', async (_label, build) => {
    const error = await signingKeysFromEnv({
      TECTON_AUTH_SIGNING_KEY: ed25519KeyPairPem().privatePem,
      TECTON_AUTH_PREVIOUS_PUBLIC_KEYS: build(ed25519KeyPairPem().publicPem),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SigningKeyConfigError);
  });
});

describe('P10, P11: strict settings', () => {
  it.each(['0x258', '6e2', '600.0', ' 600x'])('refuses the lifetime %j', (value) => {
    expect(() => tokenSettingsFromEnv({ TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS: value })).toThrow(AuthConfigError);
  });

  it.each(['0x50', '8e1'])('refuses the port %j', (value) => {
    expect(() => listenSettingsFromEnv({ PORT: value })).toThrow(AuthConfigError);
  });

  it('trims issuer and audience, and falls back to the defaults when they are blank', () => {
    expect(tokenSettingsFromEnv({ TECTON_AUTH_ISSUER: '   ', TECTON_AUTH_AUDIENCE: ' acme ' })).toMatchObject({ issuer: 'urn:tecton:auth', audience: 'acme' });
  });

  it('reports a missing database URL as an AuthConfigError, before reading anything else', async () => {
    await expect(startAuthServiceFromEnv({ TECTON_AUTH_DATABASE_URL: '  ' })).rejects.toBeInstanceOf(AuthConfigError);
  });

  it('reports a public key in place of the signing key as a SigningKeyConfigError naming the format', async () => {
    const start = startAuthServiceFromEnv({
      TECTON_AUTH_DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/auth',
      TECTON_AUTH_PEPPER: PEPPER,
      TECTON_AUTH_SIGNING_KEY: ed25519KeyPairPem().publicPem,
    });

    await expect(start).rejects.toBeInstanceOf(SigningKeyConfigError);
    await expect(start).rejects.toThrow('PKCS#8');
  });
});

describe('P1: previous Peppers from the environment', () => {
  it('reads them as a JSON object of id to value, never echoing a bad value', () => {
    expect(previousPeppersFromEnv({ TECTON_AUTH_PREVIOUS_PEPPERS: `{"old": "${PEPPER}"}` })).toEqual([{ id: 'old', key: Buffer.from(PEPPER, 'utf8') }]);
    expect(previousPeppersFromEnv({})).toEqual([]);
    const error = (() => {
      try {
        previousPeppersFromEnv({ TECTON_AUTH_PREVIOUS_PEPPERS: 'secret-pepper-not-json-value' });
      } catch (caught) {
        return caught as Error;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(AuthConfigError);
    assertNoSecretsLeaked(error?.message ?? '', { value: 'secret-pepper-not-json-value' });
  });

  it('keeps logins of hashes made with the previous Pepper working, and re-hashes them', async () => {
    const oldPepper = { id: 'old', key: Buffer.from('previous-pepper-value-32-bytes-ok!!', 'utf8') };
    const oldHash = await createArgon2idAuthProvider({ peppers: [oldPepper], currentPepperId: 'old' }).hashPassword(PASSWORD);
    const rotated = createArgon2idAuthProvider({ peppers: [{ id: '2', key: Buffer.from(PEPPER, 'utf8') }, oldPepper], currentPepperId: '2' });
    const updates: string[] = [];
    const store: CredentialStore = {
      ...storeWith({ alice: await credentialOf({ passwordHash: oldHash }) }),
      updatePasswordHash: async (_id, hash, _at, expected) => {
        expect(expected).toBe(oldHash);
        updates.push(hash);
        return true;
      },
    };
    const issuer = { issue: async () => ({ accessToken: 't', tokenType: 'Bearer' as const, expiresIn: 900 }) };

    await login({ store, auth: rotated, issuer, clock: createTestClock(), dummyHash: await rotated.hashPassword('dummy-123'), refreshTokens: createMemoryRefreshTokenStore().store, refreshTtlSeconds: 604_800 }, { login: 'alice', password: PASSWORD });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain('keyid=Mg');
  });
});

describe('P4, P9, P15: login responses', () => {
  it('marks every login response no-store and every 401 with WWW-Authenticate: Bearer', async () => {
    const { app } = await serviceWith({ alice: await credentialOf() });
    const ok = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'alice', password: PASSWORD } });
    const refused = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'alice', password: 'wrong-password-1' } });

    expect(ok.headers['cache-control']).toBe('no-store');
    expect(refused.headers['cache-control']).toBe('no-store');
    expect(refused.headers['www-authenticate']).toBe('Bearer');
    await app.close();
  });

  it('answers byte-identical 401s over HTTP for unknown, wrong password, disabled, malformed and corrupt logins', async () => {
    const { app, logs } = await serviceWith({
      alice: await credentialOf(),
      bob: await credentialOf({ login: 'bob', status: 'disabled' }),
      mallory: new InvalidCredentialError('invalid credential status "superuser"'),
    });
    const attempt = (body: object) => app.inject({ method: 'POST', url: '/auth/login', payload: body });
    const responses = await Promise.all([
      attempt({ login: 'nobody', password: PASSWORD }),
      attempt({ login: 'alice', password: 'wrong-password-1' }),
      attempt({ login: 'bob', password: PASSWORD }),
      attempt({ login: `al${String.fromCodePoint(0x200b)}ice`, password: PASSWORD }),
      attempt({ login: 'mallory', password: PASSWORD }),
    ]);
    const shape = (response: (typeof responses)[number]) => {
      const { date: _date, ...headers } = response.headers;
      return { status: response.statusCode, body: response.body, headers };
    };

    for (const response of responses) expect(shape(response)).toEqual(shape(responses[0] as (typeof responses)[number]));
    expect(responses[0]?.statusCode).toBe(401);
    expect(logs()).toContain('corrupt credential refused at login');
    await app.close();
  });

  it('answers 501 for serviceToken until Story 2.7', async () => {
    const { app } = await serviceWith({});

    expect((await app.inject({ method: 'POST', url: '/auth/service-token', payload: { serviceId: 'billing', secret: 'x' } })).statusCode).toBe(501);
    await app.close();
  });
});

describe('P12: conditional re-hash', () => {
  it('passes the hash it verified, so a password changed meanwhile is never overwritten', async () => {
    const needsRehash = { hashPassword: async () => 'new-hash', verifyPassword: async () => ({ valid: true, needsRehash: true }) };
    const credential = await credentialOf();
    const update = vi.fn(async () => false);
    const store: CredentialStore = { ...storeWith({ alice: credential }), updatePasswordHash: update };
    const issuer = { issue: async () => ({ accessToken: 't', tokenType: 'Bearer' as const, expiresIn: 900 }) };

    await login({ store, auth: needsRehash, issuer, clock: createTestClock(), dummyHash: 'd', refreshTokens: createMemoryRefreshTokenStore().store, refreshTtlSeconds: 604_800 }, { login: 'alice', password: PASSWORD });
    expect(update).toHaveBeenCalledWith(credential.id, 'new-hash', expect.any(Date), credential.passwordHash);
  });
});
