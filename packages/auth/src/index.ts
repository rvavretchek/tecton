// Public API of @tecton/auth: credentials, persistence and bootstrap (Story 2.2a); login,
// access tokens, JWKS and the runnable service (Story 2.2b).
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
export type { AccessTokenIssuer, IssuedAccessToken } from './core/access-token.js';
export { InvalidCredentialsError, login, type LoginDependencies, type LoginRequest } from './core/login.js';
export { buildSigningKeys, SigningKeyConfigError, type PublishedJwk, type SigningKeyMaterial, type SigningKeys } from './adapters/jose/signing-keys.js';
export {
  ACCESS_TOKEN_TTL,
  createAccessTokenIssuer,
  DEFAULT_AUDIENCE,
  DEFAULT_ISSUER,
  type AccessTokenIssuerOptions,
} from './adapters/jose/access-token-issuer.js';
export {
  AuthConfigError,
  listenSettingsFromEnv,
  previousPeppersFromEnv,
  signingKeysFromEnv,
  tokenSettingsFromEnv,
  type TokenSettings,
} from './adapters/env/config-from-env.js';
export { AUTH_MANIFEST_PATH, createAuthService, JWKS_PATH, LOGIN_PATH, LOG_REDACTION, startAuthServiceFromEnv, type AuthServiceApp, type AuthServiceOptions } from './service.js';
