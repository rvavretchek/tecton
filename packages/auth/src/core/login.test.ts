import { createArgon2idAuthProvider, type AuthProvider } from '@tecton/providers';
import { createTestClock } from '#test-support';
import { describe, expect, it, vi } from 'vitest';
import type { AccessTokenIssuer } from './access-token.js';
import type { Credential } from './credential.js';
import type { CredentialStore } from './credential-store.js';
import { InvalidCredentialsError, login } from './login.js';

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
    create: async () => undefined,
    createIfEmpty: async () => false,
    updatePasswordHash: async (id, hash) => {
      updates.push({ id, hash });
    },
    close: async () => undefined,
  };
  const issuer: AccessTokenIssuer = {
    issue: async (issuedFor) => ({ accessToken: `token-for-${issuedFor.id}`, tokenType: 'Bearer', expiresIn: 900 }),
  };
  const dummyHash = await realAuth.hashPassword('dummy-password-value');
  return { deps: { store, auth, issuer, clock: createTestClock(), dummyHash }, updates, credential };
}

describe('login (AC 1, AC 2)', () => {
  it('issues a token for the right password, normalizing the login', async () => {
    const { deps } = await setup();

    expect(await login(deps, { login: '  ALICE ', password: PASSWORD })).toEqual({
      accessToken: 'token-for-0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
      tokenType: 'Bearer',
      expiresIn: 900,
    });
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
    await expect(login({ ...deps, onRehashFailure }, { login: 'alice', password: PASSWORD })).resolves.toMatchObject({ tokenType: 'Bearer' });
    expect(onRehashFailure).toHaveBeenCalledOnce();
  });

  it('does not re-hash when the hash is current', async () => {
    const { deps, updates } = await setup();

    await login(deps, { login: 'alice', password: PASSWORD });
    expect(updates).toEqual([]);
  });
});
