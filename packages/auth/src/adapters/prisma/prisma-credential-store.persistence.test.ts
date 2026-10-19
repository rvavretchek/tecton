import { createArgon2idAuthProvider } from '@tecton/providers';
import { assertNoSecretsLeaked, createTestClock, ed25519KeyPairPem, selectedDatabase, startDatabase, type StartedDatabase } from '#test-support';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlreadyBootstrappedError, bootstrapAdmin } from '../../core/bootstrap.js';
import { InvalidCredentialError, type Credential } from '../../core/credential.js';
import { LoginTakenError, type CredentialStore } from '../../core/credential-store.js';
import { applyAuthMigrations } from './migrations.js';
import { createAccessTokenIssuer } from '../jose/access-token-issuer.js';
import { buildSigningKeys } from '../jose/signing-keys.js';
import { createAuthService, JWKS_PATH } from '../../service.js';
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

describe(`Auth store review fixes on ${selectedDatabase()}`, () => {
  let database: StartedDatabase;
  let store: CredentialStore;
  const table = selectedDatabase() === 'postgres' ? '"credentials"' : '`credentials`';

  beforeAll(async () => {
    database = await startDatabase();
    await applyAuthMigrations({ databaseUrl: database.url });
    store = createPrismaCredentialStore({ databaseUrl: database.url });
  }, 240_000);

  afterAll(async () => {
    await store?.close();
    await database?.stop();
  });

  it('P3: two concurrent bootstraps on an empty database create exactly one administrator', async () => {
    const run = (login: string) =>
      bootstrapAdmin({ store, auth, clock: createTestClock(), login, password: 'admin-password-123' }).then(
        () => 'created',
        (error: unknown) => (error instanceof AlreadyBootstrappedError ? 'refused' : Promise.reject(error)),
      );
    const outcomes = await Promise.all([run('first-admin'), run('second-admin')]);

    expect(outcomes.sort()).toEqual(['created', 'refused']);
    expect(await store.count()).toBe(1);
  });

  it('P18: a second bootstrap after the first leaves exactly one row', async () => {
    await expect(
      bootstrapAdmin({ store, auth, clock: createTestClock(), login: 'third-admin', password: 'admin-password-123' }),
    ).rejects.toThrow(AlreadyBootstrappedError);
    expect(await store.count()).toBe(1);
  });

  it('P11: a repeated id is not reported as a taken login', async () => {
    const existing = credential({ id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e70', login: 'bob' });
    await store.create(existing);

    const error = await store.create(credential({ id: existing.id, login: 'carol' })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(LoginTakenError);
  });

  it('P5: a row with an unknown status fails closed when read', async () => {
    await database.query(
      `INSERT INTO ${table} (id, login, password_hash, status, permissions, created_at, updated_at) ` +
        `VALUES ('0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e71', 'mallory', 'hash', 'superuser', '[]', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
    );

    await expect(store.findByLogin('mallory')).rejects.toThrow(InvalidCredentialError);
  });

  it.runIf(selectedDatabase() !== 'postgres')('P17: the live login column has a binary collation', async () => {
    const collation = await database.query(
      "SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_NAME = 'credentials' AND COLUMN_NAME = 'login'",
    );

    expect(collation).toBe('utf8mb4_bin');
  });

  it.runIf(selectedDatabase() === 'postgres')('P6: honours ?schema= in migrations and at runtime alike', async () => {
    const url = new URL(database.url);
    url.searchParams.set('schema', 'tecton_auth');
    const scoped = url.toString();
    await applyAuthMigrations({ databaseUrl: scoped });
    const scopedStore = createPrismaCredentialStore({ databaseUrl: scoped });
    try {
      await scopedStore.create(credential({ id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e72', login: 'scoped' }));
      expect(await scopedStore.count()).toBe(1);
      expect(await database.query('SELECT count(*) FROM tecton_auth.credentials')).toBe('1');
    } finally {
      await scopedStore.close();
    }
  }, 120_000);
});

describe(`Auth login end to end on ${selectedDatabase()} (Story 2.2b)`, () => {
  let database: StartedDatabase;

  beforeAll(async () => {
    database = await startDatabase();
    await applyAuthMigrations({ databaseUrl: database.url });
  }, 240_000);

  afterAll(async () => {
    await database?.stop();
  });

  it('logs in a bootstrapped administrator and issues a token verifiable through the JWKS', async () => {
    const keys = await buildSigningKeys({ privateKeyPem: ed25519KeyPairPem().privatePem });
    const clock = createTestClock(new Date('2026-10-19T12:00:00.000Z'));
    const setup = createPrismaCredentialStore({ databaseUrl: database.url });
    await bootstrapAdmin({ store: setup, auth, clock, login: 'Admin', password: 'admin-password-123' });
    await setup.close();

    const app = await createAuthService({
      store: createPrismaCredentialStore({ databaseUrl: database.url }),
      auth,
      issuer: createAccessTokenIssuer({ keys, clock }),
      keys,
      clock,
    });
    try {
      const ok = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'admin', password: 'admin-password-123' } });
      expect(ok.statusCode).toBe(200);
      const jwks = (await app.inject({ method: 'GET', url: JWKS_PATH })).json() as { keys: never[] };
      const { payload } = await jwtVerify((ok.json() as { accessToken: string }).accessToken, createLocalJWKSet(jwks), {
        algorithms: ['EdDSA'],
        currentDate: clock.now(),
      });
      expect(payload['perms']).toEqual(['auth:service:register', 'auth:credential:create']);

      const wrong = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'admin', password: 'not-the-password' } });
      const unknown = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'ghost', password: 'not-the-password' } });
      expect(wrong.statusCode).toBe(401);
      expect(unknown.body).toBe(wrong.body);
    } finally {
      await app.close();
    }
  }, 120_000);

  it('updates a password hash only while it is still the expected one (no lost update)', async () => {
    const store = createPrismaCredentialStore({ databaseUrl: database.url });
    try {
      const own = credential({ id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e81', login: 'rehash-check', passwordHash: 'original-hash' });
      await store.create(own);
      const at = new Date('2026-10-20T08:00:00.123Z');

      expect(await store.updatePasswordHash(own.id, 'stale-hash', at, 'not-the-current-hash')).toBe(false);
      expect((await store.findByLogin('rehash-check'))?.passwordHash).toBe('original-hash');
      expect(await store.updatePasswordHash(own.id, 'replaced-hash', at, 'original-hash')).toBe(true);
      expect(await store.findByLogin('rehash-check')).toMatchObject({ passwordHash: 'replaced-hash', updatedAt: at, createdAt: own.createdAt });
    } finally {
      await store.close();
    }
  });

  it.runIf(selectedDatabase() !== 'postgres')('stores timestamps as UTC wall-clock values when the server time zone is not UTC (W2 of 2.2a)', async () => {
    const rootPassword = (database.container as unknown as { getRootPassword(): string }).getRootPassword();
    const client = selectedDatabase() === 'mariadb' ? 'mariadb' : 'mysql';
    const sql = (statement: string) =>
      database.container.exec([client, '-u', 'root', '-N', '-e', statement, new URL(database.url).pathname.slice(1)], { env: { MYSQL_PWD: rootPassword } });
    expect((await sql("SET GLOBAL time_zone = '+03:00'")).exitCode).toBe(0);
    const store = createPrismaCredentialStore({ databaseUrl: database.url });
    try {
      const created = new Date('2026-10-20T23:30:00.456Z');
      const updated = new Date('2026-10-21T01:15:00.789Z');
      await store.create(credential({ id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e80', login: 'tz-check', createdAt: created, updatedAt: updated }));

      // The raw DATETIME values, read by another session: a symmetric shift on write and read
      // would pass a round trip through the adapter, but not this.
      const raw = await sql("SELECT CONCAT(CAST(created_at AS CHAR), '|', CAST(updated_at AS CHAR)) FROM credentials WHERE login = 'tz-check'");
      expect(raw.output.trim()).toBe('2026-10-20 23:30:00.456|2026-10-21 01:15:00.789');
      expect(await store.findByLogin('tz-check')).toMatchObject({ createdAt: created, updatedAt: updated });
    } finally {
      await store.close();
      await sql("SET GLOBAL time_zone = 'SYSTEM'");
    }
  });
});
