import { createArgon2idAuthProvider, type AuthProvider, LoginLockoutUnavailableError } from '@tecton/providers';
import { createMemoryLoginLockout, createTestClock } from '#test-support';
import { describe, expect, it, vi } from 'vitest';
import type { AccessTokenIssuer } from './access-token.js';
import type { Credential } from './credential.js';
import type { CredentialStore } from './credential-store.js';
import { InvalidCredentialsError, login, LoginLockedError } from './login.js';
import { createMemoryRefreshTokenStore } from './memory-refresh-token-store.test-helper.js';

const PASSWORD = 'alice-password-123';
const realAuth = createArgon2idAuthProvider({
  peppers: [{ id: '1', key: Buffer.from('login-test-pepper-with-32-bytes-ok!', 'utf8') }],
  currentPepperId: '1',
});

async function setup(options: { status?: 'active' | 'disabled'; auth?: AuthProvider } = {}) {
  const auth = options.auth ?? realAuth;
  const credential: Credential = {
    id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
    login: 'alice',
    passwordHash: await realAuth.hashPassword(PASSWORD),
    status: options.status ?? 'active',
    permissions: ['tenant:create'],
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const updates: Array<{ id: string; hash: string }> = [];
  const store: CredentialStore = {
    count: async () => 1,
    findByLogin: async (value) => (value === credential.login ? credential : undefined),
    findById: async (id) => (id === credential.id ? credential : undefined),
    create: async () => undefined,
    createIfEmpty: async () => false,
    updatePasswordHash: async (id, hash) => {
      updates.push({ id, hash });
      return true;
    },
    close: async () => undefined,
  };
  const issuer: AccessTokenIssuer = {
    issuer: 'urn:tecton:auth',
    audience: 'urn:tecton:api',
    issue: async (issuedFor) => ({ accessToken: `token-for-${issuedFor.id}`, tokenType: 'Bearer', expiresIn: 900 }),
  };
  const dummyHash = await realAuth.hashPassword('dummy-password-value');
  const refresh = createMemoryRefreshTokenStore();
  const clock = createTestClock();
  const lockout = createMemoryLoginLockout(() => new LoginLockoutUnavailableError('down'), () => clock.now());
  const deps = { store, auth, issuer, clock, dummyHash, refreshTokens: refresh.store, refreshTtlSeconds: 604_800, lockout };
  return { deps, updates, credential, refresh, lockout, clock };
}

describe('login (AC 1, AC 2)', () => {
  it('issues a token for the right password, normalizing the login, and opens a refresh family (Story 2.3)', async () => {
    const { deps, refresh } = await setup();

    const result = await login(deps, { login: '  ALICE ', password: PASSWORD });
    expect(result.access).toEqual({
      accessToken: 'token-for-0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(result.refresh.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(refresh.families()).toEqual([expect.objectContaining({ credentialId: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f', expiresAt: result.refresh.expiresAt })]);
  });

  it('opens no refresh family when the login is refused', async () => {
    const { deps, refresh } = await setup();

    await login(deps, { login: 'alice', password: 'wrong-password-123' }).catch(() => undefined);
    expect(refresh.families()).toEqual([]);
  });

  it.each([
    ['an unknown login', { login: 'nobody', password: PASSWORD }, 'active'],
    ['a wrong password', { login: 'alice', password: 'wrong-password-123' }, 'active'],
    ['a disabled credential', { login: 'alice', password: PASSWORD }, 'disabled'],
    ['a malformed login', { login: `al${String.fromCodePoint(0x200b)}ice`, password: PASSWORD }, 'active'],
  ] as const)('refuses %s with the same error after exactly one Argon2id verification', async (_label, request, status) => {
    const spy = { verifyPassword: vi.fn(realAuth.verifyPassword), hashPassword: vi.fn(realAuth.hashPassword) };
    const { deps } = await setup({ status, auth: spy });

    const error = await login(deps, request).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidCredentialsError);
    expect((error as Error).message).toBe('invalid credentials');
    expect(spy.verifyPassword).toHaveBeenCalledTimes(1);
  });

  it('verifies an unknown login against the dummy hash (same Argon2id cost)', async () => {
    const spy = { verifyPassword: vi.fn(realAuth.verifyPassword), hashPassword: vi.fn(realAuth.hashPassword) };
    const { deps } = await setup({ auth: spy });

    await login(deps, { login: 'nobody', password: PASSWORD }).catch(() => undefined);
    expect(spy.verifyPassword).toHaveBeenCalledWith(PASSWORD, deps.dummyHash);
  });

  it('re-hashes when the stored hash needs it, and a failing re-hash does not stop the login', async () => {
    const needsRehash: AuthProvider = {
      hashPassword: async () => 'new-hash',
      verifyPassword: async () => ({ valid: true, needsRehash: true }),
    };
    const { deps, updates } = await setup({ auth: needsRehash });

    await login(deps, { login: 'alice', password: PASSWORD });
    expect(updates).toEqual([{ id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f', hash: 'new-hash' }]);

    const onRehashFailure = vi.fn();
    deps.store.updatePasswordHash = async () => {
      throw new Error('database down');
    };
    await expect(login({ ...deps, onRehashFailure }, { login: 'alice', password: PASSWORD })).resolves.toMatchObject({ access: { tokenType: 'Bearer' } });
    expect(onRehashFailure).toHaveBeenCalledOnce();
  });

  it('does not re-hash when the hash is current', async () => {
    const { deps, updates } = await setup();

    await login(deps, { login: 'alice', password: PASSWORD });
    expect(updates).toEqual([]);
  });
});

describe('login lockout (Story 2.6, AC 1 to 6)', () => {
  const tooMany = async (deps: Awaited<ReturnType<typeof setup>>['deps'], loginValue: string, times: number, password = 'wrong-password-123') => {
    for (let i = 0; i < times; i += 1) await login(deps, { login: loginValue, password }).catch(() => undefined);
  };

  it('locks after 5 failures: then even the right password is refused before any lookup or Argon2id', async () => {
    const spy = { verifyPassword: vi.fn(realAuth.verifyPassword), hashPassword: vi.fn(realAuth.hashPassword) };
    const { deps } = await setup({ auth: spy });
    const findByLogin = vi.spyOn(deps.store, 'findByLogin');
    await tooMany(deps, 'alice', 5);
    findByLogin.mockClear();
    spy.verifyPassword.mockClear();

    const error = await login(deps, { login: 'alice', password: PASSWORD }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LoginLockedError);
    expect((error as LoginLockedError).retryAfterSeconds).toBe(900);
    expect(findByLogin).not.toHaveBeenCalled();
    expect(spy.verifyPassword).not.toHaveBeenCalled();
  });

  it('answers the attempt that reaches the limit with the usual refusal, and reports the lock once', async () => {
    const { deps } = await setup();
    const onLocked = vi.fn();
    const withEvent = { ...deps, onLocked };
    await tooMany(withEvent, 'alice', 4);

    await expect(login(withEvent, { login: 'alice', password: 'wrong-password-123' })).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(onLocked).toHaveBeenCalledTimes(1);
    expect(onLocked).toHaveBeenCalledWith({ identifier: 'alice', lockSeconds: 900 });
  });

  it.each([
    ['an unknown login', 'nobody', 'active'],
    ['a disabled credential', 'alice', 'disabled'],
  ] as const)('counts %s like a wrong password (AC 3)', async (_label, loginValue, status) => {
    const { deps, lockout } = await setup({ status });
    await tooMany(deps, loginValue, 4, PASSWORD);

    expect(lockout.failures(loginValue)).toBe(4);
    await tooMany(deps, loginValue, 1, PASSWORD);
    await expect(login(deps, { login: loginValue, password: PASSWORD })).rejects.toBeInstanceOf(LoginLockedError);
  });

  it('counts the normalized identifier: case and spaces do not split the count', async () => {
    const { deps, lockout } = await setup();
    await login(deps, { login: 'Alice', password: 'wrong-password-123' }).catch(() => undefined);
    await login(deps, { login: '  ALICE ', password: 'wrong-password-123' }).catch(() => undefined);

    expect(lockout.failures('alice')).toBe(2);
  });

  it('does not count a malformed login, and never asks the lockout about it', async () => {
    const { deps, lockout } = await setup();
    const check = vi.spyOn(lockout, 'check');

    await expect(login(deps, { login: `al${String.fromCodePoint(0x200b)}ice`, password: PASSWORD })).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(check).not.toHaveBeenCalled();
  });

  it('clears the failures on success (AC 5)', async () => {
    const { deps, lockout } = await setup();
    await tooMany(deps, 'alice', 4);

    await login(deps, { login: 'alice', password: PASSWORD });
    expect(lockout.failures('alice')).toBe(0);
  });

  it('unlocks after the lock duration (clock)', async () => {
    const { deps, clock } = await setup();
    await tooMany(deps, 'alice', 5);
    clock.advance(900_000);

    await expect(login(deps, { login: 'alice', password: PASSWORD })).resolves.toMatchObject({ access: { tokenType: 'Bearer' } });
  });

  it('fails closed when the lockout is unavailable, before verifying the password (AC 8)', async () => {
    const spy = { verifyPassword: vi.fn(realAuth.verifyPassword), hashPassword: vi.fn(realAuth.hashPassword) };
    const { deps, lockout } = await setup({ auth: spy });
    lockout.setUnavailable(true);

    await expect(login(deps, { login: 'alice', password: PASSWORD })).rejects.toBeInstanceOf(LoginLockoutUnavailableError);
    expect(spy.verifyPassword).not.toHaveBeenCalled();
  });
});
