import { InvalidCredentialError } from '../../core/credential.js';
import {
  assertValidServiceCredential,
  ServiceAlreadyRegisteredError,
  type ServiceCredential,
  type ServiceCredentialStatus,
  type ServiceCredentialStore,
} from '../../core/service-credential.js';
import { createAuthPrismaClient, errorCode, type AuthPrismaClient } from './client.js';

export type PrismaServiceCredentialStoreOptions = { databaseUrl: string } | { client: AuthPrismaClient };

interface ServiceCredentialRow {
  id: string;
  domain: string;
  secretHash: string;
  permissions: unknown;
  callees: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** The operations this adapter uses; both generated clients satisfy them. */
interface ServiceCredentialDelegate {
  findUnique(args: { where: { domain: string } }): Promise<ServiceCredentialRow | null>;
  create(args: { data: ServiceCredentialRow }): Promise<unknown>;
  updateMany(args: {
    where: { domain: string; secretHash?: string };
    data: Partial<Pick<ServiceCredentialRow, 'secretHash' | 'permissions' | 'callees' | 'status' | 'updatedAt'>>;
  }): Promise<{ count: number }>;
}

/** Some MySQL/MariaDB setups return JSON columns as text. */
function jsonList(value: unknown, what: string, id: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new InvalidCredentialError(`service credential ${id} has unreadable ${what}`);
  }
}

/** Validates a row read back from the database (fail closed on a corrupt or hand-edited row). */
function toServiceCredential(row: ServiceCredentialRow): ServiceCredential {
  const credential: ServiceCredential = {
    id: row.id,
    domain: row.domain,
    secretHash: row.secretHash,
    permissions: jsonList(row.permissions, 'permissions', row.id) as string[],
    callees: jsonList(row.callees, 'callees', row.id) as string[],
    status: row.status as ServiceCredentialStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  assertValidServiceCredential(credential);
  return credential;
}

/**
 * A unique violation on create. The id is a fresh UUID v7, so the only unique key that can collide
 * is the domain, whatever each driver adapter puts in the error metadata.
 */
const isDomainTaken = (error: unknown) => errorCode(error) === 'P2002';

/** ServiceCredentialStore backed by the Auth database through Prisma 7 (Story 2.7a). */
export function createPrismaServiceCredentialStore(options: PrismaServiceCredentialStoreOptions): ServiceCredentialStore {
  const client = 'client' in options ? options.client : createAuthPrismaClient(options.databaseUrl);
  const services = client.delegates.serviceCredential as ServiceCredentialDelegate;
  return {
    async findByDomain(domain) {
      const row = await services.findUnique({ where: { domain } });
      return row ? toServiceCredential(row) : undefined;
    },
    async register(credential) {
      assertValidServiceCredential(credential);
      try {
        await services.create({ data: { ...credential, permissions: [...credential.permissions], callees: [...credential.callees] } });
      } catch (error) {
        if (isDomainTaken(error)) throw new ServiceAlreadyRegisteredError(credential.domain);
        throw error;
      }
    },
    async replace(credential) {
      assertValidServiceCredential(credential);
      // One statement: the old secret stops working at the same instant the new one starts.
      const { count } = await services.updateMany({
        where: { domain: credential.domain },
        data: {
          secretHash: credential.secretHash,
          permissions: [...credential.permissions],
          callees: [...credential.callees],
          status: credential.status,
          updatedAt: credential.updatedAt,
        },
      });
      return count === 1;
    },
    async updateSecretHash(domain, newHash, expectedHash) {
      // Conditional: a rotation in between wins, and updatedAt (the secret's date) is kept.
      const { count } = await services.updateMany({ where: { domain, secretHash: expectedHash }, data: { secretHash: newHash } });
      return count === 1;
    },
    close: () => client.close(),
  };
}
