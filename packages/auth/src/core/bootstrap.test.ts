import { createArgon2idAuthProvider, type AuthProvider } from '@tecton/providers';
import { assertNoSecretsLeaked, createTestClock } from '#test-support';
import { describe, expect, it } from 'vitest';
import { AlreadyBootstrappedError, BOOTSTRAP_ADMIN_PERMISSIONS, bootstrapAdmin, PasswordPolicyError } from './bootstrap.js';
import type { Credential } from './credential.js';
import { LoginTakenError, type CredentialStore } from './credential-store.js';

const PASSWORD = 'first-admin-password-123';
const auth: AuthProvider = createArgon2idAuthProvider({
  peppers: [{ id: '1', key: Buffer.from('bootstrap-test-pepper-32-bytes-long!!', 'utf8') }],
  currentPepperId: '1',
});

/** In-memory CredentialStore for the core tests; the Prisma adapter has its own persistence tests. */
function memoryStore(initial: Credential[] = []) {
  const rows = [...initial];
  const calls = { create: 0 };
  const store: CredentialStore = {
    count: async () => rows.length,
    findByLogin: async (login) => rows.find((row) => row.login === login),
    findById: async (id) => rows.find((row) => row.id === id),
    create: async (credential) => {
      calls.create += 1;
      if (rows.some((row) => row.login === credential.login)) throw new LoginTakenError();
      rows.push(credential);
    },
    createIfEmpty: async (credential) => {
      if (rows.length > 0) return false;
      calls.create += 1;
      rows.push(credential);
      return true;
    },
    updatePasswordHash: async () => true,
    close: async () => undefined,
  };
  return { store, rows, calls };
}

describe('bootstrapAdmin', () => {
  it('creates the first administrator with a hash, the bootstrap permissions and Clock timestamps', async () => {
    const { store, rows } = memoryStore();
    const clock = createTestClock(new Date('2026-10-15T12:00:00.000Z'));

    const created = await bootstrapAdmin({ store, auth, clock, login: ' Admin@Example.com ', password: PASSWORD });

    expect(rows).toHaveLength(1);
    expect(created).toMatchObject({
      login: 'admin@example.com',
      status: 'active',
      permissions: [...BOOTSTRAP_ADMIN_PERMISSIONS],
      createdAt: new Date('2026-10-15T12:00:00.000Z'),
      updatedAt: new Date('2026-10-15T12:00:00.000Z'),
    });
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await auth.verifyPassword(PASSWORD, created.passwordHash)).valid).toBe(true);
    assertNoSecretsLeaked(JSON.stringify(rows), { password: PASSWORD });
  });

  it('refuses when a credential already exists, without writing anything', async () => {
    const { store, rows, calls } = memoryStore();
    const clock = createTestClock();
    await bootstrapAdmin({ store, auth, clock, login: 'first', password: PASSWORD });

    await expect(bootstrapAdmin({ store, auth, clock, login: 'second', password: PASSWORD })).rejects.toThrow(AlreadyBootstrappedError);
    expect(rows).toHaveLength(1);
    expect(calls.create).toBe(1);
  });

  it('exposes the bootstrap permissions as an immutable list', () => {
    expect(BOOTSTRAP_ADMIN_PERMISSIONS).toEqual(['auth:service:register', 'auth:credential:create']);
    expect(Object.isFrozen(BOOTSTRAP_ADMIN_PERMISSIONS)).toBe(true);
  });

  it.each([
    ['too short', 'short-pass1'],
    ['only spaces', ' '.repeat(16)],
    ['empty', ''],
  ])('refuses a password that is %s, writing nothing', async (_label, password) => {
    const { store, rows } = memoryStore();

    await expect(bootstrapAdmin({ store, auth, clock: createTestClock(), login: 'admin', password })).rejects.toThrow(PasswordPolicyError);
    expect(rows).toHaveLength(0);
  });

  it('refuses when the atomic insert finds credentials created meanwhile (concurrent bootstrap)', async () => {
    const { store, rows } = memoryStore();
    // count() sees an empty table, then another bootstrap commits before our insert.
    const racing: CredentialStore = { ...store, count: async () => 0, createIfEmpty: async () => false };

    await expect(bootstrapAdmin({ store: racing, auth, clock: createTestClock(), login: 'admin', password: PASSWORD })).rejects.toThrow(
      AlreadyBootstrappedError,
    );
    expect(rows).toHaveLength(0);
  });
});
