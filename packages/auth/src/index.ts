// Public API of @tecton/auth: credentials, persistence and bootstrap (Story 2.2a); login,
// access tokens, JWKS and the runnable service (Story 2.2b); refresh tokens and logout (Story 2.3).
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
export { createAuthPrismaClient, type AuthPrismaClient } from './adapters/prisma/client.js';
export { createPrismaCredentialStore, type PrismaCredentialStoreOptions } from './adapters/prisma/prisma-credential-store.js';
export { createPrismaRefreshTokenStore, type PrismaRefreshTokenStoreOptions } from './adapters/prisma/prisma-refresh-token-store.js';
export type { AccessTokenIssuer, IssuedAccessToken } from './core/access-token.js';
export { InvalidCredentialsError, login, type LoginDependencies, type LoginRequest } from './core/login.js';
export { generateRefreshToken, hashRefreshToken, isWellFormedRefreshToken, REFRESH_TOKEN_BYTES } from './core/refresh-token.js';
export {
  REFRESH_REVOCATION_REASONS,
  type NewRefreshToken,
  type RefreshFamily,
  type RefreshRevocationReason,
  type RefreshRotation,
  type RefreshTokenStore,
  type RotationAuthorizer,
} from './core/refresh-token-store.js';
export {
  assertRefreshTokenTtl,
  endSession,
  InvalidRefreshTokenError,
  MAX_LOGOUT_TOKENS,
  openSession,
  REFRESH_TOKEN_TTL,
  refreshSession,
  type IssuedRefreshToken,
  type OpenSessionDependencies,
  type RefreshReuseEvent,
  type SessionDependencies,
  type SessionTokens,
} from './core/session.js';
export { clearRefreshCookie, readRefreshCookie, readRefreshCookies, REFRESH_COOKIE, REFRESH_COOKIE_PATH, serializeRefreshCookie } from './adapters/http/refresh-cookie.js';
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
  refreshTokenTtlFromEnv,
  signingKeysFromEnv,
  tokenSettingsFromEnv,
  type TokenSettings,
} from './adapters/env/config-from-env.js';
export { AUTH_MANIFEST_PATH, createAuthService, JWKS_PATH, LOGIN_PATH, LOGOUT_PATH, LOG_REDACTION, REFRESH_PATH, startAuthServiceFromEnv, type AuthServiceApp, type AuthServiceOptions } from './service.js';
