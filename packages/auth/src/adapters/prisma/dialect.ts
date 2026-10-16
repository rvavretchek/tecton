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

export function dialectOf(databaseUrl: string): Dialect {
  let protocol: string;
  try {
    protocol = new URL(databaseUrl).protocol;
  } catch {
    throw new UnsupportedDatabaseUrlError('TECTON_AUTH_DATABASE_URL is not a valid URL');
  }
  const dialect = DIALECTS[protocol];
  if (!dialect) {
    throw new UnsupportedDatabaseUrlError(
      `unsupported database URL scheme "${protocol}"; use postgresql://, mysql:// or mariadb://`,
    );
  }
  return dialect;
}
