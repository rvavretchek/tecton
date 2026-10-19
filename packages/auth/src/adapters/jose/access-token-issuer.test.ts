import { createTestClock, ed25519KeyPairPem as ed25519Pem } from '#test-support';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import type { Credential } from '../../core/credential.js';
import { createAccessTokenIssuer } from './access-token-issuer.js';
import { buildSigningKeys } from './signing-keys.js';

const credential: Credential = {
  id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
  login: 'alice',
  passwordHash: 'hash',
  status: 'active',
  permissions: ['tenant:create', 'auth:service:register'],
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe('createAccessTokenIssuer (AC 1)', () => {
  it('signs an EdDSA token with kid and the exact claims, verifiable through the published JWKS', async () => {
    const keys = await buildSigningKeys({ privateKeyPem: ed25519Pem().privatePem });
    const clock = createTestClock(new Date('2026-10-19T12:00:00.000Z'));
    const issued = await createAccessTokenIssuer({ keys, clock }).issue(credential);

    expect(issued).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(decodeProtectedHeader(issued.accessToken)).toEqual({ alg: 'EdDSA', kid: keys.current.kid, typ: 'at+jwt' });
    const { payload } = await jwtVerify(issued.accessToken, createLocalJWKSet({ keys: [...keys.publicJwks] }), {
      issuer: 'urn:tecton:auth',
      audience: 'urn:tecton:api',
      algorithms: ['EdDSA'],
      currentDate: clock.now(),
    });
    const iat = Date.parse('2026-10-19T12:00:00.000Z') / 1000;
    expect(payload).toEqual({
      iss: 'urn:tecton:auth',
      sub: credential.id,
      aud: 'urn:tecton:api',
      iat,
      exp: iat + 900,
      jti: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      typ: 'user',
      perms: ['tenant:create', 'auth:service:register'],
    });
  });

  it('uses the configured issuer, audience and lifetime, and a new jti every time', async () => {
    const keys = await buildSigningKeys({ privateKeyPem: ed25519Pem().privatePem });
    const issuer = createAccessTokenIssuer({ keys, clock: createTestClock(), issuer: 'https://auth.acme.test', audience: 'acme', ttlSeconds: 300 });
    const first = await issuer.issue(credential);
    const second = await issuer.issue(credential);
    const claims = (token: string) => JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as Record<string, unknown>;

    expect(claims(first.accessToken)).toMatchObject({ iss: 'https://auth.acme.test', aud: 'acme' });
    expect((claims(first.accessToken)['exp'] as number) - (claims(first.accessToken)['iat'] as number)).toBe(300);
    expect(claims(first.accessToken)['jti']).not.toBe(claims(second.accessToken)['jti']);
  });

  it('is rejected once expired (exp from the Clock)', async () => {
    const keys = await buildSigningKeys({ privateKeyPem: ed25519Pem().privatePem });
    const clock = createTestClock();
    const { accessToken } = await createAccessTokenIssuer({ keys, clock }).issue(credential);
    clock.advance(901 * 1000);

    await expect(
      jwtVerify(accessToken, createLocalJWKSet({ keys: [...keys.publicJwks] }), { currentDate: clock.now(), algorithms: ['EdDSA'] }),
    ).rejects.toThrow(/exp/);
  });

  it.each([59, 3601, 1.5])('rejects a lifetime of %s seconds', async (ttlSeconds) => {
    const keys = await buildSigningKeys({ privateKeyPem: ed25519Pem().privatePem });

    expect(() => createAccessTokenIssuer({ keys, clock: createTestClock(), ttlSeconds })).toThrow(RangeError);
  });
});
