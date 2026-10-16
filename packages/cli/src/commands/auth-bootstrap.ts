import {
  AlreadyBootstrappedError,
  bootstrapAdmin,
  createPrismaCredentialStore,
  InvalidLoginError,
  UnsupportedDatabaseUrlError,
  type CredentialStore,
} from '@tecton/auth';
import { createArgon2idAuthProvider, PepperConfigError, pepperFromEnv, systemClock, type Clock } from '@tecton/providers';
import type { CliIo } from '../io.js';

export const BOOTSTRAP_PASSWORD_VARIABLE = 'TECTON_AUTH_BOOTSTRAP_PASSWORD';
export const AUTH_DATABASE_URL_VARIABLE = 'TECTON_AUTH_DATABASE_URL';

export interface AuthBootstrapOptions {
  login: string;
}

/** Replaceable for tests; production uses the Prisma adapter and the system clock. */
export interface AuthBootstrapDependencies {
  createStore(databaseUrl: string): CredentialStore;
  clock: Clock;
}

const defaultDependencies: AuthBootstrapDependencies = {
  createStore: (databaseUrl) => createPrismaCredentialStore({ databaseUrl }),
  clock: systemClock,
};

/** Removes exactly one trailing line break (what `echo` adds), keeping any other character. */
function stripOneLineBreak(text: string): string {
  if (text.endsWith('\r\n')) return text.slice(0, -2);
  if (text.endsWith('\n')) return text.slice(0, -1);
  return text;
}

async function readPassword(io: CliIo, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const fromEnv = env[BOOTSTRAP_PASSWORD_VARIABLE];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  if (!io.stdin || io.stdin.isTTY) return undefined;
  const fromStdin = stripOneLineBreak(await io.stdin.readAll());
  return fromStdin === '' ? undefined : fromStdin;
}

/**
 * `tecton-admin auth bootstrap --login <identifier>`: creates the first administrator credential
 * directly in the Auth database (local access only; there is no HTTP endpoint for it, AD-7).
 * The password comes from TECTON_AUTH_BOOTSTRAP_PASSWORD or standard input, never an argument.
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
  let pepper;
  try {
    pepper = pepperFromEnv(env);
  } catch (error) {
    if (error instanceof PepperConfigError) return fail(error.message);
    throw error;
  }
  const password = await readPassword(io, env);
  if (password === undefined) {
    return fail(
      `no password given; set ${BOOTSTRAP_PASSWORD_VARIABLE} or pipe it to standard input ` +
        `(e.g. printf '%s' "$PASSWORD" | tecton-admin auth bootstrap --login admin)`,
    );
  }

  let store: CredentialStore;
  try {
    store = dependencies.createStore(databaseUrl);
  } catch (error) {
    if (error instanceof UnsupportedDatabaseUrlError) return fail(error.message);
    throw error;
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
      return 1;
    }
    if (error instanceof InvalidLoginError || error instanceof RangeError) return fail(error.message);
    throw error;
  } finally {
    await store.close();
  }
}
