import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as MysqlClient } from '../../generated/mysql/client.js';
import { PrismaClient as PostgresqlClient } from '../../generated/postgresql/client.js';
import { dialectOf, withScheme } from './dialect.js';

/**
 * The generated Prisma client of the Auth database, for either dialect. The stores type the
 * delegates they use themselves (both generated clients satisfy them); `close` disconnects once,
 * however many stores share the client.
 */
export interface AuthPrismaClient {
  readonly delegates: Record<'credential' | 'refreshFamily' | 'refreshToken', unknown>;
  transaction<T>(run: (tx: Record<'credential' | 'refreshFamily' | 'refreshToken', unknown>) => Promise<T>, options?: { isolationLevel: 'Serializable' }): Promise<T>;
  close(): Promise<void>;
}

interface GeneratedClient {
  credential: unknown;
  refreshFamily: unknown;
  refreshToken: unknown;
  $transaction<T>(run: (tx: GeneratedClient) => Promise<T>, options?: { isolationLevel: 'Serializable' }): Promise<T>;
  $disconnect(): Promise<void>;
}

/** The PostgreSQL schema named in the URL (?schema=...); PrismaPg does not read it from the URL. */
function postgresqlSchema(databaseUrl: string): string | undefined {
  return new URL(databaseUrl.trim()).searchParams.get('schema') ?? undefined;
}

/** One Prisma client for the Auth database, picking the dialect from the URL (Story 2.2a). */
export function createAuthPrismaClient(databaseUrl: string): AuthPrismaClient {
  let client: GeneratedClient;
  if (dialectOf(databaseUrl) === 'postgresql') {
    const schema = postgresqlSchema(databaseUrl);
    const adapter = new PrismaPg({ connectionString: databaseUrl.trim() }, schema ? { schema } : undefined);
    client = new PostgresqlClient({ adapter }) as unknown as GeneratedClient;
  } else {
    client = new MysqlClient({ adapter: new PrismaMariaDb(withScheme(databaseUrl, 'mariadb:')) }) as unknown as GeneratedClient;
  }
  let closing: Promise<void> | undefined;
  return {
    delegates: client,
    transaction: (run, options) => client.$transaction((tx) => run(tx), options),
    close: () => (closing ??= client.$disconnect()),
  };
}

export function errorCode(error: unknown): string | undefined {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : undefined;
}

/**
 * A serialization failure or deadlock: Prisma reports P2034, or the driver adapter error itself
 * surfaces with kind TransactionWriteConflict (PostgreSQL SQLSTATE 40001 / 40P01; MySQL and
 * MariaDB deadlock 1213).
 */
export function isWriteConflict(error: unknown): boolean {
  if (errorCode(error) === 'P2034') return true;
  for (let current: unknown = error, depth = 0; current && typeof current === 'object' && depth < 4; depth += 1) {
    const { kind, originalCode, cause } = current as { kind?: unknown; originalCode?: unknown; cause?: unknown };
    if (kind === 'TransactionWriteConflict' || originalCode === '40001' || originalCode === '40P01' || originalCode === '1213') return true;
    current = cause;
  }
  return false;
}
