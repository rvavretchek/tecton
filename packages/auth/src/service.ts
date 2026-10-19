import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTectonServer, frameworkErrors, loadDomainManifest, registerActionRoutes, type TectonServerOptions } from '@tecton/core';
import { createArgon2idAuthProvider, pepperFromEnv, systemClock, type AuthProvider, type Clock } from '@tecton/providers';
import type { AccessTokenIssuer } from './core/access-token.js';
import type { CredentialStore } from './core/credential-store.js';
import { InvalidCredentialsError, login } from './core/login.js';
import {
  AuthConfigError,
  listenSettingsFromEnv,
  previousPeppersFromEnv,
  signingKeysFromEnv,
  tokenSettingsFromEnv,
} from './adapters/env/config-from-env.js';
import { createAccessTokenIssuer } from './adapters/jose/access-token-issuer.js';
import type { SigningKeys } from './adapters/jose/signing-keys.js';
import { createPrismaCredentialStore } from './adapters/prisma/prisma-credential-store.js';

/** The Fastify instance the Auth service runs on (same type @tecton/core creates). */
export type AuthServiceApp = ReturnType<typeof createTectonServer>;

/** The Auth manifest ships at the package root (src/ in tests, dist/ when published: both one level below). */
export const AUTH_MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'tecton.yaml');
export const JWKS_PATH = '/auth/.well-known/jwks.json';
export const LOGIN_PATH = '/auth/login';

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
  auth: AuthProvider;
  issuer: AccessTokenIssuer;
  keys: SigningKeys;
  clock?: Clock;
  logger?: TectonServerOptions['logger'];
}

/**
 * Builds the Auth service (not listening yet): the manifest actions, with `login` implemented and
 * the others answering 501 until Stories 2.3 and 2.7, plus GET /auth/.well-known/jwks.json.
 * Closing the app closes the credential store.
 */
export async function createAuthService({ store, auth, issuer, keys, clock = systemClock, logger }: AuthServiceOptions): Promise<AuthServiceApp> {
  // Verified when the login does not exist: same Argon2id cost as a real account (P0-006).
  const dummyHash = await auth.hashPassword(randomBytes(32).toString('base64'));
  const app = createTectonServer(logger === undefined ? {} : { logger });
  registerActionRoutes(app, loadDomainManifest(AUTH_MANIFEST_PATH), {
    login: async (input) => {
      try {
        return await login(
          {
            store,
            auth,
            issuer,
            clock,
            dummyHash,
            onRehashFailure: (error) => app.log.warn({ err: safeError(error) }, 'password re-hash after login failed'),
            onCorruptCredential: (error) => app.log.warn({ err: safeError(error) }, 'corrupt credential refused at login'),
          },
          { login: input['login'] as string, password: input['password'] as string },
        );
      } catch (error) {
        if (error instanceof InvalidCredentialsError) throw frameworkErrors.unauthorized();
        throw error;
      }
    },
  });
  // Responses carrying tokens must never be cached (RFC 6749 5.1), success and failure alike.
  app.addHook('onSend', async (request, reply) => {
    if (request.routeOptions.url === LOGIN_PATH) reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
  });
  const jwks = { keys: keys.publicJwks.map((jwk) => ({ ...jwk })) };
  app.get(JWKS_PATH, async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return jwks;
  });
  app.addHook('onClose', async () => {
    await store.close();
  });
  return app;
}

/**
 * Starts the Auth service from the environment, validating every setting before listening:
 * TECTON_AUTH_DATABASE_URL, TECTON_AUTH_PEPPER(_ID), TECTON_AUTH_PREVIOUS_PEPPERS,
 * TECTON_AUTH_SIGNING_KEY, TECTON_AUTH_PREVIOUS_PUBLIC_KEYS, TECTON_AUTH_NEXT_PUBLIC_KEYS,
 * TECTON_AUTH_ISSUER, TECTON_AUTH_AUDIENCE, TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS, PORT and HOST.
 * If anything fails after the database client is created, it is closed before the error propagates.
 */
export async function startAuthServiceFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<AuthServiceApp> {
  const databaseUrl = env['TECTON_AUTH_DATABASE_URL']?.trim();
  if (!databaseUrl) throw new AuthConfigError('TECTON_AUTH_DATABASE_URL is not set; point it to the Auth database');
  const pepper = pepperFromEnv(env);
  const previousPeppers = previousPeppersFromEnv(env);
  const keys = await signingKeysFromEnv(env);
  const tokens = tokenSettingsFromEnv(env);
  const { port, host } = listenSettingsFromEnv(env);
  const auth = createArgon2idAuthProvider({ peppers: [pepper, ...previousPeppers], currentPepperId: pepper.id });
  const issuer = createAccessTokenIssuer({ keys, clock: systemClock, ...tokens });
  const store = createPrismaCredentialStore({ databaseUrl });
  let app: AuthServiceApp | undefined;
  try {
    app = await createAuthService({ store, auth, issuer, keys, logger: { level: 'info', redact: LOG_REDACTION } });
    await app.listen({ port, host });
    return app;
  } catch (error) {
    // Closing the app closes the store; without an app, close the store itself.
    await (app ? app.close() : store.close()).catch(() => undefined);
    throw error;
  }
}
