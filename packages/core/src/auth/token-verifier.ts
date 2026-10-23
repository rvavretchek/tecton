import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import {
  createValkeyTokenRevocationStore,
  RevocationStoreUnavailableError,
  ValkeyConfigError,
  valkeyClientFromEnv,
  waitForValkeyReady,
  type TokenRevocationStore,
  type ValkeyClient,
} from '@tecton/providers';
import { createLocalJWKSet, decodeProtectedHeader, errors, jwtVerify, type FlattenedJWSInput, type JWK, type JWSHeaderParameters } from 'jose';

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
 * An unknown `kid` refetches the JWKS only when the last attempt, successful or not, is older than
 * this: at most one fetch per 30 s, however many unknown tokens arrive.
 */
export const JWKS_REFETCH_COOLDOWN_MS = 30_000;
/** After a failed fetch, no new fetch for this long: requests fail fast with 503 (Retry-After: 5). */
export const JWKS_FAILURE_BACKOFF_MS = 5_000;
/** Skew accepted between the clocks of the Auth service and this one (exp, iat). */
export const CLOCK_TOLERANCE_SECONDS = 30;

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
  /**
   * Releases what the verifier owns: only a verifier built by tokenVerifierFromEnv owns its
   * revocation store; one given a store by its caller leaves it to the caller.
   */
  close?(): Promise<void>;
  /**
   * Resolves once what the verifier depends on is reachable (the revocation Valkey), false after
   * `timeoutMs`. Only a verifier built by tokenVerifierFromEnv has it.
   */
  ready?(timeoutMs: number): Promise<boolean>;
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
  /**
   * Revoked tokens (Story 2.5, FR-14). Required: a service never verifies without checking
   * revocation. When it cannot answer, the request is refused with 503 (fail closed).
   */
  revocations: TokenRevocationStore;
}

/** Marks a failure to obtain the keys, as opposed to a bad token. */
class KeysUnavailable extends Error {
  override readonly name = 'KeysUnavailable';
}

const BEARER = /^Bearer ([A-Za-z0-9_.-]+)$/i;

/**
 * The JWKS request: node:http(s) with the optional CA, never following a redirect (any 3xx is an
 * error, AD-7), 200 with JSON only, body capped at MAX_JWKS_BYTES (declared or streamed), settled
 * exactly once even when the connection closes mid-body.
 */
function fetchJwks(url: URL, ca: string | undefined, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      request.destroy();
      reject(new KeysUnavailable(reason));
    };
    const secure = url.protocol === 'https:';
    const request = (secure ? https : http).request(
      url,
      { method: 'GET', headers: { accept: 'application/json' }, timeout: timeoutMs, ...(secure && ca ? { ca } : {}) },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status !== 200) return fail(status >= 300 && status < 400 ? `redirect (${status}) refused` : `status ${status}`);
        if (!/^application\/(jwk-set\+)?json\b/i.test(response.headers['content-type'] ?? '')) return fail('not JSON');
        if (Number(response.headers['content-length'] ?? 0) > MAX_JWKS_BYTES) return fail('too large');
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_JWKS_BYTES) return fail('too large');
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          settled = true;
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new KeysUnavailable('invalid JSON'));
          }
        });
        response.on('error', () => fail('response error'));
        response.on('close', () => fail('connection closed'));
      },
    );
    request.on('timeout', () => fail('timeout'));
    request.on('error', (error: NodeJS.ErrnoException) => fail(error.code ?? 'request error'));
    request.end();
  });
}

type KeyGetter = ReturnType<typeof createLocalJWKSet>;

/**
 * Cache of the Auth JWKS. Keys are reused for JWKS_CACHE_MAX_AGE_MS. An unknown `kid` triggers a
 * new fetch only if the last attempt, successful or not, is older than JWKS_REFETCH_COOLDOWN_MS;
 * after a failed fetch, no other fetch starts for JWKS_FAILURE_BACKOFF_MS (the 503 Retry-After).
 * Concurrent fetches are merged. Expired keys are never used (fail closed).
 */
function createJwksCache(url: URL, ca: string | undefined, timeoutMs: number, now: () => number) {
  let local: KeyGetter | undefined;
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let attemptedAt = Number.NEGATIVE_INFINITY;
  let failedAt = Number.NEGATIVE_INFINITY;
  let pending: Promise<void> | undefined;

  const reload = (): Promise<void> => {
    if (pending) return pending;
    if (now() - failedAt < JWKS_FAILURE_BACKOFF_MS) return Promise.reject(new KeysUnavailable('recent failure'));
    attemptedAt = now();
    pending = fetchJwks(url, ca, timeoutMs)
      .then((json) => {
        const keys = (json as { keys?: unknown } | null)?.keys;
        if (!Array.isArray(keys)) throw new KeysUnavailable('not a JWK Set');
        local = createLocalJWKSet({ keys: keys as JWK[] });
        fetchedAt = now();
      })
      .catch((error: unknown) => {
        failedAt = now();
        throw error instanceof KeysUnavailable ? error : new KeysUnavailable('fetch failed', { cause: error });
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };

  return async (header: JWSHeaderParameters, token: FlattenedJWSInput) => {
    if (!local || now() - fetchedAt >= JWKS_CACHE_MAX_AGE_MS) await reload();
    try {
      return await (local as KeyGetter)(header, token);
    } catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey)) throw error;
      // Unknown kid: maybe a key published after the last fetch (rotation). At most one fetch per cooldown.
      if (now() - attemptedAt < JWKS_REFETCH_COOLDOWN_MS) throw error;
      await reload();
      return (local as KeyGetter)(header, token);
    }
  };
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

/** A CA option must hold at least one valid PEM certificate; checked at startup, not at the first request. */
function validatedCa(ca: string | undefined): string | undefined {
  if (ca === undefined) return undefined;
  try {
    if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error('no certificate');
    new X509Certificate(ca);
  } catch {
    throw new TokenVerifierConfigError('the JWKS CA must hold a valid PEM certificate');
  }
  return ca;
}

function validatedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_JWKS_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TokenVerifierConfigError('jwksTimeoutMs must be an integer between 1 and 60000');
  }
  return timeoutMs;
}

/** Creates the verifier of a service; the JWKS URL, CA and limits are checked here, at startup. */
export function createTokenVerifier(options: TokenVerifierOptions): TokenVerifier {
  const url = validatedUrl(options.jwksUrl, options.devMode === true);
  const issuer = claimText('issuer', options.issuer ?? DEFAULT_ISSUER);
  const audience = claimText('audience', options.audience ?? DEFAULT_AUDIENCE);
  const clock = options.clock ?? { now: () => new Date() };
  const { revocations } = options;
  if (!revocations) throw new TokenVerifierConfigError('a token revocation store is required (Story 2.5, FR-14)');
  // Cache timing runs on Date.now, like any wall-clock TTL; token times run on the Clock.
  const cache = createJwksCache(url, validatedCa(options.ca), validatedTimeout(options.jwksTimeoutMs), () => Date.now());

  // A key that matches no `kid` (after the one rate-limited refetch) is a bad token. Every other
  // failure to get a key (fetch failed, invalid JWKS, a duplicated kid) means verification is
  // unavailable: a broken JWKS must never look like bad tokens and log users out.
  const keys = async (header: JWSHeaderParameters, token: FlattenedJWSInput) => {
    try {
      return await cache(header, token);
    } catch (error) {
      if (error instanceof errors.JWKSNoMatchingKey) throw error;
      throw error instanceof KeysUnavailable ? error : new KeysUnavailable('invalid JWKS', { cause: error });
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
          // Small skew between the Auth host and this one.
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
        }));
      } catch (error) {
        if (error instanceof KeysUnavailable) {
          throw new TokenVerificationUnavailableError(`the JWKS could not be used: ${error.message}`, { cause: error });
        }
        throw new InvalidTokenError();
      }

      const { sub, jti, iat, exp, typ, perms } = payload;
      // Only user tokens until Story 2.7 adds service tokens.
      if (typ !== 'user') throw new InvalidTokenError();
      if (!Array.isArray(perms) || !perms.every((perm) => typeof perm === 'string')) throw new InvalidTokenError();
      if (typeof sub !== 'string' || typeof jti !== 'string' || typeof iat !== 'number' || typeof exp !== 'number') throw new InvalidTokenError();
      // A token issued in the future (beyond the tolerance) is never valid.
      if (iat > clock.now().getTime() / 1000 + CLOCK_TOLERANCE_SECONDS) throw new InvalidTokenError();
      // Revocation (Story 2.5): by jti or by subject; when the store cannot answer, never "not revoked".
      let revoked: boolean;
      try {
        revoked = await revocations.isRevoked({ tokenId: jti, subject: sub, issuedAt: new Date(iat * 1000) });
      } catch (error) {
        if (error instanceof RevocationStoreUnavailableError) {
          throw new TokenVerificationUnavailableError(`revocation could not be checked: ${error.message}`, { cause: error });
        }
        // An id the store cannot hold (too long, control characters) is not a token of ours.
        if (error instanceof RangeError) throw new InvalidTokenError();
        throw error;
      }
      if (revoked) throw new InvalidTokenError();
      return { subject: sub, permissions: [...perms], tokenId: jti, issuedAt: new Date(iat * 1000), expiresAt: new Date(exp * 1000) };
    },
  };
}

/**
 * The verifier of a domain service from its environment: TECTON_JWKS_URL (required),
 * TECTON_AUTH_ISSUER and TECTON_AUTH_AUDIENCE (defaults urn:tecton:auth and urn:tecton:api),
 * TECTON_ENV (only "development" allows an http JWKS URL), TECTON_JWKS_CA_FILE (optional PEM),
 * and the revocation store: TECTON_VALKEY_URL (required) and TECTON_VALKEY_TIMEOUT_MS.
 */
export function tokenVerifierFromEnv(
  env: NodeJS.ProcessEnv,
  options: { onRevocationStoreError?: (error: Error) => void } = {},
): TokenVerifier {
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
  const devMode = env['TECTON_ENV']?.trim() === 'development';
  // The JWKS URL is checked before the store opens a connection.
  try {
    validatedUrl(jwksUrl, devMode);
  } catch (error) {
    if (error instanceof TokenVerifierConfigError) throw new TokenVerifierConfigError(`TECTON_JWKS_URL: ${error.message}`);
    throw error;
  }
  // TECTON_VALKEY_URL (required) and TECTON_VALKEY_TIMEOUT_MS: the client names its variables.
  let revocations: TokenRevocationStore;
  let valkey: ValkeyClient;
  try {
    valkey = valkeyClientFromEnv(env, options.onRevocationStoreError ? { onError: options.onRevocationStoreError } : {});
    // The store owns the client it is given here: closing the store closes it.
    revocations = createValkeyTokenRevocationStore({ client: valkey });
  } catch (error) {
    // One error class for every setting of the verifier.
    if (error instanceof ValkeyConfigError) throw new TokenVerifierConfigError(error.message);
    throw error;
  }
  try {
    const verifier = createTokenVerifier({
      jwksUrl,
      issuer: text('TECTON_AUTH_ISSUER', DEFAULT_ISSUER),
      audience: text('TECTON_AUTH_AUDIENCE', DEFAULT_AUDIENCE),
      devMode,
      revocations,
      ...(ca === undefined ? {} : { ca }),
    });
    // This verifier owns the store it opened.
    const client = valkey;
    return {
      verify: (authorization) => verifier.verify(authorization),
      close: () => revocations.close(),
      ready: (timeoutMs) => waitForValkeyReady(client, timeoutMs),
    };
  } catch (error) {
    // The store connects in the background: release it when the verifier cannot be built.
    void revocations.close();
    // Name the variable behind the problem (never its value).
    if (!(error instanceof TokenVerifierConfigError)) throw error;
    const variable = /JWKS URL/.test(error.message) ? 'TECTON_JWKS_URL' : /CA/.test(error.message) ? 'TECTON_JWKS_CA_FILE' : /^issuer/.test(error.message) ? 'TECTON_AUTH_ISSUER' : 'TECTON_AUTH_AUDIENCE';
    throw new TokenVerifierConfigError(`${variable}: ${error.message}`);
  }
}
