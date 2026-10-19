import type { Credential } from './credential.js';

/** The login is already used by another credential. */
export class LoginTakenError extends Error {
  override readonly name = 'LoginTakenError';
  constructor() {
    super('a credential with this login already exists');
  }
}

/** Port for the Auth database (AD-1): the core never imports Prisma. */
export interface CredentialStore {
  count(): Promise<number>;
  /** `login` must already be normalized. Throws InvalidCredentialError on a corrupt row. */
  findByLogin(login: string): Promise<Credential | undefined>;
  /** Throws LoginTakenError when the login is already used. */
  create(credential: Credential): Promise<void>;
  /**
   * Inserts `credential` only if there is no credential at all, atomically (serializable
   * transaction): two concurrent calls never both succeed. Returns false when credentials exist.
   */
  createIfEmpty(credential: Credential): Promise<boolean>;
  /**
   * Replaces the password hash of credential `id` only if it is still `expectedHash` (re-hash
   * after a successful login must never overwrite a password changed meanwhile). Returns whether
   * the hash was replaced.
   */
  updatePasswordHash(id: string, passwordHash: string, updatedAt: Date, expectedHash: string): Promise<boolean>;
  close(): Promise<void>;
}
