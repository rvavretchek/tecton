import type { CreatedProxy } from '@testcontainers/toxiproxy';
import { createTestClock, startFaultLab, startValkey, withDependencyDown, type FaultLab, type StartedValkey } from '#test-support';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RevocationStoreUnavailableError, type TokenRevocationStore } from './token-revocation-store.js';
import { createValkeyTokenRevocationStore } from './valkey-token-revocation-store.js';

const TIMEOUT_MS = 300;

// Story 2.5 (P0-015, P0-002/R-09): a real Valkey 9.1, reached through Toxiproxy to take it down
// or slow it mid-test. Runs with `pnpm test:containers` (CI job "containers").
describe('Valkey token revocation store against a real Valkey', () => {
  let lab: FaultLab;
  let valkey: StartedValkey;
  let proxy: CreatedProxy;
  let store: TokenRevocationStore;
  let raw: Redis;
  const clock = createTestClock();

  beforeAll(async () => {
    lab = await startFaultLab();
    valkey = await startValkey(lab.network);
    proxy = await lab.proxy('valkey-revocation', `${valkey.networkAlias}:6379`);
    store = createValkeyTokenRevocationStore({ url: `redis://${proxy.host}:${proxy.port}`, timeoutMs: TIMEOUT_MS, clock });
    raw = new Redis({ host: valkey.host, port: valkey.port, lazyConnect: true });
    await raw.connect();
  }, 240_000);

  afterAll(async () => {
    await store?.close();
    await raw?.quit().catch(() => undefined);
    await valkey?.stop();
    await lab?.stop();
  });

  /** Waits until the store answers again (it reconnects in the background). */
  async function untilAvailable(): Promise<void> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        await store.isRevoked({ tokenId: 'probe', subject: 'probe', issuedAt: clock.now() });
        return;
      } catch (error) {
        if (Date.now() > deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  it('revokes a jti for the time the token has left, plus the 60-s margin (AC 1)', async () => {
    await untilAvailable();
    const expiresAt = new Date(clock.now().getTime() + 600_000);

    await store.revokeToken({ tokenId: 'jti-ttl', expiresAt });

    const ttl = await raw.pttl('tecton:revocation:jti:jti-ttl');
    expect(ttl).toBeGreaterThan(650_000);
    expect(ttl).toBeLessThanOrEqual(660_000);
    expect(await store.isRevoked({ tokenId: 'jti-ttl', subject: 'alice', issuedAt: clock.now() })).toBe(true);
    expect(await store.isRevoked({ tokenId: 'jti-other', subject: 'alice', issuedAt: clock.now() })).toBe(false);
  });

  it('revokes a subject before an instant that never moves back (AC 3)', async () => {
    await untilAvailable();
    const at = clock.now();
    await store.revokeSubject({ subject: 'bob', at });
    await store.revokeSubject({ subject: 'bob', at: new Date(at.getTime() - 60_000) });

    expect(await raw.get('tecton:revocation:sub:bob')).toBe(String(at.getTime()));
    expect(await raw.ttl('tecton:revocation:sub:bob')).toBeGreaterThan(3_600);
    expect(await store.isRevoked({ tokenId: 'a', subject: 'bob', issuedAt: new Date(at.getTime() - 1_000) })).toBe(true);
    expect(await store.isRevoked({ tokenId: 'b', subject: 'bob', issuedAt: new Date(at.getTime() + 1_000) })).toBe(false);
  });

  it('fails closed, fast, while Valkey is unreachable, and works again once it is back (AC 4)', async () => {
    await untilAvailable();
    await withDependencyDown(proxy, async () => {
      const started = Date.now();
      await expect(store.isRevoked({ tokenId: 'a', subject: 'alice', issuedAt: clock.now() })).rejects.toBeInstanceOf(RevocationStoreUnavailableError);
      expect(Date.now() - started).toBeLessThan(TIMEOUT_MS + 1_500);
    });

    await untilAvailable();
    expect(await store.isRevoked({ tokenId: 'jti-ttl', subject: 'alice', issuedAt: clock.now() })).toBe(true);
  }, 60_000);

  it('fails closed within the time limit when Valkey answers too slowly (AC 4)', async () => {
    await untilAvailable();
    const toxic = await proxy.instance.addToxic<{ latency: number; jitter: number }>({
      name: 'slow-valkey',
      type: 'latency',
      stream: 'downstream',
      toxicity: 1,
      attributes: { latency: TIMEOUT_MS * 5, jitter: 0 },
    });
    try {
      const started = Date.now();
      await expect(store.isRevoked({ tokenId: 'a', subject: 'alice', issuedAt: clock.now() })).rejects.toBeInstanceOf(RevocationStoreUnavailableError);
      expect(Date.now() - started).toBeLessThan(TIMEOUT_MS + 500);
    } finally {
      await toxic.remove();
    }
    await untilAvailable();
  }, 60_000);
});
