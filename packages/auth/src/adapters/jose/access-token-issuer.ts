import type { Clock } from '@tecton/providers';
import { SignJWT } from 'jose';
import { v7 as uuidv7 } from 'uuid';
import type { AccessTokenIssuer } from '../../core/access-token.js';
import { serviceSubject, type ServiceTokenIssuer } from '../../core/service-credential.js';
import type { SigningKeys } from './signing-keys.js';

/** Default and limits of the access token lifetime, in seconds. */
export const ACCESS_TOKEN_TTL = { default: 900, min: 60, max: 3600 } as const;
export const DEFAULT_ISSUER = 'urn:tecton:auth';
export const DEFAULT_AUDIENCE = 'urn:tecton:api';

export interface AccessTokenIssuerOptions {
  keys: SigningKeys;
  clock: Clock;
  issuer?: string;
  audience?: string;
  ttlSeconds?: number;
}

/**
 * Signs user access tokens with EdDSA (Ed25519): header { alg, kid, typ: at+jwt }, claims iss, sub, aud,
 * iat, exp (seconds, from the Clock), jti (UUID v7), typ "user" and perms.
 */
export function createAccessTokenIssuer({
  keys,
  clock,
  issuer = DEFAULT_ISSUER,
  audience = DEFAULT_AUDIENCE,
  ttlSeconds = ACCESS_TOKEN_TTL.default,
}: AccessTokenIssuerOptions): AccessTokenIssuer {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < ACCESS_TOKEN_TTL.min || ttlSeconds > ACCESS_TOKEN_TTL.max) {
    throw new RangeError(`access token lifetime must be an integer between ${ACCESS_TOKEN_TTL.min} and ${ACCESS_TOKEN_TTL.max} seconds`);
  }
  if (issuer.trim() === '' || audience.trim() === '') throw new RangeError('issuer and audience must not be empty');

  return {
    issuer,
    audience,
    async issue(credential) {
      const issuedAt = Math.floor(clock.now().getTime() / 1000);
      const accessToken = await new SignJWT({ typ: 'user', perms: [...credential.permissions] })
        // at+jwt (RFC 9068): an access token can never be mistaken for another JWT of the same key.
        .setProtectedHeader({ alg: 'EdDSA', kid: keys.current.kid, typ: 'at+jwt' })
        .setIssuer(issuer)
        .setSubject(credential.id)
        .setAudience(audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ttlSeconds)
        .setJti(uuidv7())
        .sign(keys.current.privateKey);
      return { accessToken, tokenType: 'Bearer', expiresIn: ttlSeconds };
    },
  };
}

/** Default and limits of the service token lifetime, in seconds (Story 2.7a: 5 minutes). */
export const SERVICE_TOKEN_TTL = { default: 300, min: 60, max: 900 } as const;

/**
 * Signs service tokens (Story 2.7a): the same key, issuer, audience and header as user tokens,
 * with typ "service", sub "service:<domain>" and the permissions of the service.
 */
export function createServiceTokenIssuer({
  keys,
  clock,
  issuer = DEFAULT_ISSUER,
  audience = DEFAULT_AUDIENCE,
  ttlSeconds = SERVICE_TOKEN_TTL.default,
}: AccessTokenIssuerOptions): ServiceTokenIssuer {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < SERVICE_TOKEN_TTL.min || ttlSeconds > SERVICE_TOKEN_TTL.max) {
    throw new RangeError(`service token lifetime must be an integer between ${SERVICE_TOKEN_TTL.min} and ${SERVICE_TOKEN_TTL.max} seconds`);
  }
  if (issuer.trim() === '' || audience.trim() === '') throw new RangeError('issuer and audience must not be empty');
  return {
    async issue({ domain, permissions, issuedAfter }) {
      // Strictly after `issuedAfter` (a rotation's revocation instant), at most a second or two
      // ahead of the clock: well within the 30-s tolerance of every verifier.
      const issuedAt = Math.max(Math.floor(clock.now().getTime() / 1000), Math.floor(issuedAfter.getTime() / 1000) + 1);
      const accessToken = await new SignJWT({ typ: 'service', perms: [...permissions] })
        .setProtectedHeader({ alg: 'EdDSA', kid: keys.current.kid, typ: 'at+jwt' })
        .setIssuer(issuer)
        .setSubject(serviceSubject(domain))
        .setAudience(audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ttlSeconds)
        .setJti(uuidv7())
        .sign(keys.current.privateKey);
      return { accessToken, tokenType: 'Bearer', expiresIn: ttlSeconds };
    },
  };
}
