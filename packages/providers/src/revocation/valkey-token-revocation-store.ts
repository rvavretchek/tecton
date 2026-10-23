import { systemClock, type Clock } from '../clock.js';
import { closeValkeyClient, createValkeyClient, DEFAULT_VALKEY_TIMEOUT_MS, VALKEY_TIMEOUT_LIMITS, ValkeyConfigError, valkeyClientFromEnv } from '../valkey/valkey-client.js';
import { assertRevocationId, RevocationStoreUnavailableError, type TokenRevocationStore } from './token-revocation-store.js';

/**
 * How long a revocation outlives what it covers: the 30 s the verifier accepts past `exp`
 * (Story 2.4) plus 30 s more for a verifier whose clock runs behind the Auth service's.
 */
export const REVOCATION_CLOCK_TOLERANCE_SECONDS = 60;
export const DEFAULT_REVOCATION_TIMEOUT_MS = DEFAULT_VALKEY_TIMEOUT_MS;
export const REVOCATION_TIMEOUT_LIMITS = VALKEY_TIMEOUT_LIMITS;
export const DEFAULT_REVOCATION_KEY_PREFIX = 'tecton:revocation:';
/** Longest access token lifetime (Auth: TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS at most 3600). */
export const DEFAULT_MAX_TOKEN_LIFETIME_SECONDS = 3_600;

/** Invalid revocation store configuration. Messages name the setting, never its value. */
export class RevocationStoreConfigError extends ValkeyConfigError {
  override readonly name = 'RevocationStoreConfigError';
}

/** The commands this adapter uses; an ioredis client satisfies it, and tests inject a fake. */
export interface RevocationClient {
  set(key: string, value: string, mode: 'PX', milliseconds: number): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  quit(): Promise<unknown>;
  /** Drops the connection at once, also while connecting or reconnecting (where quit is refused). */
  disconnect(): void;
}

export interface ValkeyTokenRevocationStoreOptions {
  /** redis:// or rediss:// (TLS). Ignored when `client` is given. */
  url?: string;
  /** A client given by the caller (tests, or a connection shared with other adapters). */
  client?: RevocationClient;
  /**
   * The given client is shared: closing the store leaves it open (its owner closes it). Without
   * this, the store closes the client it was given, as it closes the one it creates.
   */
  shared?: boolean;
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

/** TokenRevocationStore backed by Valkey (FR-14, reference adapter). */
export function createValkeyTokenRevocationStore(options: ValkeyTokenRevocationStoreOptions): TokenRevocationStore {
  const prefix = options.keyPrefix ?? DEFAULT_REVOCATION_KEY_PREFIX;
  const lifetime = options.maxTokenLifetimeSeconds ?? DEFAULT_MAX_TOKEN_LIFETIME_SECONDS;
  if (!Number.isInteger(lifetime) || lifetime < 1) throw new RevocationStoreConfigError('maxTokenLifetimeSeconds must be a positive integer');
  const clock = options.clock ?? systemClock;
  let client: RevocationClient;
  if (options.client) {
    client = options.client;
  } else {
    if (!options.url) throw new RevocationStoreConfigError('a Valkey URL or a client is required');
    try {
      client = createValkeyClient({
        url: options.url,
        timeoutMs: options.timeoutMs ?? DEFAULT_REVOCATION_TIMEOUT_MS,
        ...(options.onError ? { onError: options.onError } : {}),
      });
    } catch (error) {
      if (error instanceof ValkeyConfigError) throw new RevocationStoreConfigError(error.message);
      throw error;
    }
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
      if (!Number.isFinite(expiresAt.getTime())) throw new RangeError('expiresAt must be a valid date');
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
      if (!options.shared) await closeValkeyClient(client);
    },
  };
}

/**
 * The store of a service from its environment: TECTON_VALKEY_URL (required) and
 * TECTON_VALKEY_TIMEOUT_MS (optional, decimal integer 50-5000; TECTON_REVOCATION_TIMEOUT_MS still read).
 */
export function tokenRevocationStoreFromEnv(
  env: NodeJS.ProcessEnv,
  options: Omit<ValkeyTokenRevocationStoreOptions, 'url' | 'client' | 'timeoutMs' | 'shared'> = {},
): TokenRevocationStore {
  // The store options are checked before a connection is opened, so a bad one leaks nothing.
  const lifetime = options.maxTokenLifetimeSeconds ?? DEFAULT_MAX_TOKEN_LIFETIME_SECONDS;
  if (!Number.isInteger(lifetime) || lifetime < 1) throw new RevocationStoreConfigError('maxTokenLifetimeSeconds must be a positive integer');
  let client: RevocationClient;
  try {
    client = valkeyClientFromEnv(env, options.onError ? { onError: options.onError } : {});
  } catch (error) {
    if (error instanceof ValkeyConfigError) throw new RevocationStoreConfigError(error.message);
    throw error;
  }
  // The store owns the client it opened here.
  return createValkeyTokenRevocationStore({ ...options, client });
}
