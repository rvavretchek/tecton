import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Credential, CredentialStatus } from '../../core/credential.js';
import { LoginTakenError, type CredentialStore } from '../../core/credential-store.js';
import { PrismaClient as MysqlClient } from '../../generated/mysql/client.js';
import { PrismaClient as PostgresqlClient } from '../../generated/postgresql/client.js';
import { dialectOf } from './dialect.js';

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
}

function toCredential(row: CredentialRow): Credential {
  return {
    id: row.id,
    login: row.login,
    passwordHash: row.passwordHash,
    status: row.status as CredentialStatus,
    permissions: Array.isArray(row.permissions) ? (row.permissions as string[]) : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/** The MariaDB driver behind @prisma/adapter-mariadb only understands the mariadb:// scheme. */
function mariadbUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return url.protocol === 'mysql:' ? `mariadb:${databaseUrl.slice('mysql:'.length)}` : databaseUrl;
}

/** CredentialStore backed by the Auth database through Prisma 7, picking the dialect from the URL. */
export function createPrismaCredentialStore({ databaseUrl }: PrismaCredentialStoreOptions): CredentialStore {
  const client =
    dialectOf(databaseUrl) === 'postgresql'
      ? new PostgresqlClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
      : new MysqlClient({ adapter: new PrismaMariaDb(mariadbUrl(databaseUrl)) });
  const credentials = client.credential as unknown as CredentialDelegate;

  return {
    count: () => credentials.count(),
    async findByLogin(login) {
      const row = await credentials.findUnique({ where: { login } });
      return row ? toCredential(row) : undefined;
    },
    async create(credential) {
      try {
        await credentials.create({ data: { ...credential, permissions: [...credential.permissions] } });
      } catch (error) {
        if (isUniqueViolation(error)) throw new LoginTakenError();
        throw error;
      }
    },
    close: () => client.$disconnect(),
  };
}
