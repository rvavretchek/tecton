import type { Clock } from '@tecton/providers';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { DEFAULT_AUDIENCE, DEFAULT_ISSUER } from './access-token-issuer.js';
import type { SigningKeys } from './signing-keys.js';

/** Same tolerance as the verifier of the services (Story 2.4). */
const CLOCK_TOLERANCE_SECONDS = 30;
const BEARER = /^Bearer ([A-Za-z0-9_.-]{1,8192})$/i;

export interface OwnAccessToken {
  tokenId: string;
  subject: string;
  expiresAt: Date;
}

export interface OwnAccessTokenReaderOptions {
  keys: SigningKeys;
  clock: Clock;
  issuer?: string;
  audience?: string;
}

/**
 * Reads an access token issued by this Auth service, from an Authorization header, verified
 * locally with its own public keys (never over the network). Used by logout to revoke the token in
 * use (Story 2.5). Returns undefined for a missing, malformed, foreign or expired token.
 */
export function createOwnAccessTokenReader({ keys, clock, issuer = DEFAULT_ISSUER, audience = DEFAULT_AUDIENCE }: OwnAccessTokenReaderOptions) {
  const jwks = createLocalJWKSet({ keys: keys.publicJwks.map((jwk) => ({ ...jwk })) });
  return async (authorization: string | undefined): Promise<OwnAccessToken | undefined> => {
    const token = typeof authorization === 'string' ? BEARER.exec(authorization)?.[1] : undefined;
    if (!token) return undefined;
    try {
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: ['EdDSA'],
        issuer,
        audience,
        typ: 'at+jwt',
        requiredClaims: ['sub', 'jti', 'exp'],
        currentDate: clock.now(),
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      if (payload['typ'] !== 'user' || typeof payload.jti !== 'string' || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return undefined;
      return { tokenId: payload.jti, subject: payload.sub, expiresAt: new Date(payload.exp * 1000) };
    } catch {
      return undefined;
    }
  };
}
