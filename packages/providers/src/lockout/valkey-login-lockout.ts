import { createHash } from 'node:crypto';
import { closeValkeyClient } from '../valkey/valkey-client.js';
import {
  assertLockoutIdentifier,
  LOGIN_LOCKOUT_LIMITS,
  LoginLockoutConfigError,
  LoginLockoutUnavailableError,
  lockoutPolicy,
  type LoginLockout,
  type LoginLockoutPolicy,
} from './login-lockout.js';

export const DEFAULT_LOCKOUT_KEY_PREFIX = 'tecton:lockout:';

/** The commands this adapter uses; an ioredis client satisfies it, and tests inject a fake. */
export interface LockoutClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  pttl(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  del(...keys: string[]): Promise<number>;
  quit(): Promise<unknown>;
  disconnect(): void;
}

export interface ValkeyLoginLockoutOptions extends Partial<LoginLockoutPolicy> {
  client: LockoutClient;
  /** The client is shared with other adapters: closing the lockout leaves it open. */
  shared?: boolean;
  keyPrefix?: string;
}

// One failure. While a lock exists, nothing is counted and the lock is never extended (attempts
// that passed the check before the lock was set end here). Otherwise it is counted in a window
// that starts at the first failure; at the limit, the lock is set and the counter cleared.
// Returns {1, lock ms} when this failure locked, {2, ttl} when already locked, {0, count} otherwise.
const RECORD_FAILURE = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return {2, redis.call('PTTL', KEYS[2])}
end
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
if count >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3], 'NX')
  redis.call('DEL', KEYS[1])
  return {1, tonumber(ARGV[3])}
end
return {0, count}
`;

/** LoginLockout backed by Valkey: the counter is shared by every instance of the Auth service. */
export function createValkeyLoginLockout(options: ValkeyLoginLockoutOptions): LoginLockout {
  const { client } = options;
  const policy = lockoutPolicy({
    ...(options.maxFailures === undefined ? {} : { maxFailures: options.maxFailures }),
    ...(options.windowSeconds === undefined ? {} : { windowSeconds: options.windowSeconds }),
    ...(options.lockSeconds === undefined ? {} : { lockSeconds: options.lockSeconds }),
  });
  const prefix = options.keyPrefix ?? DEFAULT_LOCKOUT_KEY_PREFIX;
  // The login (often an e-mail) never sits in Valkey in clear text, and keys have a fixed size.
  // The {hash} tag keeps both keys of the script in one slot on a Valkey Cluster.
  const keys = (identifier: string) => {
    assertLockoutIdentifier(identifier);
    const hash = createHash('sha256').update(identifier, 'utf8').digest('hex');
    return { failures: `${prefix}{${hash}}:fail`, lock: `${prefix}{${hash}}:lock` };
  };
  const call = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw new LoginLockoutUnavailableError(`login lockout unavailable: ${error instanceof Error ? error.message : 'unknown error'}`, { cause: error });
    }
  };

  return {
    async check(identifier) {
      const { lock } = keys(identifier);
      const ttl = await call(() => client.pttl(lock));
      if (typeof ttl !== 'number' || Number.isNaN(ttl)) throw new LoginLockoutUnavailableError('login lockout unavailable: unexpected reply');
      // -2: no lock.
      if (ttl === -2) return { locked: false };
      // -1: a lock key without expiry (written by hand?) would lock forever: give it the duration.
      if (ttl < 0) {
        await call(() => client.pexpire(lock, policy.lockSeconds * 1000));
        return { locked: true, retryAfterSeconds: policy.lockSeconds };
      }
      return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)) };
    },

    async recordFailure(identifier) {
      const { failures, lock } = keys(identifier);
      const reply = await call(() =>
        client.eval(RECORD_FAILURE, 2, failures, lock, policy.windowSeconds * 1000, policy.maxFailures, policy.lockSeconds * 1000),
      );
      if (!Array.isArray(reply) || reply.length !== 2) throw new LoginLockoutUnavailableError('login lockout unavailable: unexpected reply');
      return Number(reply[0]) === 1 ? { lockedNow: true, lockSeconds: policy.lockSeconds } : { lockedNow: false };
    },

    async clearFailures(identifier) {
      const { failures } = keys(identifier);
      await call(() => client.del(failures));
    },

    async reset(identifier) {
      const { failures, lock } = keys(identifier);
      const removed = await call(() => client.del(failures, lock));
      return Number(removed) > 0;
    },

    close: async () => {
      if (!options.shared) await closeValkeyClient(client);
    },
  };
}

const DECIMAL = /^\d+$/;

/**
 * The lockout policy from the environment: TECTON_AUTH_LOCKOUT_MAX_FAILURES (default 5),
 * TECTON_AUTH_LOCKOUT_WINDOW_SECONDS (900) and TECTON_AUTH_LOCKOUT_DURATION_SECONDS (900).
 */
export function lockoutPolicyFromEnv(env: NodeJS.ProcessEnv): LoginLockoutPolicy {
  const read = (variable: string, key: keyof LoginLockoutPolicy): Partial<LoginLockoutPolicy> => {
    const raw = env[variable]?.trim();
    if (!raw) return {};
    const { min, max } = LOGIN_LOCKOUT_LIMITS[key];
    const value = DECIMAL.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new LoginLockoutConfigError(`${variable} must be a decimal integer between ${min} and ${max}`);
    }
    return { [key]: value };
  };
  return lockoutPolicy({
    ...read('TECTON_AUTH_LOCKOUT_MAX_FAILURES', 'maxFailures'),
    ...read('TECTON_AUTH_LOCKOUT_WINDOW_SECONDS', 'windowSeconds'),
    ...read('TECTON_AUTH_LOCKOUT_DURATION_SECONDS', 'lockSeconds'),
  });
}
