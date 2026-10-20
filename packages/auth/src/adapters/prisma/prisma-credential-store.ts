import { assertValidCredential, InvalidCredentialError, type Credential, type CredentialStatus } from '../../core/credential.js';
import { LoginTakenError, type CredentialStore } from '../../core/credential-store.js';
import { createAuthPrismaClient, errorCode, isWriteConflict, type AuthPrismaClient } from './client.js';

export type PrismaCredentialStoreOptions =
  /** TECTON_AUTH_DATABASE_URL: postgresql://, mysql:// or mariadb:// (MariaDB and MySQL share a dialect). */
  | { databaseUrl: string }
  /** A client shared with other stores (Story 2.3); closing the store closes it. */
  | { client: AuthPrismaClient };

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
  findUnique(args: { where: { login: string } | { id: string } }): Promise<CredentialRow | null>;
  create(args: { data: CredentialRow }): Promise<unknown>;
  updateMany(args: { where: { id: string; passwordHash: string }; data: { passwordHash: string; updatedAt: Date } }): Promise<{ count: number }>;
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

/** A unique violation on the login column (and not, say, a repeated id). */
function isLoginTaken(error: unknown): boolean {
  if (errorCode(error) !== 'P2002') return false;
  const meta = JSON.stringify((error as { meta?: unknown }).meta ?? {});
  return /login/.test(meta);
}

/** CredentialStore backed by the Auth database through Prisma 7, picking the dialect from the URL. */
export function createPrismaCredentialStore(options: PrismaCredentialStoreOptions): CredentialStore {
  const client = 'client' in options ? options.client : createAuthPrismaClient(options.databaseUrl);
  const credentials = client.delegates.credential as CredentialDelegate;
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
    async findById(id) {
      const row = await credentials.findUnique({ where: { id } });
      return row ? toCredential(row) : undefined;
    },
    create: (credential) => insert(credentials, credential),
    async createIfEmpty(credential) {
      try {
        return await client.transaction(
          async (tx) => {
            const delegate = tx.credential as CredentialDelegate;
            if ((await delegate.count()) > 0) return false;
            await insert(delegate, credential);
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
    async updatePasswordHash(id, passwordHash, updatedAt, expectedHash) {
      // Conditional: a password changed since the login was verified is never overwritten.
      const { count } = await credentials.updateMany({ where: { id, passwordHash: expectedHash }, data: { passwordHash, updatedAt } });
      return count === 1;
    },
    close: () => client.close(),
  };
}
