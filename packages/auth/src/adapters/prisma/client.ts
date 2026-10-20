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

// PostgreSQL SQLSTATE 40001 (serialization) and 40P01 (deadlock); MySQL/MariaDB 1213 (deadlock) and
// 1020 (MariaDB 11.8+ innodb_snapshot_isolation: "Record has changed since last read").
const CONFLICT_CODES = new Set(['40001', '40P01', '1213', '1020']);
const PRISMA_REQUEST_ERRORS = new Set(['PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError']);

/**
 * A serialization failure, deadlock or snapshot conflict: Prisma reports P2034, or the driver
 * adapter error surfaces, nested in `cause`, `meta` or `driverAdapterError`, with kind
 * TransactionWriteConflict or one of CONFLICT_CODES.
 */
export function isWriteConflict(error: unknown): boolean {
  if (errorCode(error) === 'P2034') return true;
  const pending: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
  while (pending.length > 0) {
    const { value, depth } = pending.pop() as { value: unknown; depth: number };
    if (!value || typeof value !== 'object' || depth > 5) continue;
    const { kind, originalCode, code, cause, meta, driverAdapterError } = value as Record<string, unknown>;
    if (kind === 'TransactionWriteConflict') return true;
    for (const candidate of [originalCode, kind === 'mysql' || kind === 'postgres' ? code : undefined]) {
      if ((typeof candidate === 'string' || typeof candidate === 'number') && CONFLICT_CODES.has(String(candidate))) return true;
    }
    for (const next of [cause, meta, driverAdapterError]) pending.push({ value: next, depth: depth + 1 });
  }
  // Last resort: a Prisma request error whose message carries the database code ("Code: `1020`").
  if (error instanceof Error && PRISMA_REQUEST_ERRORS.has(error.name)) {
    const match = /Code: `([0-9A-Z]+)`/.exec(error.message);
    if (match?.[1] && CONFLICT_CODES.has(match[1])) return true;
  }
  return false;
}
