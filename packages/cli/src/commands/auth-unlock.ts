import { InvalidLoginError, normalizeLogin } from '@tecton/auth';
import { createValkeyLoginLockout, LoginLockoutUnavailableError, ValkeyConfigError, valkeyClientFromEnv, type LoginLockout } from '@tecton/providers';
import type { CliIo } from '../io.js';

export const VALKEY_URL_VARIABLE = 'TECTON_VALKEY_URL';

/** Replaceable for tests; production opens the Valkey of the Auth service from the environment. */
export interface AuthUnlockDependencies {
  createLockout(env: NodeJS.ProcessEnv): LoginLockout;
}

const defaultDependencies: AuthUnlockDependencies = {
  // The lockout owns the client it is given here: closing it closes the connection.
  createLockout: (env) => createValkeyLoginLockout({ client: valkeyClientFromEnv(env) }),
};

/**
 * `tecton-admin auth unlock <identifier>`: removes the login lockout and the failure count of one
 * identifier (Story 2.6), directly in the Valkey of the Auth service (local access only; there is
 * no HTTP endpoint for it). The identifier is normalized like a login. Unlocking an identifier that
 * is not locked succeeds (nothing to do). Exit codes: 0 unlocked, 1 any failure.
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

  let lockout: LoginLockout;
  try {
    lockout = dependencies.createLockout(env);
  } catch (error) {
    // Names the variable, never the URL (it may hold a password).
    if (error instanceof ValkeyConfigError) return fail(error.message);
    throw error;
  }
  try {
    await lockout.reset(normalized);
    io.stdout.write(`Unlocked "${normalized}": its lockout and failure count were removed.\n`);
    return 0;
  } catch (error) {
    if (error instanceof LoginLockoutUnavailableError) {
      return fail(`could not reach Valkey; check that ${VALKEY_URL_VARIABLE} points to the Valkey of the Auth service`);
    }
    throw error;
  } finally {
    try {
      await lockout.close();
    } catch {
      // Closing must never hide the outcome above.
    }
  }
}
