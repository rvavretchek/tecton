import { Writable } from 'node:stream';
import { createArgon2idAuthProvider, LoginLockoutUnavailableError, RevocationStoreUnavailableError } from '@tecton/providers';
import { assertNoSecretsLeaked, createMemoryLoginLockout, createMemoryTokenRevocationStore, createTestClock, ed25519KeyPairPem } from '#test-support';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccessTokenIssuer } from './adapters/jose/access-token-issuer.js';
import { buildSigningKeys } from './adapters/jose/signing-keys.js';
import type { Credential } from './core/credential.js';
import type { CredentialStore } from './core/credential-store.js';
import { createMemoryRefreshTokenStore } from './core/memory-refresh-token-store.test-helper.js';
import { createAuthService, LOG_REDACTION, type AuthServiceApp } from './service.js';

const PEPPER = 'lockout-test-pepper-with-32-bytes-ok';
const PASSWORD = 'alice-password-123';
const WRONG = 'wrong-password-123';
const auth = createArgon2idAuthProvider({ peppers: [{ id: '1', key: Buffer.from(PEPPER, 'utf8') }], currentPepperId: '1' });
const apps: AuthServiceApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

async function service() {
  const keys = await buildSigningKeys({ privateKeyPem: ed25519KeyPairPem().privatePem });
  const credential: Credential = {
    id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
    login: 'alice',
    passwordHash: await auth.hashPassword(PASSWORD),
    status: 'active',
    permissions: [],
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
  const lockout = createMemoryLoginLockout(() => new LoginLockoutUnavailableError('login lockout unavailable: down'), () => clock.now());
  const verify = vi.spyOn(auth, 'verifyPassword');
  const app = await createAuthService({
    store,
    refreshTokens: createMemoryRefreshTokenStore().store,
    revocations: createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('down'), () => clock.now()),
    lockout,
    auth,
    issuer: createAccessTokenIssuer({ keys, clock }),
    keys,
    clock,
    logger: { level: 'trace', redact: LOG_REDACTION, stream },
  });
  apps.push(app);
  const attempt = (login: string, password: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/auth/login', payload: { login, password }, headers });
  return { app, clock, lockout, attempt, verify, logs: () => lines.join('') };
}

const strip = ({ date: _date, ...rest }: Record<string, unknown>) => rest;

describe('POST /auth/login lockout (Story 2.6, P0-016)', () => {
  it('answers 429 with Retry-After after 5 failures, even with the right password (AC 1, AC 2)', async () => {
    const { attempt, verify } = await service();
    for (let i = 0; i < 5; i += 1) expect((await attempt('alice', WRONG)).statusCode).toBe(401);
    verify.mockClear();

    const locked = await attempt('alice', PASSWORD);

    expect(locked.statusCode).toBe(429);
    expect(locked.headers['retry-after']).toBe('900');
    expect(locked.json()).toMatchObject({ status: 429, slug: 'too-many-requests' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('gives an unknown login the same sequence of responses as an existing one (AC 3)', async () => {
    const existing = await service();
    const unknown = await service();
    const sequence = async (s: Awaited<ReturnType<typeof service>>, login: string) => {
      const responses = [];
      for (let i = 0; i < 6; i += 1) responses.push(await s.attempt(login, WRONG));
      return responses.map((response) => ({ status: response.statusCode, body: response.body, headers: strip(response.headers) }));
    };

    expect(await sequence(unknown, 'nobody')).toEqual(await sequence(existing, 'alice'));
  });

  it('counts per identifier whatever the origin (AC 4)', async () => {
    const { attempt } = await service();
    for (let i = 0; i < 5; i += 1) await attempt('alice', WRONG, { 'x-forwarded-for': `203.0.113.${i + 1}` });

    expect((await attempt('alice', PASSWORD, { 'x-forwarded-for': '198.51.100.7' })).statusCode).toBe(429);
  });

  it('clears the count on success and unlocks when the lock expires (AC 5)', async () => {
    const { attempt, clock } = await service();
    for (let i = 0; i < 4; i += 1) await attempt('alice', WRONG);
    expect((await attempt('alice', PASSWORD)).statusCode).toBe(200);
    for (let i = 0; i < 4; i += 1) await attempt('alice', WRONG);
    expect((await attempt('alice', PASSWORD)).statusCode).toBe(200);

    for (let i = 0; i < 5; i += 1) await attempt('alice', WRONG);
    expect((await attempt('alice', PASSWORD)).statusCode).toBe(429);
    clock.advance(900_000);
    expect((await attempt('alice', PASSWORD)).statusCode).toBe(200);
  });

  it('logs the lock as a security event, with the identifier and without any password (AC 6)', async () => {
    const { attempt, logs } = await service();
    for (let i = 0; i < 5; i += 1) await attempt('Alice', WRONG);

    const events = logs()
      .split('\n')
      .filter((line) => line.includes('auth.login.locked'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toEqual([expect.objectContaining({ level: 40, identifier: 'alice', lockSeconds: 900 })]);
    assertNoSecretsLeaked(logs(), { wrong: WRONG, password: PASSWORD, pepper: PEPPER });
  });

  it('refuses with 503 and Retry-After, without verifying the password, when the lockout is unavailable (AC 8)', async () => {
    const { attempt, lockout, verify } = await service();
    lockout.setUnavailable(true);

    const response = await attempt('alice', PASSWORD);

    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(verify).not.toHaveBeenCalled();
  });
});
