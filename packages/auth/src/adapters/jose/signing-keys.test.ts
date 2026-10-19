import { generateKeyPairSync } from 'node:crypto';
import { assertNoSecretsLeaked, ed25519KeyPairPem as ed25519Pem } from '#test-support';
import { describe, expect, it } from 'vitest';
import { buildSigningKeys, SigningKeyConfigError } from './signing-keys.js';

async function errorOf(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected an error');
}

describe('buildSigningKeys (AC 3, AC 4)', () => {
  it('publishes the current public key with an RFC 7638 thumbprint as kid, and never the private part', async () => {
    const { privatePem } = ed25519Pem();
    const keys = await buildSigningKeys({ privateKeyPem: privatePem });

    expect(keys.publicJwks).toHaveLength(1);
    expect(keys.publicJwks[0]).toEqual({
      kty: 'OKP',
      crv: 'Ed25519',
      x: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      kid: keys.current.kid,
      alg: 'EdDSA',
      use: 'sig',
    });
    expect(keys.current.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(keys.publicJwks[0]).not.toHaveProperty('d');
    assertNoSecretsLeaked(JSON.stringify(keys.publicJwks), { privateKey: privatePem.split('\n')[1] ?? privatePem });
  });

  it('gives the same kid for the same key (stable, no configuration)', async () => {
    const { privatePem } = ed25519Pem();

    expect((await buildSigningKeys({ privateKeyPem: privatePem })).current.kid).toBe((await buildSigningKeys({ privateKeyPem: privatePem })).current.kid);
  });

  it('publishes previous public keys after the current one, without duplicates (rotation)', async () => {
    const current = ed25519Pem();
    const previous = ed25519Pem();
    const keys = await buildSigningKeys({ privateKeyPem: current.privatePem, previousPublicKeyPems: [previous.publicPem, previous.publicPem, current.publicPem] });

    expect(keys.publicJwks.map((jwk) => jwk.kid)).toHaveLength(2);
    expect(keys.publicJwks[0]?.kid).toBe(keys.current.kid);
  });

  it.each([
    ['missing', () => ''],
    ['not PEM', () => 'not a key'],
    ['a public key instead of the private one', () => ed25519Pem().publicPem],
    ['an RSA key', () => generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()],
    ['an EC key', () => generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()],
    ['a truncated PEM', () => ed25519Pem().privatePem.slice(0, 60)],
  ])('refuses a signing key that is %s, without echoing it', async (_label, pem) => {
    const value = pem();
    const error = await errorOf(() => buildSigningKeys({ privateKeyPem: value }));

    expect(error).toBeInstanceOf(SigningKeyConfigError);
    const body = value.split('\n').find((line) => line.length > 20 && !line.startsWith('-----'));
    if (body) assertNoSecretsLeaked(`${error.message} ${error.stack ?? ''}`, { key: body });
  });

  it.each([
    ['a private key', () => ed25519Pem().privatePem],
    ['an RSA public key', () => generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'pem', type: 'spki' }).toString()],
    ['garbage', () => '-----BEGIN PUBLIC KEY-----\nnope\n-----END PUBLIC KEY-----'],
  ])('refuses a previous public key that is %s', async (_label, pem) => {
    const error = await errorOf(() => buildSigningKeys({ privateKeyPem: ed25519Pem().privatePem, previousPublicKeyPems: [pem()] }));

    expect(error).toBeInstanceOf(SigningKeyConfigError);
    expect(error.message).toContain('#1');
  });
});
