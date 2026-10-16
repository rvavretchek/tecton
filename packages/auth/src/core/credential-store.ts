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
  /** `login` must already be normalized. */
  findByLogin(login: string): Promise<Credential | undefined>;
  /** Throws LoginTakenError when the login is already used. */
  create(credential: Credential): Promise<void>;
  close(): Promise<void>;
}
