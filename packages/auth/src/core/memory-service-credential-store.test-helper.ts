import { assertValidServiceCredential, ServiceAlreadyRegisteredError, type ServiceCredential, type ServiceCredentialStore } from './service-credential.js';

/**
 * In-memory ServiceCredentialStore for tests (not built into the package). Same contract as the
 * Prisma adapter: unique domain, atomic replace, validated rows and fresh copies on read.
 */
export function createMemoryServiceCredentialStore() {
  const rows = new Map<string, ServiceCredential>();
  const copy = (credential: ServiceCredential): ServiceCredential => ({
    ...credential,
    permissions: [...credential.permissions],
    callees: [...credential.callees],
  });
  const store: ServiceCredentialStore = {
    async findByDomain(domain) {
      const row = rows.get(domain);
      if (!row) return undefined;
      assertValidServiceCredential(row);
      return copy(row);
    },
    async register(credential) {
      assertValidServiceCredential(credential);
      if (rows.has(credential.domain)) throw new ServiceAlreadyRegisteredError(credential.domain);
      rows.set(credential.domain, copy(credential));
    },
    async replace(credential) {
      assertValidServiceCredential(credential);
      const current = rows.get(credential.domain);
      if (!current) return false;
      rows.set(credential.domain, { ...copy(credential), id: current.id, createdAt: current.createdAt });
      return true;
    },
    async updateSecretHash(domain, newHash, expectedHash) {
      const current = rows.get(domain);
      if (!current || current.secretHash !== expectedHash) return false;
      rows.set(domain, { ...current, secretHash: newHash });
      return true;
    },
    async close() {},
  };
  /** Writes a row as is, bypassing validation (a row edited by hand). */
  const putRaw = (credential: ServiceCredential) => void rows.set(credential.domain, credential);
  return { store, rows, putRaw };
}
