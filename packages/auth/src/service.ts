import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTectonServer, frameworkErrors, loadDomainManifest, registerActionRoutes, type TectonServerOptions } from '@tecton/core';
import {
  closeValkeyClient,
  createArgon2idAuthProvider,
  createValkeyLoginLockout,
  createValkeyTokenRevocationStore,
  lockoutPolicyFromEnv,
  LoginLockoutUnavailableError,
  pepperFromEnv,
  RevocationStoreUnavailableError,
  systemClock,
  valkeyClientFromEnv,
  type AuthProvider,
  type Clock,
  type LoginLockout,
  type TokenRevocationStore,
  type ValkeyClient,
} from '@tecton/providers';
import type { AccessTokenIssuer } from './core/access-token.js';
import type { CredentialStore } from './core/credential-store.js';
import { InvalidCredentialsError, login, LoginLockedError } from './core/login.js';
import type { RefreshTokenStore } from './core/refresh-token-store.js';
import {
  assertRefreshTokenTtl,
  endSession,
  InvalidRefreshTokenError,
  REFRESH_TOKEN_TTL,
  refreshSession,
  type IssuedRefreshToken,
  type SessionDependencies,
} from './core/session.js';
import {
  AuthConfigError,
  listenSettingsFromEnv,
  previousPeppersFromEnv,
  refreshTokenTtlFromEnv,
  signingKeysFromEnv,
  tokenSettingsFromEnv,
} from './adapters/env/config-from-env.js';
import { clearRefreshCookie, readRefreshCookie, readRefreshCookies, serializeRefreshCookie } from './adapters/http/refresh-cookie.js';
import { createAccessTokenIssuer } from './adapters/jose/access-token-issuer.js';
import { createOwnAccessTokenReader } from './adapters/jose/own-access-token.js';
import type { SigningKeys } from './adapters/jose/signing-keys.js';
import { createAuthPrismaClient } from './adapters/prisma/client.js';
import { createPrismaCredentialStore } from './adapters/prisma/prisma-credential-store.js';
import { createPrismaRefreshTokenStore } from './adapters/prisma/prisma-refresh-token-store.js';

/** The Fastify instance the Auth service runs on (same type @tecton/core creates). */
export type AuthServiceApp = ReturnType<typeof createTectonServer>;

/** The Auth manifest ships at the package root (src/ in tests, dist/ when published: both one level below). */
export const AUTH_MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'tecton.yaml');
export const JWKS_PATH = '/auth/.well-known/jwks.json';
export const LOGIN_PATH = '/auth/login';
export const REFRESH_PATH = '/auth/refresh';
export const LOGOUT_PATH = '/auth/logout';

/** Responses carrying or revoking tokens, never to be cached. */
const NO_STORE_PATHS = new Set([LOGIN_PATH, REFRESH_PATH, LOGOUT_PATH]);

/** Name and code of an error, never its message, which may carry query or connection details. */
function safeError(error: unknown): { name: string; code?: string } {
  const name = error instanceof Error ? error.name : 'Error';
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? { name, code } : { name };
}

/** Never logged: credentials and tokens travel in these headers. */
export const LOG_REDACTION = ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'];

export interface AuthServiceOptions {
  store: CredentialStore;
  refreshTokens: RefreshTokenStore;
  auth: AuthProvider;
  issuer: AccessTokenIssuer;
  keys: SigningKeys;
  /**
   * Token revocation (Story 2.5): logout revokes the access token in use, and a refresh token reuse
   * revokes every access token of the subject issued until then.
   */
  revocations: TokenRevocationStore;
  /** Lockout by identifier after too many failed logins (Story 2.6). */
  lockout: LoginLockout;
  clock?: Clock;
  /** Fixed lifetime of a refresh token family, in seconds (default 7 days). */
  refreshTtlSeconds?: number;
  logger?: TectonServerOptions['logger'];
}

/** Seconds the refresh cookie may live: until its family expires, never longer. */
function cookieMaxAge(refresh: IssuedRefreshToken, clock: Clock): number {
  return (refresh.expiresAt.getTime() - clock.now().getTime()) / 1000;
}

/**
 * Builds the Auth service (not listening yet): the manifest actions, with `login`, `refresh` and
 * `logout` implemented and `serviceToken` answering 501 until Story 2.7, plus
 * GET /auth/.well-known/jwks.json. Closing the app closes both stores.
 */
export async function createAuthService({
  store,
  refreshTokens,
  auth,
  issuer,
  keys,
  revocations,
  lockout,
  clock = systemClock,
  refreshTtlSeconds = REFRESH_TOKEN_TTL.default,
  logger,
}: AuthServiceOptions): Promise<AuthServiceApp> {
  assertRefreshTokenTtl(refreshTtlSeconds);
  // Verified when the login does not exist: same Argon2id cost as a real account (P0-006).
  const dummyHash = await auth.hashPassword(randomBytes(32).toString('base64'));
  const app = createTectonServer(logger === undefined ? {} : { logger });
  const corruptCredential = (at: string) => (error: unknown) => app.log.warn({ err: safeError(error) }, `corrupt credential refused at ${at}`);
  const sessions: SessionDependencies = {
    refreshTokens,
    credentials: store,
    issuer,
    clock,
    refreshTtlSeconds,
    onCorruptCredential: corruptCredential('refresh'),
    // Security event (AC 4 of 2.3): the family and the subject, never the token or its hash. The
    // access tokens of the subject issued until now are revoked too (Story 2.5, AC 6).
    onReuseDetected: async ({ familyId, subject }) => {
      app.log.warn({ event: 'auth.refresh_token.reuse', familyId, subject }, 'refresh token reuse detected; family revoked');
      // Awaited: the 401 never goes out before the access tokens of the subject are revoked.
      try {
        await revocations.revokeSubject({ subject, at: clock.now() });
      } catch (error) {
        app.log.error(
          { event: 'auth.refresh_token.reuse.revocation_failed', familyId, subject, err: safeError(error) },
          'access tokens of the subject could not be revoked',
        );
      }
    },
  };
  // Same iss and aud as the tokens this service signs: one source, so logout recognizes them.
  const ownAccessToken = createOwnAccessTokenReader({ keys, clock, issuer: issuer.issuer, audience: issuer.audience });

  registerActionRoutes(app, loadDomainManifest(AUTH_MANIFEST_PATH), {
    login: async (input, { reply }) => {
      try {
        const { access, refresh } = await login(
          {
            store,
            auth,
            issuer,
            clock,
            dummyHash,
            refreshTokens,
            refreshTtlSeconds,
            lockout,
            // Security event (AC 6): the identifier and the duration, never a password.
            onLocked: ({ identifier, lockSeconds }) =>
              app.log.warn({ event: 'auth.login.locked', identifier, lockSeconds }, 'login locked after too many failures'),
            onRehashFailure: (error) => app.log.warn({ err: safeError(error) }, 'password re-hash after login failed'),
            onCorruptCredential: corruptCredential('login'),
          },
          { login: input['login'] as string, password: input['password'] as string },
        );
        reply.header('set-cookie', serializeRefreshCookie(refresh.refreshToken, cookieMaxAge(refresh, clock)));
        return access;
      } catch (error) {
        if (error instanceof InvalidCredentialsError) throw frameworkErrors.unauthorized();
        if (error instanceof LoginLockedError) throw frameworkErrors.tooManyRequests(error.retryAfterSeconds);
        // Valkey unreachable or slow: never "not locked" (fail closed, AC 8).
        if (error instanceof LoginLockoutUnavailableError) {
          app.log.error({ event: 'auth.login.lockout_unavailable', err: safeError(error) }, 'login refused: lockout unavailable');
          throw frameworkErrors.authUnavailable();
        }
        throw error;
      }
    },
    refresh: async (_input, { request, reply }) => {
      try {
        const { access, refresh } = await refreshSession(sessions, readRefreshCookie(request.headers.cookie));
        reply.header('set-cookie', serializeRefreshCookie(refresh.refreshToken, cookieMaxAge(refresh, clock)));
        return access;
      } catch (error) {
        if (!(error instanceof InvalidRefreshTokenError)) throw error;
        // Every refusal also drops the cookie: it can never work again.
        reply.header('set-cookie', clearRefreshCookie());
        throw frameworkErrors.unauthorized();
      }
    },
    logout: async (_input, { request, reply }) => {
      // Cleared first: even when the revocation fails (a 500), the browser drops the cookie.
      reply.header('set-cookie', clearRefreshCookie());
      // The access token in use, when it is a valid one of this service (Story 2.5, AC 5), is
      // revoked even if revoking the family fails.
      const revokeAccessToken = async () => {
        const authorization = request.headers.authorization;
        const accessToken = await ownAccessToken(authorization);
        if (!accessToken) {
          if (authorization !== undefined) {
            app.log.info({ event: 'auth.logout.bearer_not_recognized' }, 'logout with a Bearer this service did not issue, or an expired one');
          }
          return;
        }
        try {
          await revocations.revokeToken({ tokenId: accessToken.tokenId, expiresAt: accessToken.expiresAt });
        } catch (error) {
          if (!(error instanceof RevocationStoreUnavailableError)) throw error;
          app.log.error({ event: 'auth.logout.revocation_failed', err: safeError(error) }, 'access token could not be revoked at logout');
          throw frameworkErrors.authUnavailable();
        }
      };
      try {
        await endSession(sessions, readRefreshCookies(request.headers.cookie));
      } finally {
        await revokeAccessToken();
      }
      return {};
    },
  });
  // Responses carrying tokens must never be cached (RFC 6749 5.1), success and failure alike.
  app.addHook('onSend', async (request, reply) => {
    if (NO_STORE_PATHS.has(request.routeOptions.url ?? '')) reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
  });
  const jwks = { keys: keys.publicJwks.map((jwk) => ({ ...jwk })) };
  app.get(JWKS_PATH, async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return jwks;
  });
  app.addHook('onClose', async () => {
    await Promise.all([store.close(), refreshTokens.close(), revocations.close(), lockout.close()]);
  });
  return app;
}

/**
 * Starts the Auth service from the environment, validating every setting before listening:
 * TECTON_AUTH_DATABASE_URL, TECTON_AUTH_PEPPER(_ID), TECTON_AUTH_PREVIOUS_PEPPERS,
 * TECTON_AUTH_SIGNING_KEY, TECTON_AUTH_PREVIOUS_PUBLIC_KEYS, TECTON_AUTH_NEXT_PUBLIC_KEYS,
 * TECTON_AUTH_ISSUER, TECTON_AUTH_AUDIENCE, TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS,
 * TECTON_AUTH_REFRESH_TOKEN_TTL_SECONDS, TECTON_VALKEY_URL (token revocation and login lockout,
 * required), TECTON_REVOCATION_TIMEOUT_MS, TECTON_AUTH_LOCKOUT_MAX_FAILURES,
 * TECTON_AUTH_LOCKOUT_WINDOW_SECONDS, TECTON_AUTH_LOCKOUT_DURATION_SECONDS, PORT and HOST.
 * If anything fails after the database client is created, it is closed before the error propagates.
 */
export async function startAuthServiceFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<AuthServiceApp> {
  const databaseUrl = env['TECTON_AUTH_DATABASE_URL']?.trim();
  if (!databaseUrl) throw new AuthConfigError('TECTON_AUTH_DATABASE_URL is not set; point it to the Auth database');
  const pepper = pepperFromEnv(env);
  const previousPeppers = previousPeppersFromEnv(env);
  const keys = await signingKeysFromEnv(env);
  const tokens = tokenSettingsFromEnv(env);
  const refreshTtlSeconds = refreshTokenTtlFromEnv(env);
  const lockoutPolicy = lockoutPolicyFromEnv(env);
  const { port, host } = listenSettingsFromEnv(env);
  const auth = createArgon2idAuthProvider({ peppers: [pepper, ...previousPeppers], currentPepperId: pepper.id });
  const issuer = createAccessTokenIssuer({ keys, clock: systemClock, ...tokens });
  // One database client for both stores; it disconnects once, when the app closes.
  const client = createAuthPrismaClient(databaseUrl);
  const store = createPrismaCredentialStore({ client });
  const refreshTokens = createPrismaRefreshTokenStore({ client });
  let app: AuthServiceApp | undefined;
  let valkey: ValkeyClient | undefined;
  try {
    // One Valkey connection for revocation and lockout, opened in the background inside the try:
    // a failure closes it. Subject revocations last as long as the longest access token issued.
    valkey = valkeyClientFromEnv(env, { onError: (error) => app?.log.warn({ reason: error.message }, 'Valkey connection error') });
    const revocations = createValkeyTokenRevocationStore({ client: valkey, shared: true, maxTokenLifetimeSeconds: tokens.ttlSeconds });
    const lockout = createValkeyLoginLockout({ client: valkey, shared: true, ...lockoutPolicy });
    app = await createAuthService({
      store,
      refreshTokens,
      auth,
      issuer,
      keys,
      revocations,
      lockout,
      refreshTtlSeconds,
      logger: { level: 'info', redact: LOG_REDACTION },
    });
    const shared = valkey;
    app.addHook('onClose', async () => closeValkeyClient(shared));
    await app.listen({ port, host });
    return app;
  } catch (error) {
    // Closing the app closes the client and the store; without an app, close them directly.
    await (app ? app.close() : client.close()).catch(() => undefined);
    if (valkey) await closeValkeyClient(valkey);
    throw error;
  }
}
