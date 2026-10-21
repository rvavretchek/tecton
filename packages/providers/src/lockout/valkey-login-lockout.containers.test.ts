import { createHash } from 'node:crypto';
import type { CreatedProxy } from '@testcontainers/toxiproxy';
import { startFaultLab, startValkey, withDependencyDown, type FaultLab, type StartedValkey } from '#test-support';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createValkeyClient, closeValkeyClient, type ValkeyClient } from '../valkey/valkey-client.js';
import { LoginLockoutUnavailableError, type LoginLockout } from './login-lockout.js';
import { createValkeyLoginLockout } from './valkey-login-lockout.js';

const TIMEOUT_MS = 300;
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

// Story 2.6 (P0-016, P0-002/R-09): a real Valkey 9.1 behind Toxiproxy. Runs with `pnpm test:containers`.
describe('Valkey login lockout against a real Valkey', () => {
  let lab: FaultLab;
  let valkey: StartedValkey;
  let proxy: CreatedProxy;
  let client: ValkeyClient;
  let lockout: LoginLockout;
  let raw: Redis;

  beforeAll(async () => {
    lab = await startFaultLab();
    valkey = await startValkey(lab.network);
    proxy = await lab.proxy('valkey-lockout', `${valkey.networkAlias}:6379`);
    client = createValkeyClient({ url: `redis://${proxy.host}:${proxy.port}`, timeoutMs: TIMEOUT_MS });
    lockout = createValkeyLoginLockout({ client, shared: true, maxFailures: 3, windowSeconds: 60, lockSeconds: 120 });
    raw = new Redis({ host: valkey.host, port: valkey.port, lazyConnect: true });
    await raw.connect();
  }, 240_000);

  afterAll(async () => {
    await lockout?.close();
    if (client) await closeValkeyClient(client);
    await raw?.quit().catch(() => undefined);
    await valkey?.stop();
    await lab?.stop();
  });

  async function untilAvailable(): Promise<void> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        await lockout.check('probe');
        return;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  it('counts failures in a window and locks at the limit for the duration (AC 1)', async () => {
    await untilAvailable();
    await lockout.recordFailure('alice@example.com');
    expect(await raw.pttl(`tecton:lockout:fail:${hash('alice@example.com')}`)).toBeGreaterThan(59_000);
    await lockout.recordFailure('alice@example.com');

    expect(await lockout.recordFailure('alice@example.com')).toEqual({ lockedNow: true, lockSeconds: 120 });
    expect(await raw.pttl(`tecton:lockout:lock:${hash('alice@example.com')}`)).toBeGreaterThan(119_000);
    expect(await raw.exists(`tecton:lockout:fail:${hash('alice@example.com')}`)).toBe(0);
    expect(await lockout.check('alice@example.com')).toMatchObject({ locked: true });
    expect((await raw.keys('tecton:lockout:*')).join(' ')).not.toContain('alice');
  });

  it('clears the lock and the counter on reset (AC 5, AC 7)', async () => {
    await untilAvailable();
    await lockout.recordFailure('bob');
    await lockout.reset('bob');
    await lockout.reset('alice@example.com');

    expect(await lockout.check('alice@example.com')).toEqual({ locked: false });
    expect(await raw.exists(`tecton:lockout:fail:${hash('bob')}`)).toBe(0);
  });

  it('fails closed while Valkey is unreachable or too slow (AC 8)', async () => {
    await untilAvailable();
    await withDependencyDown(proxy, async () => {
      await expect(lockout.check('alice')).rejects.toBeInstanceOf(LoginLockoutUnavailableError);
    });
    await untilAvailable();
    const toxic = await proxy.instance.addToxic<{ latency: number; jitter: number }>({
      name: 'slow-lockout',
      type: 'latency',
      stream: 'downstream',
      toxicity: 1,
      attributes: { latency: TIMEOUT_MS * 5, jitter: 0 },
    });
    try {
      const started = Date.now();
      await expect(lockout.recordFailure('alice')).rejects.toBeInstanceOf(LoginLockoutUnavailableError);
      expect(Date.now() - started).toBeLessThan(TIMEOUT_MS + 500);
    } finally {
      await toxic.remove();
    }
  }, 60_000);
});
