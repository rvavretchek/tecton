import { Redis } from 'ioredis';
import { systemClock, type Clock } from '../clock.js';
import { assertRevocationId, RevocationStoreUnavailableError, type TokenRevocationStore } from './token-revocation-store.js';

/** Skew accepted on `exp` by the token verifier (Story 2.4): a revocation must outlive it. */
export const REVOCATION_CLOCK_TOLERANCE_SECONDS = 30;
export const DEFAULT_REVOCATION_TIMEOUT_MS = 500;
export const REVOCATION_TIMEOUT_LIMITS = { min: 50, max: 5_000 } as const;
export const DEFAULT_REVOCATION_KEY_PREFIX = 'tecton:revocation:';
/** Longest access token lifetime (Auth: TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS at most 3600). */
export const DEFAULT_MAX_TOKEN_LIFETIME_SECONDS = 3_600;

/** Invalid revocation store configuration. Messages name the setting, never its value. */
export class RevocationStoreConfigError extends Error {
  override readonly name = 'RevocationStoreConfigError';
}

/** The commands this adapter uses; an ioredis client satisfies it, and tests inject a fake. */
export interface RevocationClient {
  set(key: string, value: string, mode: 'PX', milliseconds: number): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  quit(): Promise<unknown>;
}

export interface ValkeyTokenRevocationStoreOptions {
  /** redis:// or rediss:// (TLS). Ignored when `client` is given. */
  url?: string;
  /** Injected client (tests); the store then never creates a connection. */
  client?: RevocationClient;
  /** Time limit of one command, in milliseconds (default 500). */
  timeoutMs?: number;
  keyPrefix?: string;
  /** How long a subject revocation is kept: the longest access token lifetime (default 3600 s). */
  maxTokenLifetimeSeconds?: number;
  clock?: Clock;
  /** Connection errors of the client (the process would crash on an unhandled one). */
  onError?: (error: Error) => void;
}

// Records the subject revocation instant only if it is later than the stored one (never moves it
// back), and keeps it for the longest token lifetime either way.
const REVOKE_SUBJECT = `
local current = tonumber(redis.call('GET', KEYS[1]))
local value = tonumber(ARGV[1])
if current == nil or current < value then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
else
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 1
`;

const DECIMAL = /^\d+$/;

function validatedTimeout(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs < REVOCATION_TIMEOUT_LIMITS.min || timeoutMs > REVOCATION_TIMEOUT_LIMITS.max) {
    throw new RevocationStoreConfigError(
      `the revocation timeout must be an integer between ${REVOCATION_TIMEOUT_LIMITS.min} and ${REVOCATION_TIMEOUT_LIMITS.max} milliseconds`,
    );
  }
  return timeoutMs;
}

/**
 * The ioredis client of the store: every command fails at once when there is no connection (no
 * offline queue, no retry per command) and after `timeoutMs` when Valkey does not answer, so a
 * check never waits and never passes for "not revoked". It keeps reconnecting in the background.
 */
function createClient(url: string, timeoutMs: number, onError: (error: Error) => void): RevocationClient {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new RevocationStoreConfigError('the Valkey URL is not a valid URL');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new RevocationStoreConfigError('the Valkey URL must use redis:// or rediss://');
  }
  const client = new Redis(url.trim(), {
    commandTimeout: timeoutMs,
    connectTimeout: Math.max(timeoutMs * 4, 1_000),
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    lazyConnect: true,
  });
  client.on('error', onError);
  // Connects in the background: the service starts even if Valkey is down, and refuses checks
  // (503) until it is reachable.
  client.connect().catch(() => undefined);
  return client;
}

/** TokenRevocationStore backed by Valkey (FR-14, reference adapter). */
export function createValkeyTokenRevocationStore(options: ValkeyTokenRevocationStoreOptions): TokenRevocationStore {
  const timeoutMs = validatedTimeout(options.timeoutMs ?? DEFAULT_REVOCATION_TIMEOUT_MS);
  const prefix = options.keyPrefix ?? DEFAULT_REVOCATION_KEY_PREFIX;
  const lifetime = options.maxTokenLifetimeSeconds ?? DEFAULT_MAX_TOKEN_LIFETIME_SECONDS;
  if (!Number.isInteger(lifetime) || lifetime < 1) throw new RevocationStoreConfigError('maxTokenLifetimeSeconds must be a positive integer');
  const clock = options.clock ?? systemClock;
  let client: RevocationClient;
  if (options.client) {
    client = options.client;
  } else {
    if (!options.url) throw new RevocationStoreConfigError('a Valkey URL or a client is required');
    client = createClient(options.url, timeoutMs, options.onError ?? (() => undefined));
  }
  const jtiKey = (tokenId: string) => `${prefix}jti:${tokenId}`;
  const subjectKey = (subject: string) => `${prefix}sub:${subject}`;
  const call = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      // Reason only (timeout, connection refused...): ioredis messages carry no credentials, but
      // the URL is never added to them.
      throw new RevocationStoreUnavailableError(`revocation store unavailable: ${error instanceof Error ? error.message : 'unknown error'}`, {
        cause: error,
      });
    }
  };

  return {
    async revokeToken({ tokenId, expiresAt }) {
      assertRevocationId('tokenId', tokenId);
      const remaining = expiresAt.getTime() + REVOCATION_CLOCK_TOLERANCE_SECONDS * 1000 - clock.now().getTime();
      if (remaining <= 0) return;
      await call(() => client.set(jtiKey(tokenId), '1', 'PX', Math.ceil(remaining)));
    },

    async revokeSubject({ subject, at }) {
      assertRevocationId('subject', subject);
      const instant = at.getTime();
      if (!Number.isFinite(instant)) throw new RangeError('at must be a valid date');
      await call(() => client.eval(REVOKE_SUBJECT, 1, subjectKey(subject), String(instant), lifetime + REVOCATION_CLOCK_TOLERANCE_SECONDS));
    },

    async isRevoked({ tokenId, subject, issuedAt }) {
      assertRevocationId('tokenId', tokenId);
      assertRevocationId('subject', subject);
      const values = await call(() => client.mget(jtiKey(tokenId), subjectKey(subject)));
      if (!Array.isArray(values) || values.length !== 2) throw new RevocationStoreUnavailableError('revocation store unavailable: unexpected reply');
      const [byToken, bySubject] = values;
      if (byToken !== null && byToken !== undefined) return true;
      if (bySubject === null || bySubject === undefined) return false;
      // A value that is not a decimal instant is corrupt: count it as revoked (fail closed).
      if (!DECIMAL.test(bySubject)) return true;
      return issuedAt.getTime() <= Number(bySubject);
    },

    close: async () => {
      await client.quit().catch(() => undefined);
    },
  };
}

/**
 * The store of a service from its environment: TECTON_VALKEY_URL (required) and
 * TECTON_REVOCATION_TIMEOUT_MS (optional, decimal integer 50-5000).
 */
export function tokenRevocationStoreFromEnv(
  env: NodeJS.ProcessEnv,
  options: Omit<ValkeyTokenRevocationStoreOptions, 'url' | 'client' | 'timeoutMs'> = {},
): TokenRevocationStore {
  const url = env['TECTON_VALKEY_URL']?.trim();
  if (!url) throw new RevocationStoreConfigError('TECTON_VALKEY_URL is not set; point it to the Valkey that keeps token revocations');
  const rawTimeout = env['TECTON_REVOCATION_TIMEOUT_MS']?.trim();
  let timeoutMs = DEFAULT_REVOCATION_TIMEOUT_MS;
  if (rawTimeout) {
    timeoutMs = DECIMAL.test(rawTimeout) ? Number(rawTimeout) : Number.NaN;
    if (!Number.isInteger(timeoutMs) || timeoutMs < REVOCATION_TIMEOUT_LIMITS.min || timeoutMs > REVOCATION_TIMEOUT_LIMITS.max) {
      throw new RevocationStoreConfigError(
        `TECTON_REVOCATION_TIMEOUT_MS must be a decimal integer between ${REVOCATION_TIMEOUT_LIMITS.min} and ${REVOCATION_TIMEOUT_LIMITS.max}`,
      );
    }
  }
  try {
    return createValkeyTokenRevocationStore({ ...options, url, timeoutMs });
  } catch (error) {
    if (error instanceof RevocationStoreConfigError) throw new RevocationStoreConfigError(`TECTON_VALKEY_URL: ${error.message}`);
    throw error;
  }
}
