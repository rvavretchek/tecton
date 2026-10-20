import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import {
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  errors,
  jwtVerify,
  type FlattenedJWSInput,
  type JWSHeaderParameters,
} from 'jose';

// Local token verification of every service (Story 2.4, AD-7): EdDSA signatures checked against
// the Auth service's JWKS, never trusting a header or another service.

export const DEFAULT_ISSUER = 'urn:tecton:auth';
export const DEFAULT_AUDIENCE = 'urn:tecton:api';
/** Longest token accepted in an Authorization header. */
export const MAX_TOKEN_LENGTH = 8192;
/** Largest JWKS response read. */
export const MAX_JWKS_BYTES = 64 * 1024;
const DEFAULT_JWKS_TIMEOUT_MS = 5_000;
/** Same as the Auth JWKS Cache-Control (max-age=300): keys are refreshed every 5 minutes. */
const JWKS_CACHE_MAX_AGE_MS = 300_000;
/**
 * An unknown `kid` refetches the JWKS only when the last fetch is older than this (jose
 * cooldownDuration): at most one fetch per 30 s, however many unknown tokens arrive.
 */
export const JWKS_REFETCH_COOLDOWN_MS = 30_000;

/** Who is calling, as the verified token says. A fresh object for every request. */
export interface Principal {
  /** `sub`: the credential id. */
  subject: string;
  /** `perms`. */
  permissions: string[];
  /** `jti`. */
  tokenId: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** The token is missing, malformed, forged, expired or not meant for this service. One error for every reason. */
export class InvalidTokenError extends Error {
  override readonly name = 'InvalidTokenError';
  constructor() {
    super('invalid token');
  }
}

/** The token could not be checked: the JWKS is unreachable, invalid or too slow (fail closed). */
export class TokenVerificationUnavailableError extends Error {
  override readonly name = 'TokenVerificationUnavailableError';
}

/** Invalid verifier configuration. Messages never echo the URL, which may carry credentials. */
export class TokenVerifierConfigError extends Error {
  override readonly name = 'TokenVerifierConfigError';
}

export interface TokenVerifier {
  /** Verifies an Authorization header value (`Bearer <token>`). */
  verify(authorization: string | undefined): Promise<Principal>;
}

export interface TokenVerifierOptions {
  /** JWKS of the Auth service, e.g. https://auth.internal/auth/.well-known/jwks.json. */
  jwksUrl: string;
  issuer?: string;
  audience?: string;
  /** Development mode (TECTON_ENV=development): only then may the JWKS URL be http. */
  devMode?: boolean;
  /** CA certificate(s), PEM, trusted for the JWKS request only (never process-wide). */
  ca?: string;
  clock?: { now(): Date };
  /** Time limit of one JWKS request, in milliseconds. Default 5000. */
  jwksTimeoutMs?: number;
}

/** Marks a failure to obtain the keys, as opposed to a bad token. */
class KeysUnavailable extends Error {}

const BEARER = /^Bearer ([A-Za-z0-9_.-]+)$/i;

/**
 * The JWKS request: node:http(s) with the optional CA, never following a redirect, 200 with JSON
 * only, body capped at MAX_JWKS_BYTES. Anything else becomes a non-200 Response, which jose refuses.
 */
function jwksFetch(ca: string | undefined) {
  return (url: string, init: { signal?: AbortSignal }): Promise<Response> =>
    new Promise((resolve, reject) => {
      const target = new URL(url);
      const secure = target.protocol === 'https:';
      const request = (secure ? https : http).request(
        target,
        { method: 'GET', headers: { accept: 'application/json' }, ...(init.signal ? { signal: init.signal } : {}), ...(secure && ca ? { ca } : {}) },
        (response) => {
          const status = response.statusCode ?? 0;
          const json = /^application\/(jwk-set\+)?json\b/i.test(response.headers['content-type'] ?? '');
          if (status !== 200 || !json) {
            // Redirects included: a 3xx is refused, never followed (AD-7).
            response.resume();
            resolve(new Response(null, { status: status >= 200 && status <= 599 && status !== 200 ? status : 502 }));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_JWKS_BYTES) {
              request.destroy(new Error('JWKS response too large'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: 200, headers: { 'content-type': 'application/json' } })));
          response.on('error', reject);
        },
      );
      request.on('error', reject);
      request.end();
    });
}

function validatedUrl(jwksUrl: string, devMode: boolean): URL {
  let url: URL;
  try {
    url = new URL(jwksUrl.trim());
  } catch {
    throw new TokenVerifierConfigError('the JWKS URL is not a valid URL');
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:') {
    if (devMode) return url;
    throw new TokenVerifierConfigError('the JWKS URL must use https outside development mode (TECTON_ENV=development)');
  }
  throw new TokenVerifierConfigError('the JWKS URL must use https (or http in development mode)');
}

function claimText(name: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed !== value) throw new TokenVerifierConfigError(`${name} must not be empty or padded with spaces`);
  return value;
}

/** Creates the verifier of a service; the JWKS URL is checked here, at startup. */
export function createTokenVerifier(options: TokenVerifierOptions): TokenVerifier {
  const url = validatedUrl(options.jwksUrl, options.devMode === true);
  const issuer = claimText('issuer', options.issuer ?? DEFAULT_ISSUER);
  const audience = claimText('audience', options.audience ?? DEFAULT_AUDIENCE);
  const clock = options.clock ?? { now: () => new Date() };
  const remote = createRemoteJWKSet(url, {
    timeoutDuration: options.jwksTimeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS,
    cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    cooldownDuration: JWKS_REFETCH_COOLDOWN_MS,
    [customFetch]: jwksFetch(options.ca),
  });

  // A key that matches no `kid` (after the one rate-limited refetch) is a bad token; any other
  // failure to get the keys means verification is unavailable.
  const keys = async (header: JWSHeaderParameters, token: FlattenedJWSInput) => {
    try {
      return await remote(header, token);
    } catch (error) {
      if (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys) throw error;
      throw new KeysUnavailable();
    }
  };

  return {
    async verify(authorization) {
      const match = typeof authorization === 'string' && authorization.length <= MAX_TOKEN_LENGTH + 7 ? BEARER.exec(authorization) : null;
      const token = match?.[1];
      if (!token || token.length > MAX_TOKEN_LENGTH) throw new InvalidTokenError();

      let header: JWSHeaderParameters;
      try {
        header = decodeProtectedHeader(token);
      } catch {
        throw new InvalidTokenError();
      }
      if (header.alg !== 'EdDSA' || typeof header.kid !== 'string' || header.kid === '') throw new InvalidTokenError();

      let payload: Record<string, unknown>;
      try {
        ({ payload } = await jwtVerify(token, keys, {
          algorithms: ['EdDSA'],
          issuer,
          audience,
          typ: 'at+jwt',
          requiredClaims: ['sub', 'jti', 'exp', 'iat'],
          currentDate: clock.now(),
        }));
      } catch (error) {
        if (error instanceof KeysUnavailable) throw new TokenVerificationUnavailableError('the JWKS could not be fetched');
        throw new InvalidTokenError();
      }

      const { sub, jti, iat, exp, typ, perms } = payload;
      // Only user tokens until Story 2.7 adds service tokens.
      if (typ !== 'user') throw new InvalidTokenError();
      if (!Array.isArray(perms) || !perms.every((perm) => typeof perm === 'string')) throw new InvalidTokenError();
      if (typeof sub !== 'string' || typeof jti !== 'string' || typeof iat !== 'number' || typeof exp !== 'number') throw new InvalidTokenError();
      return { subject: sub, permissions: [...perms], tokenId: jti, issuedAt: new Date(iat * 1000), expiresAt: new Date(exp * 1000) };
    },
  };
}

/**
 * The verifier of a domain service from its environment: TECTON_JWKS_URL (required),
 * TECTON_AUTH_ISSUER and TECTON_AUTH_AUDIENCE (defaults urn:tecton:auth and urn:tecton:api),
 * TECTON_ENV (only "development" allows an http JWKS URL) and TECTON_JWKS_CA_FILE (optional PEM).
 */
export function tokenVerifierFromEnv(env: NodeJS.ProcessEnv): TokenVerifier {
  const jwksUrl = env['TECTON_JWKS_URL']?.trim();
  if (!jwksUrl) {
    throw new TokenVerifierConfigError(
      'TECTON_JWKS_URL is not set; point it to the JWKS of the Auth service (https://<auth>/auth/.well-known/jwks.json)',
    );
  }
  const text = (name: string, fallback: string) => {
    const value = env[name]?.trim();
    return value ? value : fallback;
  };
  const caFile = env['TECTON_JWKS_CA_FILE']?.trim();
  let ca: string | undefined;
  if (caFile) {
    try {
      ca = readFileSync(caFile, 'utf8');
    } catch {
      throw new TokenVerifierConfigError('TECTON_JWKS_CA_FILE could not be read');
    }
  }
  return createTokenVerifier({
    jwksUrl,
    issuer: text('TECTON_AUTH_ISSUER', DEFAULT_ISSUER),
    audience: text('TECTON_AUTH_AUDIENCE', DEFAULT_AUDIENCE),
    devMode: env['TECTON_ENV']?.trim() === 'development',
    ...(ca === undefined ? {} : { ca }),
  });
}
