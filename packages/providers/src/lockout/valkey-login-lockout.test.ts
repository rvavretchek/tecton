import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LoginLockoutConfigError, LoginLockoutUnavailableError } from './login-lockout.js';
import { createValkeyLoginLockout, lockoutPolicyFromEnv, type LockoutClient } from './valkey-login-lockout.js';

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** Fake client: emulates the failure script, PTTL and DEL on an in-memory map with manual time. */
function fakeClient(options: { fail?: Error } = {}) {
  let now = 0;
  const values = new Map<string, { value: number; expiresAt: number }>();
  const live = (key: string) => {
    const entry = values.get(key);
    if (entry && entry.expiresAt <= now) values.delete(key);
    return values.get(key);
  };
  const calls: string[] = [];
  const failIfAsked = () => {
    if (options.fail) throw options.fail;
  };
  const client: LockoutClient = {
    async eval(_script, _numKeys, ...args) {
      calls.push(`eval ${args.slice(0, 2).join(' ')}`);
      failIfAsked();
      const [failures, lock, windowMs, maxFailures, lockMs] = args as [string, string, number, number, number];
      const locked = live(lock);
      if (locked) return [2, locked.expiresAt - now];
      const current = live(failures);
      const count = (current?.value ?? 0) + 1;
      values.set(failures, { value: count, expiresAt: current?.expiresAt ?? now + windowMs });
      if (count >= maxFailures) {
        if (!live(lock)) values.set(lock, { value: 1, expiresAt: now + lockMs });
        values.delete(failures);
        return [1, lockMs];
      }
      return [0, count];
    },
    async pttl(key) {
      calls.push(`pttl ${key}`);
      failIfAsked();
      const entry = live(key);
      if (!entry) return -2;
      return Number.isFinite(entry.expiresAt) ? entry.expiresAt - now : -1;
    },
    async pexpire(key, ms) {
      calls.push(`pexpire ${key}`);
      failIfAsked();
      const entry = live(key);
      if (!entry) return 0;
      entry.expiresAt = now + ms;
      return 1;
    },
    async del(...keys) {
      calls.push(`del ${keys.join(' ')}`);
      failIfAsked();
      let removed = 0;
      for (const key of keys) if (values.delete(key)) removed += 1;
      return removed;
    },
    async quit() {
      return 'OK';
    },
    disconnect() {},
  };
  return { client, calls, values, advance: (ms: number) => void (now += ms) };
}

describe('Valkey login lockout (Story 2.6, AC 1, 2, 5)', () => {
  it('locks the identifier at the Nth failure in the window, for the configured duration', async () => {
    const fake = fakeClient();
    const lockout = createValkeyLoginLockout({ client: fake.client });

    for (let i = 1; i < 5; i += 1) expect(await lockout.recordFailure('alice')).toEqual({ lockedNow: false });
    expect(await lockout.check('alice')).toEqual({ locked: false });
    expect(await lockout.recordFailure('alice')).toEqual({ lockedNow: true, lockSeconds: 900 });
    expect(await lockout.check('alice')).toEqual({ locked: true, retryAfterSeconds: 900 });

    fake.advance(899_001);
    expect(await lockout.check('alice')).toEqual({ locked: true, retryAfterSeconds: 1 });
    fake.advance(1_000);
    expect(await lockout.check('alice')).toEqual({ locked: false });
  });

  it('forgets failures older than the window', async () => {
    const fake = fakeClient();
    const lockout = createValkeyLoginLockout({ client: fake.client, maxFailures: 2, windowSeconds: 60 });

    await lockout.recordFailure('alice');
    fake.advance(60_000);
    expect(await lockout.recordFailure('alice')).toEqual({ lockedNow: false });
  });

  it('clears the failures and the lock on reset (success, unlock)', async () => {
    const fake = fakeClient();
    const lockout = createValkeyLoginLockout({ client: fake.client, maxFailures: 2 });
    await lockout.recordFailure('alice');
    await lockout.recordFailure('alice');

    await lockout.reset('alice');

    expect(await lockout.check('alice')).toEqual({ locked: false });
    expect(await lockout.recordFailure('alice')).toEqual({ lockedNow: false });
  });

  it('keys by the SHA-256 of the identifier, never the login in clear text', async () => {
    const fake = fakeClient();
    const lockout = createValkeyLoginLockout({ client: fake.client });
    await lockout.recordFailure('alice@example.com');
    await lockout.check('alice@example.com');

    expect(fake.calls).toEqual([
      `eval tecton:lockout:{${hash('alice@example.com')}}:fail tecton:lockout:{${hash('alice@example.com')}}:lock`,
      `pttl tecton:lockout:{${hash('alice@example.com')}}:lock`,
    ]);
    expect(fake.calls.join(' ')).not.toContain('alice');
  });
});

describe('failures (Story 2.6, AC 8)', () => {
  it.each(['check', 'recordFailure', 'clearFailures', 'reset'] as const)('turns a client error into LoginLockoutUnavailableError: %s', async (method) => {
    const lockout = createValkeyLoginLockout({ client: fakeClient({ fail: new Error('Command timed out') }).client });

    await expect(lockout[method]('alice')).rejects.toBeInstanceOf(LoginLockoutUnavailableError);
  });

  it('refuses an unexpected script reply instead of answering "not locked"', async () => {
    const fake = fakeClient();
    fake.client.eval = async () => 'OK';
    const lockout = createValkeyLoginLockout({ client: fake.client });

    await expect(lockout.recordFailure('alice')).rejects.toBeInstanceOf(LoginLockoutUnavailableError);
  });

  it('leaves a shared client open on close', async () => {
    const fake = fakeClient();
    let quits = 0;
    fake.client.quit = async () => {
      quits += 1;
      return 'OK';
    };

    await createValkeyLoginLockout({ client: fake.client, shared: true }).close();
    await createValkeyLoginLockout({ client: fake.client }).close();
    expect(quits).toBe(1);
  });
});

describe('policy (Story 2.6)', () => {
  it('defaults to 5 failures in 15 minutes and a 15-minute lock, read from the environment', () => {
    expect(lockoutPolicyFromEnv({})).toEqual({ maxFailures: 5, windowSeconds: 900, lockSeconds: 900 });
    expect(
      lockoutPolicyFromEnv({ TECTON_AUTH_LOCKOUT_MAX_FAILURES: '3', TECTON_AUTH_LOCKOUT_WINDOW_SECONDS: '600', TECTON_AUTH_LOCKOUT_DURATION_SECONDS: '1800' }),
    ).toEqual({ maxFailures: 3, windowSeconds: 600, lockSeconds: 1800 });
  });

  it.each([
    ['TECTON_AUTH_LOCKOUT_MAX_FAILURES', '0'],
    ['TECTON_AUTH_LOCKOUT_MAX_FAILURES', '101'],
    ['TECTON_AUTH_LOCKOUT_WINDOW_SECONDS', '59'],
    ['TECTON_AUTH_LOCKOUT_DURATION_SECONDS', '0x384'],
    ['TECTON_AUTH_LOCKOUT_DURATION_SECONDS', '9e2'],
  ])('refuses %s=%s, naming the variable', (variable, value) => {
    expect(() => lockoutPolicyFromEnv({ [variable]: value })).toThrow(LoginLockoutConfigError);
    expect(() => lockoutPolicyFromEnv({ [variable]: value })).toThrow(new RegExp(`^${variable} must be a decimal integer`));
  });
});

describe('review fixes (Story 2.6 review)', () => {
  it('neither counts nor extends while locked (attempts already past the check) (P5)', async () => {
    const fake = fakeClient();
    const lockout = createValkeyLoginLockout({ client: fake.client, maxFailures: 2 });
    await lockout.recordFailure('alice');
    await lockout.recordFailure('alice');
    fake.advance(600_000);

    for (let i = 0; i < 5; i += 1) expect(await lockout.recordFailure('alice')).toEqual({ lockedNow: false });
    expect(await lockout.check('alice')).toEqual({ locked: true, retryAfterSeconds: 300 });
  });

  it('clears only the failure count on success, keeping a lock set meanwhile (P4)', async () => {
    const fake = fakeClient();
    const lockout = createValkeyLoginLockout({ client: fake.client, maxFailures: 2 });
    await lockout.recordFailure('alice');
    await lockout.recordFailure('alice');

    await lockout.clearFailures('alice');
    expect(await lockout.check('alice')).toMatchObject({ locked: true });
  });

  it('tells whether a reset removed anything (P16)', async () => {
    const fake = fakeClient();
    const lockout = createValkeyLoginLockout({ client: fake.client });
    await lockout.recordFailure('alice');

    expect(await lockout.reset('alice')).toBe(true);
    expect(await lockout.reset('alice')).toBe(false);
  });

  it('gives a lock key without expiry the lock duration instead of locking forever (P6)', async () => {
    const fake = fakeClient();
    const lockout = createValkeyLoginLockout({ client: fake.client });
    fake.values.set(`tecton:lockout:{${hash('alice')}}:lock`, { value: 1, expiresAt: Number.POSITIVE_INFINITY });

    expect(await lockout.check('alice')).toEqual({ locked: true, retryAfterSeconds: 900 });
    fake.advance(900_000);
    expect(await lockout.check('alice')).toEqual({ locked: false });
  });
});
