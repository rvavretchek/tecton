import { Redis } from 'ioredis';

// The one way Tecton opens a Valkey connection (Stories 2.5 and 2.6): fail closed, never waiting.

export const DEFAULT_VALKEY_TIMEOUT_MS = 500;
export const VALKEY_TIMEOUT_LIMITS = { min: 50, max: 5_000 } as const;

/** Invalid Valkey configuration. Messages name the setting, never its value (the URL may hold a password). */
export class ValkeyConfigError extends Error {
  override readonly name: string = 'ValkeyConfigError';
}

/** A Valkey connection as the adapters use it (an ioredis client). */
export type ValkeyClient = Redis;

export interface ValkeyClientOptions {
  /** redis:// or rediss:// (TLS), with a host. */
  url: string;
  /** Time limit of one command, in milliseconds (default 500). */
  timeoutMs?: number;
  /** Connection errors (the process would crash on an unhandled one). */
  onError?: (error: Error) => void;
}

export function validatedValkeyTimeout(timeoutMs: number): number {
  if (!Number.isInteger(timeoutMs) || timeoutMs < VALKEY_TIMEOUT_LIMITS.min || timeoutMs > VALKEY_TIMEOUT_LIMITS.max) {
    throw new ValkeyConfigError(
      `the Valkey timeout must be an integer between ${VALKEY_TIMEOUT_LIMITS.min} and ${VALKEY_TIMEOUT_LIMITS.max} milliseconds`,
    );
  }
  return timeoutMs;
}

/**
 * Opens a Valkey client where every command fails at once without a connection (no offline
 * queue, no retry per command) and after `timeoutMs` when Valkey does not answer: a check never
 * waits and never passes by default. It connects and reconnects in the background, so a service
 * starts even when Valkey is down and refuses requests (503) until it is reachable.
 */
export function createValkeyClient({ url, timeoutMs = DEFAULT_VALKEY_TIMEOUT_MS, onError = () => undefined }: ValkeyClientOptions): ValkeyClient {
  const timeout = validatedValkeyTimeout(timeoutMs);
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ValkeyConfigError('the Valkey URL is not a valid URL');
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') throw new ValkeyConfigError('the Valkey URL must use redis:// or rediss://');
  // ioredis would fall back to localhost:6379 without a word.
  if (parsed.hostname === '') throw new ValkeyConfigError('the Valkey URL must name a host');
  const client = new Redis(url.trim(), {
    commandTimeout: timeout,
    connectTimeout: Math.max(timeout * 4, 1_000),
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    lazyConnect: true,
  });
  client.on('error', onError);
  client.connect().catch(() => undefined);
  return client;
}

/**
 * Closes a client for good. quit() lets pending replies arrive, but it is refused while there is
 * no connection (no offline queue) and stalls on a silent Valkey; then the client is dropped, or it
 * would keep reconnecting forever and the process would never exit.
 */
export async function closeValkeyClient(client: { quit(): Promise<unknown>; disconnect(): void }): Promise<void> {
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

/**
 * The Valkey client of a service from its environment: TECTON_VALKEY_URL (required) and
 * TECTON_REVOCATION_TIMEOUT_MS (optional, decimal integer 50-5000; the time limit of every Valkey
 * command of the service, named after its first use).
 */
export function valkeyClientFromEnv(env: NodeJS.ProcessEnv, options: { onError?: (error: Error) => void } = {}): ValkeyClient {
  const url = env['TECTON_VALKEY_URL']?.trim();
  if (!url) throw new ValkeyConfigError('TECTON_VALKEY_URL is not set; point it to the Valkey that keeps token revocations');
  const rawTimeout = env['TECTON_REVOCATION_TIMEOUT_MS']?.trim();
  let timeoutMs = DEFAULT_VALKEY_TIMEOUT_MS;
  if (rawTimeout) {
    timeoutMs = /^\d+$/.test(rawTimeout) ? Number(rawTimeout) : Number.NaN;
    if (!Number.isInteger(timeoutMs) || timeoutMs < VALKEY_TIMEOUT_LIMITS.min || timeoutMs > VALKEY_TIMEOUT_LIMITS.max) {
      throw new ValkeyConfigError(
        `TECTON_REVOCATION_TIMEOUT_MS must be a decimal integer between ${VALKEY_TIMEOUT_LIMITS.min} and ${VALKEY_TIMEOUT_LIMITS.max}`,
      );
    }
  }
  try {
    return createValkeyClient({ url, timeoutMs, ...(options.onError ? { onError: options.onError } : {}) });
  } catch (error) {
    if (error instanceof ValkeyConfigError) throw new ValkeyConfigError(`TECTON_VALKEY_URL: ${error.message}`);
    throw error;
  }
}
