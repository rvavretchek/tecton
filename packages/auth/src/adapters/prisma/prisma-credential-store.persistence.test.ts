import { createArgon2idAuthProvider } from '@tecton/providers';
import { assertNoSecretsLeaked, createTestClock, selectedDatabase, startDatabase, type StartedDatabase } from '#test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlreadyBootstrappedError, bootstrapAdmin } from '../../core/bootstrap.js';
import type { Credential } from '../../core/credential.js';
import { LoginTakenError, type CredentialStore } from '../../core/credential-store.js';
import { applyAuthMigrations } from './migrations.js';
import { createPrismaCredentialStore } from './prisma-credential-store.js';

const auth = createArgon2idAuthProvider({
  peppers: [{ id: '1', key: Buffer.from('persistence-test-pepper-32-bytes-ok', 'utf8') }],
  currentPepperId: '1',
});

function credential(overrides: Partial<Credential> = {}): Credential {
  const at = new Date('2026-10-15T12:34:56.789Z');
  return {
    id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
    login: 'alice@example.com',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1,keyid=MQ$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g',
    status: 'active',
    permissions: ['tenant:create', 'auth:service:register'],
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

// Story 2.2a, AC 1 and 3: runs once per engine in the CI matrix (TECTON_TEST_DB).
describe(`Auth credential store on ${selectedDatabase()}`, () => {
  let database: StartedDatabase;
  let store: CredentialStore;

  beforeAll(async () => {
    database = await startDatabase();
    await applyAuthMigrations({ databaseUrl: database.url });
    store = createPrismaCredentialStore({ databaseUrl: database.url });
  }, 240_000);

  afterAll(async () => {
    await store?.close();
    await database?.stop();
  });

  it('applies the migrations again without error (idempotent deploy)', async () => {
    await expect(applyAuthMigrations({ databaseUrl: database.url })).resolves.toBeUndefined();
  }, 120_000);

  it('stores and reads a credential: UUID v7, permissions as JSON, millisecond timestamps', async () => {
    await store.create(credential());

    expect(await store.findByLogin('alice@example.com')).toEqual(credential());
    expect(await store.findByLogin('nobody@example.com')).toBeUndefined();
    expect(await store.count()).toBe(1);
  });

  it('rejects a duplicate login with LoginTakenError', async () => {
    await expect(store.create(credential({ id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e60' }))).rejects.toThrow(LoginTakenError);
  });

  it('treats logins that differ only by accent as different (binary collation on MySQL/MariaDB)', async () => {
    await store.create(credential({ id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e61', login: 'jose' }));
    await store.create(credential({ id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e62', login: `jos${String.fromCodePoint(0xe9)}` }));

    expect((await store.findByLogin('jose'))?.id).toBe('0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e61');
  });

  it('refuses a bootstrap once credentials exist, leaving the table unchanged', async () => {
    const before = await store.count();

    await expect(
      bootstrapAdmin({ store, auth, clock: createTestClock(), login: 'admin', password: 'admin-password-123' }),
    ).rejects.toThrow(AlreadyBootstrappedError);
    expect(await store.count()).toBe(before);
  });
});

describe(`Auth bootstrap on an empty ${selectedDatabase()} database`, () => {
  let database: StartedDatabase;

  beforeAll(async () => {
    database = await startDatabase();
    await applyAuthMigrations({ databaseUrl: database.url });
  }, 240_000);

  afterAll(async () => {
    await database?.stop();
  });

  it('creates exactly one administrator', async () => {
    const store = createPrismaCredentialStore({ databaseUrl: database.url });
    try {
      const created = await bootstrapAdmin({ store, auth, clock: createTestClock(), login: 'Admin', password: 'admin-password-123' });

      expect(await store.count()).toBe(1);
      expect(await store.findByLogin('admin')).toEqual(created);
    } finally {
      await store.close();
    }
  });

  it('reports a migration failure without the database URL or its password', async () => {
    // A wrong password: a missing database is not a failure, PostgreSQL's migrate deploy creates it.
    const url = new URL(database.url);
    url.password = 'wrong-password-for-the-test';
    const broken = url.toString();
    let message = '';
    try {
      await applyAuthMigrations({ databaseUrl: broken });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('migrations failed');
    assertNoSecretsLeaked(message, { password: 'wrong-password-for-the-test' });
    expect(message).not.toContain(broken);
  }, 120_000);
});
