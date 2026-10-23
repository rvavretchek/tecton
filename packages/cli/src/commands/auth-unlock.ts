import { InvalidLoginError, normalizeLogin } from '@tecton/auth';
import {
  createValkeyLoginLockout,
  LoginLockoutUnavailableError,
  ValkeyConfigError,
  valkeyClientFromEnv,
  waitForValkeyReady,
  type LoginLockout,
} from '@tecton/providers';
import type { CliIo } from '../io.js';

export const VALKEY_URL_VARIABLE = 'TECTON_VALKEY_URL';
/** How long the command waits for the Valkey connection before giving up. */
export const UNLOCK_CONNECT_TIMEOUT_MS = 5_000;

/** Replaceable for tests; production opens the Valkey of the Auth service from the environment. */
export interface AuthUnlockDependencies {
  /** The lockout, and a way to wait until its connection is ready (no command is queued before). */
  createLockout(env: NodeJS.ProcessEnv): { lockout: LoginLockout; ready(timeoutMs: number): Promise<boolean> };
}

const defaultDependencies: AuthUnlockDependencies = {
  createLockout: (env) => {
    const client = valkeyClientFromEnv(env);
    // The lockout owns the client it is given here: closing it closes the connection.
    return { lockout: createValkeyLoginLockout({ client }), ready: (timeoutMs) => waitForValkeyReady(client, timeoutMs) };
  },
};

/**
 * `tecton-admin auth unlock <identifier>`: removes the login lockout and the failure count of one
 * identifier (Story 2.6), directly in the Valkey of the Auth service (local access only; there is
 * no HTTP endpoint for it). The identifier is normalized like a login. Unlocking an identifier that
 * is not locked succeeds (nothing to do) and says so. Exit codes: 0 done, 1 any failure.
 */
export async function authUnlockCommand(identifier: string, io: CliIo, dependencies: AuthUnlockDependencies = defaultDependencies): Promise<number> {
  const env = io.env ?? process.env;
  const fail = (message: string) => {
    io.stderr.write(`auth unlock failed: ${message}\n`);
    return 1;
  };

  let normalized: string;
  try {
    normalized = normalizeLogin(identifier);
  } catch (error) {
    if (error instanceof InvalidLoginError) return fail(error.message);
    throw error;
  }

  let opened: ReturnType<AuthUnlockDependencies['createLockout']>;
  try {
    opened = dependencies.createLockout(env);
  } catch (error) {
    // Names the variable, never the URL (it may hold a password).
    if (error instanceof ValkeyConfigError) return fail(error.message);
    throw error;
  }
  const unreachable = `could not reach Valkey; check that ${VALKEY_URL_VARIABLE} points to the Valkey of the Auth service`;
  try {
    // Without an offline queue, a command sent while the connection is still opening is refused.
    if (!(await opened.ready(UNLOCK_CONNECT_TIMEOUT_MS))) return fail(unreachable);
    const removed = await opened.lockout.reset(normalized);
    io.stdout.write(
      removed
        ? `Unlocked "${normalized}": its lockout and failure count were removed.\n`
        : `"${normalized}" had no lockout or failure count; nothing to remove.\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof LoginLockoutUnavailableError) return fail(unreachable);
    throw error;
  } finally {
    try {
      await opened.lockout.close();
    } catch {
      // Closing must never hide the outcome above.
    }
  }
}
