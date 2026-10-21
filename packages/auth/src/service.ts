import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTectonServer, frameworkErrors, loadDomainManifest, registerActionRoutes, type TectonServerOptions } from '@tecton/core';
import {
  createArgon2idAuthProvider,
  pepperFromEnv,
  RevocationStoreUnavailableError,
  systemClock,
  tokenRevocationStoreFromEnv,
  type AuthProvider,
  type Clock,
  type TokenRevocationStore,
} from '@tecton/providers';
import type { AccessTokenIssuer } from './core/access-token.js';
import type { CredentialStore } from './core/credential-store.js';
import { InvalidCredentialsError, login } from './core/login.js';
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
import { createAccessTokenIssuer, DEFAULT_AUDIENCE, DEFAULT_ISSUER } from './adapters/jose/access-token-issuer.js';
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
  /** `iss` and `aud` of the access tokens, to recognize this service's own tokens at logout. */
  tokenIssuer?: string;
  tokenAudience?: string;
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
  tokenIssuer = DEFAULT_ISSUER,
  tokenAudience = DEFAULT_AUDIENCE,
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
    onReuseDetected: ({ familyId, subject }) => {
      app.log.warn({ event: 'auth.refresh_token.reuse', familyId, subject }, 'refresh token reuse detected; family revoked');
      revocations.revokeSubject({ subject, at: clock.now() }).catch((error: unknown) =>
        app.log.error({ event: 'auth.refresh_token.reuse.revocation_failed', familyId, subject, err: safeError(error) }, 'access tokens of the subject could not be revoked'),
      );
    },
  };
  const ownAccessToken = createOwnAccessTokenReader({ keys, clock, issuer: tokenIssuer, audience: tokenAudience });

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
            onRehashFailure: (error) => app.log.warn({ err: safeError(error) }, 'password re-hash after login failed'),
            onCorruptCredential: corruptCredential('login'),
          },
          { login: input['login'] as string, password: input['password'] as string },
        );
        reply.header('set-cookie', serializeRefreshCookie(refresh.refreshToken, cookieMaxAge(refresh, clock)));
        return access;
      } catch (error) {
        if (error instanceof InvalidCredentialsError) throw frameworkErrors.unauthorized();
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
      await endSession(sessions, readRefreshCookies(request.headers.cookie));
      // The access token in use, when it is a valid one of this service (Story 2.5, AC 5).
      const accessToken = await ownAccessToken(request.headers.authorization);
      if (accessToken) {
        try {
          await revocations.revokeToken({ tokenId: accessToken.tokenId, expiresAt: accessToken.expiresAt });
        } catch (error) {
          if (!(error instanceof RevocationStoreUnavailableError)) throw error;
          app.log.error({ event: 'auth.logout.revocation_failed', err: safeError(error) }, 'access token could not be revoked at logout');
          throw frameworkErrors.authUnavailable();
        }
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
    await Promise.all([store.close(), refreshTokens.close(), revocations.close()]);
  });
  return app;
}

/**
 * Starts the Auth service from the environment, validating every setting before listening:
 * TECTON_AUTH_DATABASE_URL, TECTON_AUTH_PEPPER(_ID), TECTON_AUTH_PREVIOUS_PEPPERS,
 * TECTON_AUTH_SIGNING_KEY, TECTON_AUTH_PREVIOUS_PUBLIC_KEYS, TECTON_AUTH_NEXT_PUBLIC_KEYS,
 * TECTON_AUTH_ISSUER, TECTON_AUTH_AUDIENCE, TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS,
 * TECTON_AUTH_REFRESH_TOKEN_TTL_SECONDS, TECTON_VALKEY_URL (token revocation, required),
 * TECTON_REVOCATION_TIMEOUT_MS, PORT and HOST.
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
  const { port, host } = listenSettingsFromEnv(env);
  // Last of the settings: it opens a connection (in the background).
  const revocations = tokenRevocationStoreFromEnv(env);
  const auth = createArgon2idAuthProvider({ peppers: [pepper, ...previousPeppers], currentPepperId: pepper.id });
  const issuer = createAccessTokenIssuer({ keys, clock: systemClock, ...tokens });
  // One database client for both stores; it disconnects once, when the app closes.
  const client = createAuthPrismaClient(databaseUrl);
  const store = createPrismaCredentialStore({ client });
  const refreshTokens = createPrismaRefreshTokenStore({ client });
  let app: AuthServiceApp | undefined;
  try {
    app = await createAuthService({
      store,
      refreshTokens,
      auth,
      issuer,
      keys,
      revocations,
      tokenIssuer: tokens.issuer,
      tokenAudience: tokens.audience,
      refreshTtlSeconds,
      logger: { level: 'info', redact: LOG_REDACTION },
    });
    await app.listen({ port, host });
    return app;
  } catch (error) {
    // Closing the app closes the client and the store; without an app, close them directly.
    await (app ? app.close() : Promise.all([client.close(), revocations.close()])).catch(() => undefined);
    throw error;
  }
}
