import { assertNoSecretsLeaked, ed25519KeyPairPem } from '#test-support';
import { describe, expect, it } from 'vitest';
import { SigningKeyConfigError } from '../jose/signing-keys.js';
import { AuthConfigError, listenSettingsFromEnv, signingKeysFromEnv, tokenSettingsFromEnv } from './config-from-env.js';

describe('signingKeysFromEnv (AC 4)', () => {
  it('fails clearly when TECTON_AUTH_SIGNING_KEY is missing', async () => {
    await expect(signingKeysFromEnv({})).rejects.toThrow(/TECTON_AUTH_SIGNING_KEY is not set/);
  });

  it('accepts a PEM pasted on one line with literal \\n sequences', async () => {
    const { privatePem } = ed25519KeyPairPem();
    const oneLine = privatePem.trimEnd().split('\n').join('\\n');

    await expect(signingKeysFromEnv({ TECTON_AUTH_SIGNING_KEY: oneLine })).resolves.toMatchObject({ publicJwks: [expect.anything()] });
  });

  it('reads several previous public keys from one variable', async () => {
    const current = ed25519KeyPairPem();
    const previous = [ed25519KeyPairPem(), ed25519KeyPairPem()];
    const keys = await signingKeysFromEnv({
      TECTON_AUTH_SIGNING_KEY: current.privatePem,
      TECTON_AUTH_PREVIOUS_PUBLIC_KEYS: previous.map((pair) => pair.publicPem).join('\n'),
    });

    expect(keys.publicJwks).toHaveLength(3);
  });

  it('refuses previous keys without any PEM block, without echoing the value', async () => {
    const error = await signingKeysFromEnv({
      TECTON_AUTH_SIGNING_KEY: ed25519KeyPairPem().privatePem,
      TECTON_AUTH_PREVIOUS_PUBLIC_KEYS: 'not-a-public-key-value',
    }).catch((caught: unknown) => caught as Error);

    expect(error).toBeInstanceOf(SigningKeyConfigError);
    assertNoSecretsLeaked((error as Error).message, { value: 'not-a-public-key-value' });
  });
});

describe('tokenSettingsFromEnv and listenSettingsFromEnv', () => {
  it('defaults to urn:tecton:auth, urn:tecton:api and 15 minutes', () => {
    expect(tokenSettingsFromEnv({})).toEqual({ issuer: 'urn:tecton:auth', audience: 'urn:tecton:api', ttlSeconds: 900 });
  });

  it('reads configured values', () => {
    expect(
      tokenSettingsFromEnv({ TECTON_AUTH_ISSUER: 'https://auth.acme.test', TECTON_AUTH_AUDIENCE: 'acme', TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS: '600' }),
    ).toEqual({ issuer: 'https://auth.acme.test', audience: 'acme', ttlSeconds: 600 });
  });

  it.each(['59', '3601', 'abc', '1.5'])('rejects a lifetime of %s', (ttl) => {
    expect(() => tokenSettingsFromEnv({ TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS: ttl })).toThrow(AuthConfigError);
  });

  it('listens on loopback port 3000 by default and validates PORT', () => {
    expect(listenSettingsFromEnv({})).toEqual({ port: 3000, host: '127.0.0.1' });
    expect(listenSettingsFromEnv({ PORT: '0', HOST: '0.0.0.0' })).toEqual({ port: 0, host: '0.0.0.0' });
    expect(() => listenSettingsFromEnv({ PORT: 'abc' })).toThrow(AuthConfigError);
  });
});
