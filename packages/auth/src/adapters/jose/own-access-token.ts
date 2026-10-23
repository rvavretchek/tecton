import { InvalidTokenError, TokenVerificationUnavailableError, type TokenVerifier } from '@tecton/core';
import { RevocationStoreUnavailableError, type Clock, type TokenRevocationStore } from '@tecton/providers';
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
  issuedAt: Date;
  permissions: string[];
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
        requiredClaims: ['sub', 'jti', 'exp', 'iat'],
        currentDate: clock.now(),
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      const { jti, sub, exp, iat, perms } = payload;
      // User tokens only: a service token is never an administrator nor a logout target (AC 8).
      if (payload['typ'] !== 'user' || typeof jti !== 'string' || typeof sub !== 'string' || typeof exp !== 'number' || typeof iat !== 'number') return undefined;
      if (!Array.isArray(perms) || !perms.every((perm) => typeof perm === 'string')) return undefined;
      if (iat > clock.now().getTime() / 1000 + CLOCK_TOLERANCE_SECONDS) return undefined;
      return { tokenId: jti, subject: sub, expiresAt: new Date(exp * 1000), issuedAt: new Date(iat * 1000), permissions: [...perms] };
    } catch {
      return undefined;
    }
  };
}

/**
 * The token verifier of the Auth service's own protected actions (Story 2.7a): its own user tokens,
 * verified locally (no JWKS over the network), then checked against revocation like every service
 * (Story 2.5). A revoked token is refused; a revocation store that cannot answer is unavailability.
 */
export function createOwnTokenVerifier(options: OwnAccessTokenReaderOptions & { revocations: TokenRevocationStore }): TokenVerifier {
  const read = createOwnAccessTokenReader(options);
  return {
    async verify(authorization) {
      const token = await read(authorization);
      if (!token) throw new InvalidTokenError();
      let revoked: boolean;
      try {
        revoked = await options.revocations.isRevoked({ tokenId: token.tokenId, subject: token.subject, issuedAt: token.issuedAt });
      } catch (error) {
        if (error instanceof RevocationStoreUnavailableError) throw new TokenVerificationUnavailableError(`revocation could not be checked: ${error.message}`, { cause: error });
        if (error instanceof RangeError) throw new InvalidTokenError();
        throw error;
      }
      if (revoked) throw new InvalidTokenError();
      return { subject: token.subject, permissions: token.permissions, tokenId: token.tokenId, issuedAt: token.issuedAt, expiresAt: token.expiresAt };
    },
  };
}
