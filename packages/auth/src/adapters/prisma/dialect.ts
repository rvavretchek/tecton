/** SQL dialect of the Auth schema: MariaDB and MySQL share the `mysql` one (Spine, stack table). */
export type Dialect = 'postgresql' | 'mysql';

const DIALECTS: Record<string, Dialect> = {
  'postgresql:': 'postgresql',
  'postgres:': 'postgresql',
  'mysql:': 'mysql',
  'mariadb:': 'mysql',
};

/** Unsupported database URL. The message never contains the URL, which may hold a password. */
export class UnsupportedDatabaseUrlError extends Error {
  override readonly name = 'UnsupportedDatabaseUrlError';
}

const SUPPORTED = 'use postgresql://, mysql:// or mariadb://';

/** Parsed scheme (lower case, with the colon) of a URL that may carry surrounding whitespace. */
function protocolOf(databaseUrl: string): string {
  try {
    return new URL(databaseUrl.trim()).protocol;
  } catch {
    throw new UnsupportedDatabaseUrlError(`TECTON_AUTH_DATABASE_URL is not a valid URL; ${SUPPORTED}`);
  }
}

export function dialectOf(databaseUrl: string): Dialect {
  const protocol = protocolOf(databaseUrl);
  const dialect = DIALECTS[protocol];
  if (!dialect) {
    // Never echo the "scheme": a secret pasted by mistake as "token:..." would parse as one.
    throw new UnsupportedDatabaseUrlError(`unsupported database URL scheme; ${SUPPORTED}`);
  }
  return dialect;
}

/**
 * The same URL with `scheme` (e.g. "mariadb:") as its scheme, whatever case and surrounding
 * whitespace the original had. The MariaDB driver only accepts mariadb:// and the Prisma
 * migration engine only accepts mysql:// for the same database.
 */
export function withScheme(databaseUrl: string, scheme: 'mysql:' | 'mariadb:'): string {
  const trimmed = databaseUrl.trim();
  protocolOf(trimmed);
  return `${scheme}${trimmed.slice(trimmed.indexOf(':') + 1)}`;
}
