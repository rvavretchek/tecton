import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestClock, createTestSigningKey, jwksTls, tokenFactory, type JwksTlsServer } from '#test-support';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createTokenVerifier,
  InvalidTokenError,
  JWKS_REFETCH_COOLDOWN_MS,
  TokenVerificationUnavailableError,
  TokenVerifierConfigError,
  tokenVerifierFromEnv,
  type TokenVerifierOptions,
} from './token-verifier.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const key = createTestSigningKey();
const tokens = tokenFactory(key, { now: NOW });
let jwks: JwksTlsServer;

beforeAll(async () => {
  jwks = await jwksTls({ keys: [key.publicJwk], slowMs: 1_500 });
}, 60_000);

afterAll(async () => {
  await jwks?.stop();
});

function verifier(options: Partial<TokenVerifierOptions> = {}) {
  return createTokenVerifier({ jwksUrl: jwks.url, ca: jwks.ca, clock: createTestClock(NOW), ...options });
}

const bearer = (token: string) => `Bearer ${token}`;

describe('createTokenVerifier (Story 2.4, AC 2)', () => {
  it('accepts a valid token and returns the principal from its claims', async () => {
    const token = tokens.valid({ sub: 'user-a', perms: ['finance:close'], jti: 'jti-1' });

    expect(await verifier().verify(bearer(token))).toEqual({
      subject: 'user-a',
      permissions: ['finance:close'],
      tokenId: 'jti-1',
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 900_000),
    });
  });

  it('accepts the scheme in any case', async () => {
    await expect(verifier().verify(`bearer ${tokens.valid()}`)).resolves.toMatchObject({ subject: expect.any(String) });
  });

  it.each(Object.entries(tokens.forged()))('refuses a forged token: %s (P0-011, R-02)', async (_label, token) => {
    await expect(verifier().verify(bearer(token))).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it.each([
    ['no header', undefined],
    ['an empty header', ''],
    ['another scheme', `Basic ${Buffer.from('a:b').toString('base64')}`],
    ['two spaces', `Bearer  ${'a'.repeat(10)}`],
    ['no token', 'Bearer '],
    ['garbage', 'Bearer not.a.jwt'],
    ['an oversized token', `Bearer ${'a'.repeat(9000)}`],
  ])('refuses %s with the same error and message', async (_label, header) => {
    const error = await verifier().verify(header).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidTokenError);
    expect((error as Error).message).toBe('invalid token');
  });

  it('checks exp against the injected clock', async () => {
    const token = tokens.valid();

    await expect(verifier({ clock: createTestClock(new Date(NOW.getTime() + 899_000)) }).verify(bearer(token))).resolves.toBeDefined();
    await expect(verifier({ clock: createTestClock(new Date(NOW.getTime() + 901_000)) }).verify(bearer(token))).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('checks the configured issuer and audience', async () => {
    const token = tokens.valid({ iss: 'https://auth.acme.test', aud: 'acme' });

    await expect(verifier().verify(bearer(token))).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(verifier({ issuer: 'https://auth.acme.test', audience: 'acme' }).verify(bearer(token))).resolves.toBeDefined();
  });
});

describe('JWKS fetching (Story 2.4, AC 3, AC 4)', () => {
  // The cooldown of jose runs on Date.now: the system clock is moved, the token clock is not.
  const afterCooldown = () => vi.setSystemTime(Date.now() + JWKS_REFETCH_COOLDOWN_MS + 1_000);

  it('refetches once for an unknown kid past the cooldown, then refuses; a burst fetches no more (P0-012)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const v = verifier();
      await v.verify(bearer(tokens.valid()));
      const unknown = tokenFactory(createTestSigningKey('kid-unknown'), { now: NOW });

      // Right after a fetch: no refetch at all.
      const before = jwks.requests();
      await expect(v.verify(bearer(unknown.valid()))).rejects.toBeInstanceOf(InvalidTokenError);
      expect(jwks.requests()).toBe(before);

      afterCooldown();
      await Promise.all(Array.from({ length: 10 }, () => v.verify(bearer(unknown.valid())).catch(() => undefined)));
      expect(jwks.requests()).toBe(before + 1);
      await expect(v.verify(bearer(unknown.valid()))).rejects.toBeInstanceOf(InvalidTokenError);
      expect(jwks.requests()).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('finds a key published after the cache was filled (rotation) through that one refetch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const next = createTestSigningKey();
    try {
      const v = verifier();
      await v.verify(bearer(tokens.valid()));
      jwks.setKeys([key.publicJwk, next.publicJwk]);
      afterCooldown();
      await expect(v.verify(bearer(tokenFactory(next, { now: NOW }).valid()))).resolves.toBeDefined();
    } finally {
      vi.useRealTimers();
      jwks.setKeys([key.publicJwk]);
    }
  });

  it.each(['redirect', 'error', 'invalid-json', 'html', 'huge'] as const)(
    'fails closed when the JWKS answers %s and nothing is cached (P0-014)',
    async (mode) => {
      jwks.setMode(mode);
      try {
        await expect(verifier().verify(bearer(tokens.valid()))).rejects.toBeInstanceOf(TokenVerificationUnavailableError);
      } finally {
        jwks.setMode('ok');
      }
    },
  );

  it('fails closed when the JWKS is slower than the time limit', async () => {
    jwks.setMode('slow');
    try {
      await expect(verifier({ jwksTimeoutMs: 300 }).verify(bearer(tokens.valid()))).rejects.toBeInstanceOf(TokenVerificationUnavailableError);
    } finally {
      jwks.setMode('ok');
    }
  });

  it('fails closed when the Auth service is unreachable (P0-014)', async () => {
    const v = createTokenVerifier({ jwksUrl: 'https://127.0.0.1:1/auth/.well-known/jwks.json', clock: createTestClock(NOW) });

    await expect(v.verify(bearer(tokens.valid()))).rejects.toBeInstanceOf(TokenVerificationUnavailableError);
  });

  it('does not trust the test CA without the ca option (the CA is never process-wide)', async () => {
    await expect(createTokenVerifier({ jwksUrl: jwks.url, clock: createTestClock(NOW) }).verify(bearer(tokens.valid()))).rejects.toBeInstanceOf(
      TokenVerificationUnavailableError,
    );
  });
});

describe('JWKS URL transport (Story 2.4, AC 9)', () => {
  it('refuses http outside development mode, at creation', () => {
    expect(() => createTokenVerifier({ jwksUrl: 'http://auth.internal/auth/.well-known/jwks.json' })).toThrow(TokenVerifierConfigError);
    expect(() => createTokenVerifier({ jwksUrl: 'http://auth.internal/auth/.well-known/jwks.json', devMode: true })).not.toThrow();
  });

  it.each(['ftp://auth.internal/jwks.json', 'file:///etc/jwks.json', 'not a url'])('refuses %s in every mode', (jwksUrl) => {
    expect(() => createTokenVerifier({ jwksUrl, devMode: true })).toThrow(TokenVerifierConfigError);
  });

  it('never echoes the URL, which may carry credentials', () => {
    const error = (() => {
      try {
        createTokenVerifier({ jwksUrl: 'http://user:s3cret-pass@auth.internal/jwks.json' });
      } catch (caught) {
        return caught as Error;
      }
      return undefined;
    })();

    expect(error?.message).not.toContain('s3cret-pass');
  });

  it('refuses an empty or padded issuer or audience', () => {
    expect(() => createTokenVerifier({ jwksUrl: jwks.url, issuer: ' ' })).toThrow(TokenVerifierConfigError);
    expect(() => createTokenVerifier({ jwksUrl: jwks.url, audience: ' acme' })).toThrow(TokenVerifierConfigError);
  });
});

describe('tokenVerifierFromEnv (Story 2.4)', () => {
  it('requires TECTON_JWKS_URL, naming it', () => {
    expect(() => tokenVerifierFromEnv({})).toThrow(/^TECTON_JWKS_URL is not set/);
  });

  it('allows http only with TECTON_ENV=development, exactly', () => {
    const http = 'http://127.0.0.1:3000/auth/.well-known/jwks.json';

    expect(() => tokenVerifierFromEnv({ TECTON_JWKS_URL: http, TECTON_ENV: 'development' })).not.toThrow();
    for (const env of [undefined, 'production', 'dev', 'Development', 'test']) {
      expect(() => tokenVerifierFromEnv({ TECTON_JWKS_URL: http, ...(env === undefined ? {} : { TECTON_ENV: env }) })).toThrow(TokenVerifierConfigError);
    }
  });

  it('reads the CA from TECTON_JWKS_CA_FILE and the issuer and audience with their defaults', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tecton-ca-'));
    try {
      writeFileSync(join(dir, 'ca.pem'), jwks.ca);
      const v = tokenVerifierFromEnv({ TECTON_JWKS_URL: jwks.url, TECTON_JWKS_CA_FILE: join(dir, 'ca.pem') });
      await expect(v.verify(bearer(tokenFactory(key).valid()))).resolves.toBeDefined();
      expect(() => tokenVerifierFromEnv({ TECTON_JWKS_URL: jwks.url, TECTON_JWKS_CA_FILE: join(dir, 'missing.pem') })).toThrow(
        /^TECTON_JWKS_CA_FILE could not be read$/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
