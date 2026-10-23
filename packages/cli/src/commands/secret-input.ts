import type { CliIo } from '../io.js';

/** A secret that could not be read; the message says how to provide it. */
export class SecretInputError extends Error {}

/** Removes exactly one trailing line break (what `echo` adds), keeping any other character. */
function stripOneLineBreak(text: string): string {
  if (text.endsWith('\r\n')) return text.slice(0, -2);
  if (text.endsWith('\n')) return text.slice(0, -1);
  return text;
}

export interface SecretSource {
  /** Environment variable that holds the secret. */
  variable: string;
  /** Example command piping the secret, shown when none is given. */
  example: string;
  /** How long to wait for a piped secret before giving up. */
  timeoutMs: number;
}

/**
 * Reads a secret from its environment variable or, when unset, from standard input. Never from an
 * interactive terminal (the secret would be echoed) and never from an argument (it would stay in
 * the shell history and the process list).
 */
export async function readSecret(io: CliIo, env: NodeJS.ProcessEnv, { variable, example, timeoutMs }: SecretSource): Promise<string> {
  const missing = `no password given; set ${variable} or pipe it to standard input (e.g. ${example})`;
  const fromEnv = env[variable];
  if (fromEnv !== undefined) {
    // Set but empty is a mistake, not a request to read standard input instead.
    if (fromEnv === '') throw new SecretInputError(`${variable} is set but empty`);
    return fromEnv;
  }
  if (!io.stdin || io.stdin.isTTY) throw new SecretInputError(missing);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new SecretInputError(`${missing}; standard input did not close within ${timeoutMs} ms`)), timeoutMs);
    timer.unref();
  });
  try {
    const fromStdin = stripOneLineBreak(await Promise.race([io.stdin.readAll(), timeout]));
    if (fromStdin === '') throw new SecretInputError(missing);
    return fromStdin;
  } finally {
    clearTimeout(timer);
  }
}
