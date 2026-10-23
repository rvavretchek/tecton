import { LoginLockoutUnavailableError } from '@tecton/providers';
import { assertNoSecretsLeaked, createMemoryLoginLockout } from '#test-support';
import { describe, expect, it } from 'vitest';
import { run } from '../cli.js';
import type { CliIo } from '../io.js';
import { authUnlockCommand, type AuthUnlockDependencies } from './auth-unlock.js';

const VALKEY_URL = 'redis://:valkey-secret-123@127.0.0.1:1';

function harness(env: NodeJS.ProcessEnv) {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    cwd: process.cwd(),
    env,
    stdout: { write: (text: string) => void (stdout += text) },
    stderr: { write: (text: string) => void (stderr += text) },
  };
  return { io, out: () => stdout, err: () => stderr };
}

function memoryDependencies() {
  const lockout = createMemoryLoginLockout(() => new LoginLockoutUnavailableError('login lockout unavailable: down'), () => new Date(), { maxFailures: 2 });
  let closed = false;
  const dependencies: AuthUnlockDependencies = {
    createLockout: () => ({ lockout: { ...lockout, close: async () => void (closed = true) }, ready: async () => true }),
  };
  return { lockout, dependencies, isClosed: () => closed };
}

describe('tecton-admin auth unlock (Story 2.6, AC 7)', () => {
  it('removes the lock and the failure count of the normalized identifier, then closes the connection', async () => {
    const { lockout, dependencies, isClosed } = memoryDependencies();
    await lockout.recordFailure('alice@example.com');
    await lockout.recordFailure('alice@example.com');
    await lockout.recordFailure('bob');
    const { io, out } = harness({ TECTON_VALKEY_URL: VALKEY_URL });

    expect(await authUnlockCommand('  Alice@Example.COM ', io, dependencies)).toBe(0);

    expect(await lockout.check('alice@example.com')).toEqual({ locked: false });
    expect(lockout.failures('bob')).toBe(1);
    expect(out()).toContain('Unlocked "alice@example.com"');
    expect(isClosed()).toBe(true);
  });

  it('succeeds for an identifier that is not locked (idempotent), and says there was nothing to remove (P16)', async () => {
    const { dependencies } = memoryDependencies();
    const { io, out } = harness({ TECTON_VALKEY_URL: VALKEY_URL });

    expect(await authUnlockCommand('nobody', io, dependencies)).toBe(0);
    expect(out()).toContain('"nobody" had no lockout or failure count; nothing to remove.');
  });

  it('removes a pending failure count that has not locked yet (AC 7, review P18)', async () => {
    const { lockout, dependencies } = memoryDependencies();
    await lockout.recordFailure('carol');

    expect(await authUnlockCommand('carol', harness({ TECTON_VALKEY_URL: VALKEY_URL }).io, dependencies)).toBe(0);
    expect(lockout.failures('carol')).toBe(0);
  });

  it('fails when the connection does not become ready, without sending the command (review P1)', async () => {
    const { lockout } = memoryDependencies();
    let resets = 0;
    const dependencies: AuthUnlockDependencies = {
      createLockout: () => ({ lockout: { ...lockout, reset: async () => ((resets += 1), true) }, ready: async () => false }),
    };
    const { io, err } = harness({ TECTON_VALKEY_URL: VALKEY_URL });

    expect(await authUnlockCommand('alice', io, dependencies)).toBe(1);
    expect(err()).toContain('could not reach Valkey');
    expect(resets).toBe(0);
  });

  it('fails without TECTON_VALKEY_URL, naming it', async () => {
    const { io, err } = harness({});

    expect(await authUnlockCommand('alice', io)).toBe(1);
    expect(err()).toMatch(/^auth unlock failed: TECTON_VALKEY_URL is not set/);
  });

  it('fails for an identifier that is not a valid login', async () => {
    const { dependencies } = memoryDependencies();
    const { io, err } = harness({ TECTON_VALKEY_URL: VALKEY_URL });

    expect(await authUnlockCommand(`al${String.fromCodePoint(0x200b)}ice`, io, dependencies)).toBe(1);
    expect(err()).toMatch(/^auth unlock failed: /);
  });

  it('fails clearly when Valkey cannot be reached, never printing the URL or its password', { timeout: 15_000 }, async () => {
    const { io, err } = harness({ TECTON_VALKEY_URL: VALKEY_URL, TECTON_REVOCATION_TIMEOUT_MS: '200' });

    expect(await authUnlockCommand('alice', io)).toBe(1);
    expect(err()).toContain('could not reach Valkey');
    assertNoSecretsLeaked(err(), { url: VALKEY_URL, password: 'valkey-secret-123' });
  });

  it('is wired as a subcommand with English help', async () => {
    const { io, out } = harness({});

    expect(await run(['auth', 'unlock', '--help'], io)).toBe(0);
    expect(out()).toContain('tecton-admin auth unlock alice@example.com');
    expect(out()).toMatch(/^[\x09\x0A\x0D\x20-\x7E]+$/);
  });
});
