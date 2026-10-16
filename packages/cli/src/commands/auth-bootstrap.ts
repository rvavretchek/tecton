import {
  AlreadyBootstrappedError,
  bootstrapAdmin,
  createPrismaCredentialStore,
  InvalidLoginError,
  PasswordPolicyError,
  UnsupportedDatabaseUrlError,
  type CredentialStore,
} from '@tecton/auth';
import { createArgon2idAuthProvider, PepperConfigError, pepperFromEnv, systemClock, type Clock, type Pepper } from '@tecton/providers';
import type { CliIo } from '../io.js';

export const BOOTSTRAP_PASSWORD_VARIABLE = 'TECTON_AUTH_BOOTSTRAP_PASSWORD';
export const AUTH_DATABASE_URL_VARIABLE = 'TECTON_AUTH_DATABASE_URL';
/** Exit code when the Auth database already has credentials, so scripts can tell it from a failure. */
export const EXIT_ALREADY_BOOTSTRAPPED = 2;

export interface AuthBootstrapOptions {
  login: string;
}

/** Replaceable for tests; production uses the Prisma adapter and the system clock. */
export interface AuthBootstrapDependencies {
  createStore(databaseUrl: string): CredentialStore;
  clock: Clock;
  /** How long to wait for a piped password before giving up. Default 10 s. */
  stdinTimeoutMs?: number;
}

const defaultDependencies: AuthBootstrapDependencies = {
  createStore: (databaseUrl) => createPrismaCredentialStore({ databaseUrl }),
  clock: systemClock,
};

class InputError extends Error {}

/** Removes exactly one trailing line break (what `echo` adds), keeping any other character. */
function stripOneLineBreak(text: string): string {
  if (text.endsWith('\r\n')) return text.slice(0, -2);
  if (text.endsWith('\n')) return text.slice(0, -1);
  return text;
}

const NO_PASSWORD =
  `no password given; set ${BOOTSTRAP_PASSWORD_VARIABLE} or pipe it to standard input ` +
  `(e.g. printf '%s' "$PASSWORD" | tecton-admin auth bootstrap --login admin)`;

async function readPassword(io: CliIo, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string> {
  const fromEnv = env[BOOTSTRAP_PASSWORD_VARIABLE];
  if (fromEnv !== undefined) {
    // Set but empty is a mistake, not a request to read standard input instead.
    if (fromEnv === '') throw new InputError(`${BOOTSTRAP_PASSWORD_VARIABLE} is set but empty`);
    return fromEnv;
  }
  // Never read an interactive terminal: the password would be echoed.
  if (!io.stdin || io.stdin.isTTY) throw new InputError(NO_PASSWORD);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new InputError(`${NO_PASSWORD}; standard input did not close within ${timeoutMs} ms`)), timeoutMs);
    timer.unref();
  });
  try {
    const fromStdin = stripOneLineBreak(await Promise.race([io.stdin.readAll(), timeout]));
    if (fromStdin === '') throw new InputError(NO_PASSWORD);
    return fromStdin;
  } finally {
    clearTimeout(timer);
  }
}

/** Summary of an unexpected error without its message, which may carry the connection string. */
function describeUnexpected(error: unknown): string {
  if (!(error instanceof Error)) return 'unexpected error';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? `${error.name} ${code}` : error.name;
}

/**
 * `tecton-admin auth bootstrap --login <identifier>`: creates the first administrator credential
 * directly in the Auth database (local access only; there is no HTTP endpoint for it, AD-7).
 * The password comes from TECTON_AUTH_BOOTSTRAP_PASSWORD or standard input, never an argument.
 * Exit codes: 0 created, 2 already bootstrapped (nothing changed), 1 any failure.
 */
export async function authBootstrapCommand(
  options: AuthBootstrapOptions,
  io: CliIo,
  dependencies: AuthBootstrapDependencies = defaultDependencies,
): Promise<number> {
  const env = io.env ?? process.env;
  const fail = (message: string) => {
    io.stderr.write(`auth bootstrap failed: ${message}\n`);
    return 1;
  };

  const databaseUrl = env[AUTH_DATABASE_URL_VARIABLE];
  if (!databaseUrl) return fail(`${AUTH_DATABASE_URL_VARIABLE} is not set; point it to the Auth database`);
  let pepper: Pepper;
  let password: string;
  try {
    pepper = pepperFromEnv(env);
    password = await readPassword(io, env, dependencies.stdinTimeoutMs ?? 10_000);
  } catch (error) {
    if (error instanceof PepperConfigError || error instanceof InputError) return fail(error.message);
    throw error;
  }

  let store: CredentialStore;
  try {
    store = dependencies.createStore(databaseUrl);
  } catch (error) {
    if (error instanceof UnsupportedDatabaseUrlError) return fail(error.message);
    return fail(`could not open the Auth database (${describeUnexpected(error)})`);
  }
  try {
    const auth = createArgon2idAuthProvider({ peppers: [pepper], currentPepperId: pepper.id });
    const created = await bootstrapAdmin({ store, auth, clock: dependencies.clock, login: options.login, password });
    io.stdout.write(
      `Created the first administrator credential "${created.login}" with permissions: ${created.permissions.join(', ')}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof AlreadyBootstrappedError) {
      io.stderr.write(`auth bootstrap refused: ${error.message}\n`);
      return EXIT_ALREADY_BOOTSTRAPPED;
    }
    if (error instanceof InvalidLoginError || error instanceof PasswordPolicyError) return fail(error.message);
    // Database and driver errors: never print the error itself, it may contain the URL.
    return fail(
      `could not complete the bootstrap (${describeUnexpected(error)}); check that ${AUTH_DATABASE_URL_VARIABLE} ` +
        'points to a reachable Auth database with its migrations applied',
    );
  } finally {
    try {
      await store.close();
    } catch {
      // Closing must never hide the outcome above.
    }
  }
}
