/**
 * Pepper: a secret key applied (HMAC-SHA256) to every password before hashing, stored
 * outside the database. The id travels in each hash so Peppers can be rotated.
 */
export interface Pepper {
  /** Version id, stored in the hash as the PHC `keyid`: 1-8 characters of [A-Za-z0-9_-]. */
  id: string;
  /** At least 32 bytes. */
  key: Buffer;
}

export const MIN_PEPPER_BYTES = 32;
const PEPPER_ID = /^[A-Za-z0-9_-]{1,8}$/;
// Space, tab, line feed, carriage return: a secret read from a file often ends with a newline.
const WHITESPACE_BYTES = new Set([0x20, 0x09, 0x0a, 0x0d]);

/** Invalid or missing Pepper configuration. The message never contains the Pepper value. */
export class PepperConfigError extends Error {
  override readonly name = 'PepperConfigError';
}

export function isValidPepperId(id: unknown): id is string {
  return typeof id === 'string' && PEPPER_ID.test(id);
}

/**
 * Throws a PepperConfigError when `pepper` cannot be used. Never echoes an invalid id: when
 * the id and the secret are swapped by mistake, the "id" is the secret.
 */
export function assertValidPepper(pepper: Pepper): void {
  if (!isValidPepperId(pepper.id)) {
    throw new PepperConfigError('a Pepper id is invalid: use 1-8 characters of letters, digits, "-" or "_"');
  }
  if (!(pepper.key instanceof Uint8Array)) {
    throw new PepperConfigError(`Pepper "${pepper.id}" key must be a Buffer`);
  }
  if (pepper.key.length < MIN_PEPPER_BYTES) {
    throw new PepperConfigError(
      `Pepper "${pepper.id}" is ${pepper.key.length} bytes; at least ${MIN_PEPPER_BYTES} bytes are required ` +
        '(generate one with: openssl rand -base64 48)',
    );
  }
  const first = pepper.key[0] ?? 0;
  const last = pepper.key[pepper.key.length - 1] ?? 0;
  if (WHITESPACE_BYTES.has(first) || WHITESPACE_BYTES.has(last)) {
    throw new PepperConfigError(
      `Pepper "${pepper.id}" starts or ends with whitespace (often a trailing newline from a secret file); remove it`,
    );
  }
}

/**
 * Reads the current Pepper from TECTON_AUTH_PEPPER (UTF-8 bytes) and TECTON_AUTH_PEPPER_ID
 * (default "1", also when empty). Minimal validation of its own until the ConfigProvider
 * (Story 3.1) takes over this reading; it is the only place in this package that reads the
 * environment.
 */
export function pepperFromEnv(env: NodeJS.ProcessEnv = process.env): Pepper {
  const value = env['TECTON_AUTH_PEPPER'];
  if (value === undefined || value === '') {
    throw new PepperConfigError(
      `TECTON_AUTH_PEPPER is not set; it must hold a secret of at least ${MIN_PEPPER_BYTES} bytes ` +
        '(generate one with: openssl rand -base64 48)',
    );
  }
  const pepper: Pepper = { id: env['TECTON_AUTH_PEPPER_ID'] || '1', key: Buffer.from(value, 'utf8') };
  assertValidPepper(pepper);
  return pepper;
}
