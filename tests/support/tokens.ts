import { createHmac, createPublicKey, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';

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
    const publicJwkAsSecret = JSON.stringify(key.publicJwk);
    const publicPemAsSecret = createPublicKey(key.privateKey).export({ type: 'spki', format: 'pem' }).toString();
    // A character in the middle: the last one carries padding bits that a lenient decoder ignores.
    const middle = Math.floor(goodSignature.length / 2);
    const tamperedSignature = `${goodSignature.slice(0, middle)}${goodSignature[middle] === 'A' ? 'B' : 'A'}${goodSignature.slice(middle + 1)}`;
    return {
      'alg none': `${b64({ alg: 'none', kid: key.kid, typ: 'at+jwt' })}.${goodPayload}.`,
      'HS256 with the public key (PEM) as secret': signed(header({ alg: 'HS256' }), claims(), (input) => createHmac('sha256', publicPemAsSecret).update(input).digest()),
      'HS256 with the public JWK as secret': signed(header({ alg: 'HS256' }), claims(), (input) => createHmac('sha256', publicJwkAsSecret).update(input).digest()),
      RS256: signed(header({ alg: 'RS256' }), claims(), (input) => sign('sha256', input, rsa)),
      'unknown kid': valid({}, { kid: 'kid-that-does-not-exist' }),
      'no kid': signed({ alg: 'EdDSA', typ: 'at+jwt' }, claims(), eddsa),
      'other signing key': signed(header(), claims(), (input) => sign(null, input, createTestSigningKey(key.kid).privateKey)),
      expired: valid({ iat: iat - 3600, exp: iat - 60 }),
      'wrong issuer': valid({ iss: 'urn:evil:auth' }),
      'wrong audience': valid({ aud: 'urn:other:api' }),
      'header typ JWT': valid({}, { typ: 'JWT' }),
      'no header typ': signed({ alg: 'EdDSA', kid: key.kid }, claims(), eddsa),
      // A type must match its subject (Story 2.7b): neither kind passes for the other.
      'service typ with a user subject': valid({ typ: 'service' }),
      'user typ with a service subject': valid({ sub: 'service:billing' }),
      'service typ with an invalid domain': valid({ typ: 'service', sub: 'service:Billing_X' }),
      'service typ for the Auth service': valid({ typ: 'service', sub: 'service:auth' }),
      'unknown typ': valid({ typ: 'admin' }),
      'no perms': signed(header(), (({ perms: _perms, ...rest }) => rest)(claims()), eddsa),
      'perms not a list': valid({ perms: 'tenant:create' as unknown as string[] }),
      'perms with a non-string item': valid({ perms: ['tenant:create', 1] as unknown as string[] }),
      'no sub': signed(header(), (({ sub: _sub, ...rest }) => rest)(claims()), eddsa),
      'no jti': signed(header(), (({ jti: _jti, ...rest }) => rest)(claims()), eddsa),
      'tampered signature': `${goodHeader}.${goodPayload}.${tamperedSignature}`,
      'tampered payload': `${goodHeader}.${b64(claims({ perms: ['tenant:create', 'auth:service:register'] }))}.${goodSignature}`,
      'tampered header (other kid)': `${b64(header({ kid: `${key.kid}x` }))}.${goodPayload}.${goodSignature}`,
      'tampered header (same kid, extra field)': `${b64(header({ cty: 'JWT' }))}.${goodPayload}.${goodSignature}`,
    };
  };

  /** A valid service token of `domain` (Story 2.7): `typ: service`, `sub: service:<domain>`. */
  const service = (domain: string, overrides: Partial<TokenClaims> = {}) => valid({ typ: 'service', sub: `service:${domain}`, ...overrides });

  return { valid, service, forged, claims };
}
