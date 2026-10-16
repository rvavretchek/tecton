// Public API of @tecton/auth, part 1 (Story 2.2a): credentials, persistence and bootstrap.
export {
  assertValidCredential,
  assertValidPermissions,
  InvalidCredentialError,
  InvalidLoginError,
  MAX_LOGIN_LENGTH,
  normalizeLogin,
  type Credential,
  type CredentialStatus,
} from './core/credential.js';
export { LoginTakenError, type CredentialStore } from './core/credential-store.js';
export {
  AlreadyBootstrappedError,
  BOOTSTRAP_ADMIN_PERMISSIONS,
  bootstrapAdmin,
  MIN_ADMIN_PASSWORD_LENGTH,
  PasswordPolicyError,
  type BootstrapOptions,
} from './core/bootstrap.js';
export { dialectOf, UnsupportedDatabaseUrlError, type Dialect } from './adapters/prisma/dialect.js';
export { applyAuthMigrations, type ApplyAuthMigrationsOptions } from './adapters/prisma/migrations.js';
export { createPrismaCredentialStore, type PrismaCredentialStoreOptions } from './adapters/prisma/prisma-credential-store.js';
