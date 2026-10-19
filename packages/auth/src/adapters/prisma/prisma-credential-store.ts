import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertValidCredential, InvalidCredentialError, type Credential, type CredentialStatus } from '../../core/credential.js';
import { LoginTakenError, type CredentialStore } from '../../core/credential-store.js';
import { PrismaClient as MysqlClient } from '../../generated/mysql/client.js';
import { PrismaClient as PostgresqlClient } from '../../generated/postgresql/client.js';
import { dialectOf, withScheme } from './dialect.js';

export interface PrismaCredentialStoreOptions {
  /** TECTON_AUTH_DATABASE_URL: postgresql://, mysql:// or mariadb:// (MariaDB and MySQL share a dialect). */
  databaseUrl: string;
}

interface CredentialRow {
  id: string;
  login: string;
  passwordHash: string;
  status: string;
  permissions: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/** The operations this adapter uses; both generated clients satisfy it. */
interface CredentialDelegate {
  count(): Promise<number>;
  findUnique(args: { where: { login: string } }): Promise<CredentialRow | null>;
  create(args: { data: CredentialRow }): Promise<unknown>;
  update(args: { where: { id: string }; data: { passwordHash: string; updatedAt: Date } }): Promise<unknown>;
}

interface TransactionClient {
  credential: CredentialDelegate;
}

interface Client {
  credential: unknown;
  $transaction<T>(run: (tx: TransactionClient) => Promise<T>, options: { isolationLevel: 'Serializable' }): Promise<T>;
  $disconnect(): Promise<void>;
}

/** Validates a row read back from the database (fail closed on a corrupt or hand-edited row). */
function toCredential(row: CredentialRow): Credential {
  // Some MySQL/MariaDB setups return JSON columns as text.
  let permissions = row.permissions;
  if (typeof permissions === 'string') {
    try {
      permissions = JSON.parse(permissions) as unknown;
    } catch {
      throw new InvalidCredentialError(`credential ${row.id} has unreadable permissions`);
    }
  }
  const credential: Credential = {
    id: row.id,
    login: row.login,
    passwordHash: row.passwordHash,
    status: row.status as CredentialStatus,
    permissions: permissions as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  assertValidCredential(credential);
  return credential;
}

function errorCode(error: unknown): string | undefined {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : undefined;
}

/**
 * A serialization failure or deadlock: Prisma reports P2034, or the driver adapter error itself
 * surfaces with kind TransactionWriteConflict (PostgreSQL SQLSTATE 40001 / 40P01).
 */
function isWriteConflict(error: unknown): boolean {
  if (errorCode(error) === 'P2034') return true;
  for (let current: unknown = error, depth = 0; current && typeof current === 'object' && depth < 4; depth += 1) {
    const { kind, originalCode, cause } = current as { kind?: unknown; originalCode?: unknown; cause?: unknown };
    if (kind === 'TransactionWriteConflict' || originalCode === '40001' || originalCode === '40P01') return true;
    current = cause;
  }
  return false;
}

/** A unique violation on the login column (and not, say, a repeated id). */
function isLoginTaken(error: unknown): boolean {
  if (errorCode(error) !== 'P2002') return false;
  const meta = JSON.stringify((error as { meta?: unknown }).meta ?? {});
  return /login/.test(meta);
}

/** The PostgreSQL schema named in the URL (?schema=...); PrismaPg does not read it from the URL. */
function postgresqlSchema(databaseUrl: string): string | undefined {
  return new URL(databaseUrl.trim()).searchParams.get('schema') ?? undefined;
}

/** CredentialStore backed by the Auth database through Prisma 7, picking the dialect from the URL. */
export function createPrismaCredentialStore({ databaseUrl }: PrismaCredentialStoreOptions): CredentialStore {
  let client: Client;
  if (dialectOf(databaseUrl) === 'postgresql') {
    const schema = postgresqlSchema(databaseUrl);
    const adapter = new PrismaPg({ connectionString: databaseUrl.trim() }, schema ? { schema } : undefined);
    client = new PostgresqlClient({ adapter }) as unknown as Client;
  } else {
    client = new MysqlClient({ adapter: new PrismaMariaDb(withScheme(databaseUrl, 'mariadb:')) }) as unknown as Client;
  }
  const credentials = client.credential as CredentialDelegate;
  const insert = async (delegate: CredentialDelegate, credential: Credential) => {
    assertValidCredential(credential);
    try {
      await delegate.create({ data: { ...credential, permissions: [...credential.permissions] } });
    } catch (error) {
      if (isLoginTaken(error)) throw new LoginTakenError();
      throw error;
    }
  };

  return {
    count: () => credentials.count(),
    async findByLogin(login) {
      const row = await credentials.findUnique({ where: { login } });
      return row ? toCredential(row) : undefined;
    },
    create: (credential) => insert(credentials, credential),
    async createIfEmpty(credential) {
      try {
        return await client.$transaction(
          async (tx) => {
            if ((await tx.credential.count()) > 0) return false;
            await insert(tx.credential, credential);
            return true;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        // Write conflict or deadlock: a concurrent bootstrap committed first. With a unique login,
        // a concurrent insert of the same login lands here too.
        if (isWriteConflict(error) || error instanceof LoginTakenError) return false;
        throw error;
      }
    },
    async updatePasswordHash(id, passwordHash, updatedAt) {
      await credentials.update({ where: { id }, data: { passwordHash, updatedAt } });
    },
    close: () => client.$disconnect(),
  };
}
