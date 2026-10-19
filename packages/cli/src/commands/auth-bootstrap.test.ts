import type { Credential, CredentialStore } from '@tecton/auth';
import { assertNoSecretsLeaked, createTestClock } from '#test-support';
import { describe, expect, it } from 'vitest';
import { run } from '../cli.js';
import type { CliIo } from '../io.js';
import { authBootstrapCommand, type AuthBootstrapDependencies } from './auth-bootstrap.js';

const PEPPER = 'cli-bootstrap-test-pepper-32-bytes!!';
const PASSWORD = 'first-admin-password-xyz';
const DATABASE_URL = 'postgresql://tecton:database-secret-123@localhost:5432/auth';
const BASE_ENV = { TECTON_AUTH_DATABASE_URL: DATABASE_URL, TECTON_AUTH_PEPPER: PEPPER };

function memoryStore(initial: Credential[] = []) {
  const rows = [...initial];
  let closed = false;
  const store: CredentialStore = {
    count: async () => rows.length,
    findByLogin: async (login) => rows.find((row) => row.login === login),
    create: async (credential) => {
      rows.push(credential);
    },
    createIfEmpty: async (credential) => {
      if (rows.length > 0) return false;
      rows.push(credential);
      return true;
    },
    updatePasswordHash: async () => undefined,
    close: async () => {
      closed = true;
    },
  };
  return { store, rows, isClosed: () => closed };
}

function harness(env: NodeJS.ProcessEnv, stdin?: { isTTY?: boolean; text?: string }) {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    cwd: process.cwd(),
    stdout: { write: (text) => void (stdout += text) },
    stderr: { write: (text) => void (stderr += text) },
    env,
    ...(stdin ? { stdin: { isTTY: stdin.isTTY ?? false, readAll: async () => stdin.text ?? '' } } : {}),
  };
  return { io, output: () => ({ stdout, stderr }) };
}

function deps(store: CredentialStore): AuthBootstrapDependencies {
  return { createStore: () => store, clock: createTestClock() };
}

describe('tecton-admin auth bootstrap (Story 2.2a, AC 2 and 3)', () => {
  it('creates the administrator with the password from the environment', async () => {
    const memory = memoryStore();
    const { io, output } = harness({ ...BASE_ENV, TECTON_AUTH_BOOTSTRAP_PASSWORD: PASSWORD });

    expect(await authBootstrapCommand({ login: 'Admin' }, io, deps(memory.store))).toBe(0);
    expect(memory.rows).toHaveLength(1);
    expect(output().stdout).toContain('Created the first administrator credential "admin"');
    expect(memory.isClosed()).toBe(true);
  });

  it('reads the password from standard input, removing only the trailing line break', async () => {
    const memory = memoryStore();
    const { io } = harness(BASE_ENV, { text: `${PASSWORD} ${String.fromCodePoint(10)}` });

    expect(await authBootstrapCommand({ login: 'admin' }, io, deps(memory.store))).toBe(0);
    const { createArgon2idAuthProvider } = await import('@tecton/providers');
    const auth = createArgon2idAuthProvider({ peppers: [{ id: '1', key: Buffer.from(PEPPER) }], currentPepperId: '1' });
    expect((await auth.verifyPassword(`${PASSWORD} `, memory.rows[0]?.passwordHash ?? '')).valid).toBe(true);
  });

  it('refuses an interactive terminal without the password variable', async () => {
    const memory = memoryStore();
    // Even if something could be read, an interactive terminal is never read: no echo control here.
    const { io, output } = harness(BASE_ENV, { isTTY: true, text: PASSWORD });

    expect(await authBootstrapCommand({ login: 'admin' }, io, deps(memory.store))).toBe(1);
    expect(output().stderr).toContain('TECTON_AUTH_BOOTSTRAP_PASSWORD');
    expect(memory.rows).toHaveLength(0);
  });

  it('refuses when credentials already exist, without changing anything', async () => {
    const memory = memoryStore();
    await authBootstrapCommand({ login: 'first' }, harness({ ...BASE_ENV, TECTON_AUTH_BOOTSTRAP_PASSWORD: PASSWORD }).io, deps(memory.store));
    const { io, output } = harness({ ...BASE_ENV, TECTON_AUTH_BOOTSTRAP_PASSWORD: PASSWORD });

    expect(await authBootstrapCommand({ login: 'second' }, io, deps(memory.store))).toBe(2);
    expect(output().stderr).toContain('auth bootstrap refused');
    expect(memory.rows).toHaveLength(1);
  });

  it.each([
    ['the database URL', { TECTON_AUTH_PEPPER: PEPPER, TECTON_AUTH_BOOTSTRAP_PASSWORD: PASSWORD }, 'TECTON_AUTH_DATABASE_URL'],
    ['the Pepper', { TECTON_AUTH_DATABASE_URL: DATABASE_URL, TECTON_AUTH_BOOTSTRAP_PASSWORD: PASSWORD }, 'TECTON_AUTH_PEPPER'],
  ])('fails clearly without %s, writing nothing', async (_label, env, variable) => {
    const memory = memoryStore();
    const { io, output } = harness(env);

    expect(await authBootstrapCommand({ login: 'admin' }, io, deps(memory.store))).toBe(1);
    expect(output().stderr).toContain(variable);
    expect(memory.rows).toHaveLength(0);
  });

  it('never prints the password, the Pepper or the database password', async () => {
    const memory = memoryStore();
    const { io, output } = harness({ ...BASE_ENV, TECTON_AUTH_BOOTSTRAP_PASSWORD: PASSWORD });
    await authBootstrapCommand({ login: 'admin' }, io, deps(memory.store));
    const { io: secondIo, output: second } = harness({ ...BASE_ENV, TECTON_AUTH_BOOTSTRAP_PASSWORD: PASSWORD });
    await authBootstrapCommand({ login: 'other' }, secondIo, deps(memory.store));

    const everything = `${output().stdout}${output().stderr}${second().stdout}${second().stderr}`;
    assertNoSecretsLeaked(everything, { password: PASSWORD, pepper: PEPPER, database: 'database-secret-123' });
  });

  it('has no option to pass the password as an argument', async () => {
    const { io, output } = harness({ ...BASE_ENV });

    expect(await run(['auth', 'bootstrap', '--login', 'admin', '--password', PASSWORD], io)).not.toBe(0);
    expect(output().stderr).toContain("unknown option '--password'");
  });

  it('documents the environment variables in its help', async () => {
    const { io, output } = harness({});

    await run(['auth', 'bootstrap', '--help'], io);
    expect(output().stdout).toContain('TECTON_AUTH_BOOTSTRAP_PASSWORD');
    expect(output().stdout).toContain('standard input');
  });

  it('reports a database error in one line, without the URL, the password or a stack trace (review P2)', async () => {
    const failing = memoryStore();
    const store: CredentialStore = {
      ...failing.store,
      count: async () => {
        const error = new Error(`connect ECONNREFUSED ${DATABASE_URL}`);
        Object.assign(error, { code: 'P1001' });
        throw error;
      },
      close: async () => {
        throw new Error('close failed too');
      },
    };
    const { io, output } = harness({ ...BASE_ENV, TECTON_AUTH_BOOTSTRAP_PASSWORD: PASSWORD });

    expect(await authBootstrapCommand({ login: 'admin' }, io, deps(store))).toBe(1);
    expect(output().stderr).toMatch(/^auth bootstrap failed: could not complete the bootstrap \(Error P1001\)/);
    expect(output().stderr).not.toContain('    at ');
    expect(output().stderr).not.toContain('close failed');
    assertNoSecretsLeaked(output().stderr, { database: 'database-secret-123', url: DATABASE_URL });
  });

  it('refuses a password variable that is set but empty instead of reading standard input (review P9)', async () => {
    const memory = memoryStore();
    const { io, output } = harness({ ...BASE_ENV, TECTON_AUTH_BOOTSTRAP_PASSWORD: '' }, { text: PASSWORD });

    expect(await authBootstrapCommand({ login: 'admin' }, io, deps(memory.store))).toBe(1);
    expect(output().stderr).toContain('set but empty');
    expect(memory.rows).toHaveLength(0);
  });

  it('gives up on standard input that never closes (review P9)', async () => {
    const memory = memoryStore();
    const { io, output } = harness(BASE_ENV);
    io.stdin = { isTTY: false, readAll: () => new Promise<string>(() => undefined) };

    expect(await authBootstrapCommand({ login: 'admin' }, io, { ...deps(memory.store), stdinTimeoutMs: 50 })).toBe(1);
    expect(output().stderr).toContain('did not close');
  });

  it('refuses a weak administrator password (review P4)', async () => {
    const memory = memoryStore();
    const { io, output } = harness({ ...BASE_ENV, TECTON_AUTH_BOOTSTRAP_PASSWORD: 'x' });

    expect(await authBootstrapCommand({ login: 'admin' }, io, deps(memory.store))).toBe(1);
    expect(output().stderr).toContain('at least 12 characters');
    expect(memory.rows).toHaveLength(0);
  });

  it('documents TECTON_AUTH_PEPPER_ID and the exit codes in its help (review P14, P15)', async () => {
    const { io, output } = harness({});

    await run(['auth', 'bootstrap', '--help'], io);
    expect(output().stdout).toContain('TECTON_AUTH_PEPPER_ID');
    expect(output().stdout).toContain('2 already bootstrapped');
  });
});
