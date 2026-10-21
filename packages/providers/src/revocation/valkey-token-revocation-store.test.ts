import { assertNoSecretsLeaked, createTestClock } from '#test-support';
import { describe, expect, it } from 'vitest';
import { RevocationStoreUnavailableError } from './token-revocation-store.js';
import {
  createValkeyTokenRevocationStore,
  RevocationStoreConfigError,
  tokenRevocationStoreFromEnv,
  type RevocationClient,
} from './valkey-token-revocation-store.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');

/** Fake client: records commands and emulates SET PX, MGET and the subject script. */
function fakeClient(options: { fail?: Error } = {}) {
  const values = new Map<string, string>();
  const calls: Array<{ command: string; args: Array<string | number> }> = [];
  const failIfAsked = () => {
    if (options.fail) throw options.fail;
  };
  const client: RevocationClient = {
    async set(key, value, mode, ms) {
      calls.push({ command: 'set', args: [key, value, mode, ms] });
      failIfAsked();
      values.set(key, value);
      return 'OK';
    },
    async eval(_script, numKeys, ...args) {
      calls.push({ command: 'eval', args: [numKeys, ...args] });
      failIfAsked();
      const [key, value, ttl] = args as [string, string, number];
      const current = values.get(key);
      if (current === undefined || Number(current) < Number(value)) values.set(key, value);
      void ttl;
      return 1;
    },
    async mget(...keys) {
      calls.push({ command: 'mget', args: keys });
      failIfAsked();
      return keys.map((key) => values.get(key) ?? null);
    },
    async quit() {
      calls.push({ command: 'quit', args: [] });
      if (options.fail) throw options.fail;
      return 'OK';
    },
    disconnect() {
      calls.push({ command: 'disconnect', args: [] });
    },
  };
  return { client, values, calls };
}

function store(fake = fakeClient(), clock = createTestClock(NOW)) {
  return { fake, clock, store: createValkeyTokenRevocationStore({ client: fake.client, clock }) };
}

describe('Valkey token revocation store (Story 2.5, AC 1)', () => {
  it('revokes a jti under the framework prefix until the token expires, plus the clock tolerance', async () => {
    const { fake, store: revocations } = store();

    await revocations.revokeToken({ tokenId: 'jti-1', expiresAt: new Date(NOW.getTime() + 600_000) });

    expect(fake.calls).toEqual([{ command: 'set', args: ['tecton:revocation:jti:jti-1', '1', 'PX', 660_000] }]);
  });

  it('writes nothing for a token that has already expired (beyond the tolerance)', async () => {
    const { fake, store: revocations } = store();

    await revocations.revokeToken({ tokenId: 'jti-1', expiresAt: new Date(NOW.getTime() - 61_000) });

    expect(fake.calls).toEqual([]);
  });

  it('finds a revoked jti in a single MGET of the jti and subject keys', async () => {
    const { fake, store: revocations } = store();
    await revocations.revokeToken({ tokenId: 'jti-1', expiresAt: new Date(NOW.getTime() + 60_000) });

    expect(await revocations.isRevoked({ tokenId: 'jti-1', subject: 'alice', issuedAt: NOW })).toBe(true);
    expect(await revocations.isRevoked({ tokenId: 'jti-2', subject: 'alice', issuedAt: NOW })).toBe(false);
    expect(fake.calls.filter((call) => call.command === 'mget').at(-1)?.args).toEqual(['tecton:revocation:jti:jti-2', 'tecton:revocation:sub:alice']);
  });
});

describe('subject revocation (Story 2.5, AC 3)', () => {
  it('refuses tokens issued at or before the instant, and accepts later ones', async () => {
    const { store: revocations } = store();
    await revocations.revokeSubject({ subject: 'alice', at: NOW });

    expect(await revocations.isRevoked({ tokenId: 'a', subject: 'alice', issuedAt: new Date(NOW.getTime() - 1_000) })).toBe(true);
    expect(await revocations.isRevoked({ tokenId: 'b', subject: 'alice', issuedAt: NOW })).toBe(true);
    expect(await revocations.isRevoked({ tokenId: 'c', subject: 'alice', issuedAt: new Date(NOW.getTime() + 1_000) })).toBe(false);
    expect(await revocations.isRevoked({ tokenId: 'd', subject: 'bob', issuedAt: NOW })).toBe(false);
  });

  it('keeps the subject revocation for the longest token lifetime plus the tolerance', async () => {
    const { fake, store: revocations } = store();
    await revocations.revokeSubject({ subject: 'alice', at: NOW });

    expect(fake.calls[0]).toEqual({ command: 'eval', args: [1, 'tecton:revocation:sub:alice', String(NOW.getTime()), 3_660] });
  });

  it('counts a corrupt subject value as revoked (fail closed)', async () => {
    const { fake, store: revocations } = store();
    fake.values.set('tecton:revocation:sub:alice', 'garbage');

    expect(await revocations.isRevoked({ tokenId: 'a', subject: 'alice', issuedAt: new Date(NOW.getTime() + 60_000) })).toBe(true);
  });
});

describe('failures (Story 2.5, AC 4)', () => {
  it.each(['revokeToken', 'revokeSubject', 'isRevoked'] as const)('turns a client error into RevocationStoreUnavailableError: %s', async (method) => {
    const { store: revocations } = store(fakeClient({ fail: new Error('Command timed out') }));
    const calls = {
      revokeToken: () => revocations.revokeToken({ tokenId: 'a', expiresAt: new Date(NOW.getTime() + 60_000) }),
      revokeSubject: () => revocations.revokeSubject({ subject: 'alice', at: NOW }),
      isRevoked: () => revocations.isRevoked({ tokenId: 'a', subject: 'alice', issuedAt: NOW }),
    };

    await expect(calls[method]()).rejects.toBeInstanceOf(RevocationStoreUnavailableError);
  });

  it('refuses an unexpected MGET reply instead of answering "not revoked"', async () => {
    const fake = fakeClient();
    fake.client.mget = async () => ['1'];
    const { store: revocations } = store(fake);

    await expect(revocations.isRevoked({ tokenId: 'a', subject: 'alice', issuedAt: NOW })).rejects.toBeInstanceOf(RevocationStoreUnavailableError);
  });

  it.each(['', 'x'.repeat(129), 'bad\nid', 42])('refuses an id that cannot be a key part: %j', async (id) => {
    const { store: revocations } = store();

    await expect(revocations.isRevoked({ tokenId: id as string, subject: 'alice', issuedAt: NOW })).rejects.toThrow(RangeError);
  });
});

describe('configuration (Story 2.5, AC 7)', () => {
  it('requires TECTON_VALKEY_URL, naming it', () => {
    expect(() => tokenRevocationStoreFromEnv({})).toThrow(/^TECTON_VALKEY_URL is not set/);
  });

  it.each(['http://valkey:6379', 'not a url'])('refuses a URL that is not redis:// or rediss://: %s', (url) => {
    expect(() => tokenRevocationStoreFromEnv({ TECTON_VALKEY_URL: url })).toThrow(/^TECTON_VALKEY_URL: /);
  });

  it('never echoes the URL or its password', () => {
    const error = (() => {
      try {
        tokenRevocationStoreFromEnv({ TECTON_VALKEY_URL: 'http://user:s3cret-pass@valkey:6379' });
      } catch (caught) {
        return caught as Error;
      }
      return undefined;
    })();

    assertNoSecretsLeaked(error?.message ?? '', { password: 's3cret-pass' });
  });

  it.each(['49', '5001', '0x1f4', '5e2', '500.5'])('refuses TECTON_REVOCATION_TIMEOUT_MS=%s, naming it', (value) => {
    expect(() => tokenRevocationStoreFromEnv({ TECTON_VALKEY_URL: 'redis://127.0.0.1:1', TECTON_REVOCATION_TIMEOUT_MS: value })).toThrow(
      /^TECTON_REVOCATION_TIMEOUT_MS must be a decimal integer between 50 and 5000$/,
    );
  });

  it('starts without Valkey and refuses checks at once, with no offline queue (fail closed)', async () => {
    const revocations = tokenRevocationStoreFromEnv({ TECTON_VALKEY_URL: 'redis://127.0.0.1:1', TECTON_REVOCATION_TIMEOUT_MS: '200' });
    try {
      const started = Date.now();
      await expect(revocations.isRevoked({ tokenId: 'a', subject: 'alice', issuedAt: NOW })).rejects.toBeInstanceOf(RevocationStoreUnavailableError);
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      await revocations.close();
    }
  });
});

describe('review fixes (Story 2.5 review)', () => {
  it('drops the connection when quit is refused (no connection, or Valkey silent) (P1)', async () => {
    const fake = fakeClient({ fail: new Error("Stream isn't writeable and enableOfflineQueue options is false") });
    const { store: revocations } = store(fake);

    await revocations.close();

    expect(fake.calls.map((call) => call.command)).toEqual(['quit', 'disconnect']);
  });

  it('really stops a client that cannot reach Valkey, so the process can exit (P1)', async () => {
    const revocations = tokenRevocationStoreFromEnv({ TECTON_VALKEY_URL: 'redis://127.0.0.1:1' });
    await revocations.close();
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 300));

    // After close, every call fails at once and nothing reconnects in the background.
    await expect(revocations.isRevoked({ tokenId: 'a', subject: 'alice', issuedAt: NOW })).rejects.toBeInstanceOf(RevocationStoreUnavailableError);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it('refuses an invalid expiry as a programming error, never sending it to Valkey (P9)', async () => {
    const { fake, store: revocations } = store();

    await expect(revocations.revokeToken({ tokenId: 'a', expiresAt: new Date(Number.NaN) })).rejects.toThrow(RangeError);
    expect(fake.calls).toEqual([]);
  });

  it.each(['redis://', 'rediss://'])('refuses a URL without a host: %s (P10)', (url) => {
    expect(() => tokenRevocationStoreFromEnv({ TECTON_VALKEY_URL: url })).toThrow(/^TECTON_VALKEY_URL: the Valkey URL must name a host$/);
  });
});
