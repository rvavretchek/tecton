import { createHmac, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';

// Token factory of the Test Design (R-02, P0-011): valid user access tokens signed with a test
// Ed25519 key, and forged variants every verifier must refuse. Signed with node:crypto on purpose:
// the fixture must not share code with the verifier it attacks.

export interface TestSigningKey {
  kid: string;
  privateKey: KeyObject;
  /** Public JWK as the Auth JWKS publishes it. */
  publicJwk: { kty: string; crv: string; x: string; kid: string; alg: 'EdDSA'; use: 'sig' };
}

export function createTestSigningKey(kid = `test-${randomUUID()}`): TestSigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string };
  return { kid, privateKey, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, kid, alg: 'EdDSA', use: 'sig' } };
}

const b64 = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function signed(header: Record<string, unknown>, payload: Record<string, unknown>, signer: (input: Buffer) => Buffer): string {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${signer(Buffer.from(input)).toString('base64url')}`;
}

export interface TokenClaims {
  sub: string;
  perms: string[];
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  typ: string;
  [claim: string]: unknown;
}

export interface TokenFactoryOptions {
  issuer?: string;
  audience?: string;
  /** Issue time; default now. */
  now?: Date;
  ttlSeconds?: number;
}

/** Valid and forged tokens for one signing key. */
export function tokenFactory(key: TestSigningKey, options: TokenFactoryOptions = {}) {
  const issuer = options.issuer ?? 'urn:tecton:auth';
  const audience = options.audience ?? 'urn:tecton:api';
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const exp = iat + (options.ttlSeconds ?? 900);
  const claims = (overrides: Partial<TokenClaims> = {}): TokenClaims => ({
    sub: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
    perms: [],
    iss: issuer,
    aud: audience,
    iat,
    exp,
    jti: randomUUID(),
    typ: 'user',
    ...overrides,
  });
  const header = (overrides: Record<string, unknown> = {}) => ({ alg: 'EdDSA', kid: key.kid, typ: 'at+jwt', ...overrides });
  const eddsa = (input: Buffer) => sign(null, input, key.privateKey);

  /** A token the verifier must accept; claims and header can be overridden to build variants. */
  const valid = (overrides: Partial<TokenClaims> = {}, headerOverrides: Record<string, unknown> = {}) =>
    signed(header(headerOverrides), claims(overrides), eddsa);

  /** Every forgery of the Test Design, by name: each must be refused with 401. */
  const forged = (): Record<string, string> => {
    const good = valid();
    const [goodHeader, goodPayload, goodSignature] = good.split('.') as [string, string, string];
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const publicKeyAsSecret = JSON.stringify(key.publicJwk);
    const tamperedSignature = `${goodSignature.slice(0, -2)}${goodSignature.endsWith('AA') ? 'BB' : 'AA'}`;
    return {
      'alg none': `${b64({ alg: 'none', kid: key.kid, typ: 'at+jwt' })}.${goodPayload}.`,
      'HS256 with the public key as secret': signed(header({ alg: 'HS256' }), claims(), (input) => createHmac('sha256', publicKeyAsSecret).update(input).digest()),
      RS256: signed(header({ alg: 'RS256' }), claims(), (input) => sign('sha256', input, rsa)),
      'unknown kid': valid({}, { kid: 'kid-that-does-not-exist' }),
      'no kid': signed({ alg: 'EdDSA', typ: 'at+jwt' }, claims(), eddsa),
      'other signing key': signed(header(), claims(), (input) => sign(null, input, createTestSigningKey(key.kid).privateKey)),
      expired: valid({ iat: iat - 3600, exp: iat - 60 }),
      'wrong issuer': valid({ iss: 'urn:evil:auth' }),
      'wrong audience': valid({ aud: 'urn:other:api' }),
      'header typ JWT': valid({}, { typ: 'JWT' }),
      'no header typ': signed({ alg: 'EdDSA', kid: key.kid }, claims(), eddsa),
      'service token': valid({ typ: 'service' }),
      'no perms': signed(header(), (({ perms: _perms, ...rest }) => rest)(claims()), eddsa),
      'perms not a list': valid({ perms: 'tenant:create' as unknown as string[] }),
      'no sub': signed(header(), (({ sub: _sub, ...rest }) => rest)(claims()), eddsa),
      'no jti': signed(header(), (({ jti: _jti, ...rest }) => rest)(claims()), eddsa),
      'tampered signature': `${goodHeader}.${goodPayload}.${tamperedSignature}`,
      'tampered payload': `${goodHeader}.${b64(claims({ perms: ['tenant:create', 'auth:service:register'] }))}.${goodSignature}`,
      'tampered header': `${b64(header({ kid: `${key.kid}x` }))}.${goodPayload}.${goodSignature}`,
    };
  };

  return { valid, forged, claims };
}
