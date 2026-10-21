import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryTokenRevocationStore, createTestClock, createTestSigningKey, jwksTls, tokenFactory, type JwksTlsServer } from '#test-support';
import { RevocationStoreUnavailableError } from '@tecton/providers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CLOCK_TOLERANCE_SECONDS,
  createTokenVerifier,
  InvalidTokenError,
  JWKS_FAILURE_BACKOFF_MS,
  JWKS_REFETCH_COOLDOWN_MS,
  TokenVerificationUnavailableError,
  TokenVerifierConfigError,
  tokenVerifierFromEnv,
  type TokenVerifierOptions,
} from './token-verifier.js';

const revocations = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('revocation store unavailable: down'));
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
  return createTokenVerifier({ revocations, jwksUrl: jwks.url, ca: jwks.ca, clock: createTestClock(NOW), ...options });
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

  it('checks exp against the injected clock, with the clock tolerance', async () => {
    const token = tokens.valid();
    const at = (ms: number) => verifier({ clock: createTestClock(new Date(NOW.getTime() + ms)) }).verify(bearer(token));

    await expect(at(899_000)).resolves.toBeDefined();
    await expect(at((900 + CLOCK_TOLERANCE_SECONDS - 1) * 1000)).resolves.toBeDefined();
    await expect(at((900 + CLOCK_TOLERANCE_SECONDS + 1) * 1000)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('refuses a token issued in the future beyond the tolerance (review P12)', async () => {
    const iat = Math.floor(NOW.getTime() / 1000);
    const future = (seconds: number) => tokens.valid({ iat: iat + seconds, exp: iat + seconds + 900 });

    await expect(verifier().verify(bearer(future(CLOCK_TOLERANCE_SECONDS - 1)))).resolves.toBeDefined();
    await expect(verifier().verify(bearer(future(CLOCK_TOLERANCE_SECONDS + 5)))).rejects.toBeInstanceOf(InvalidTokenError);
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
    const v = createTokenVerifier({ revocations, jwksUrl: 'https://127.0.0.1:1/auth/.well-known/jwks.json', clock: createTestClock(NOW) });

    await expect(v.verify(bearer(tokens.valid()))).rejects.toBeInstanceOf(TokenVerificationUnavailableError);
  });

  it('does not trust the test CA without the ca option (the CA is never process-wide)', async () => {
    await expect(createTokenVerifier({ revocations, jwksUrl: jwks.url, clock: createTestClock(NOW) }).verify(bearer(tokens.valid()))).rejects.toBeInstanceOf(
      TokenVerificationUnavailableError,
    );
  });
});

describe('JWKS URL transport (Story 2.4, AC 9)', () => {
  it('refuses http outside development mode, at creation', () => {
    expect(() => createTokenVerifier({ revocations, jwksUrl: 'http://auth.internal/auth/.well-known/jwks.json' })).toThrow(TokenVerifierConfigError);
    expect(() => createTokenVerifier({ revocations, jwksUrl: 'http://auth.internal/auth/.well-known/jwks.json', devMode: true })).not.toThrow();
  });

  it.each(['ftp://auth.internal/jwks.json', 'file:///etc/jwks.json', 'not a url'])('refuses %s in every mode', (jwksUrl) => {
    expect(() => createTokenVerifier({ revocations, jwksUrl, devMode: true })).toThrow(TokenVerifierConfigError);
  });

  it('never echoes the URL, which may carry credentials', () => {
    const error = (() => {
      try {
        createTokenVerifier({ revocations, jwksUrl: 'http://user:s3cret-pass@auth.internal/jwks.json' });
      } catch (caught) {
        return caught as Error;
      }
      return undefined;
    })();

    expect(error?.message).not.toContain('s3cret-pass');
  });

  it('refuses an empty or padded issuer or audience', () => {
    expect(() => createTokenVerifier({ revocations, jwksUrl: jwks.url, issuer: ' ' })).toThrow(TokenVerifierConfigError);
    expect(() => createTokenVerifier({ revocations, jwksUrl: jwks.url, audience: ' acme' })).toThrow(TokenVerifierConfigError);
  });
});

/** A Valkey URL nothing listens on: the store starts, and every check fails closed. */
const NO_VALKEY = { TECTON_VALKEY_URL: 'redis://127.0.0.1:1', TECTON_REVOCATION_TIMEOUT_MS: '200' };

describe('tokenVerifierFromEnv (Story 2.4)', () => {
  it('requires TECTON_JWKS_URL, naming it', () => {
    expect(() => tokenVerifierFromEnv({})).toThrow(/^TECTON_JWKS_URL is not set/);
  });

  it('allows http only with TECTON_ENV=development, exactly', () => {
    const http = 'http://127.0.0.1:3000/auth/.well-known/jwks.json';

    const v = tokenVerifierFromEnv({ TECTON_JWKS_URL: http, TECTON_ENV: 'development', ...NO_VALKEY });
    void v.close?.();
    for (const env of [undefined, 'production', 'dev', 'Development', 'test']) {
      expect(() => tokenVerifierFromEnv({ TECTON_JWKS_URL: http, ...(env === undefined ? {} : { TECTON_ENV: env }) })).toThrow(TokenVerifierConfigError);
    }
  });

  it('reads the CA from TECTON_JWKS_CA_FILE and the issuer and audience with their defaults', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tecton-ca-'));
    try {
      writeFileSync(join(dir, 'ca.pem'), jwks.ca);
      const v = tokenVerifierFromEnv({ TECTON_JWKS_URL: jwks.url, TECTON_JWKS_CA_FILE: join(dir, 'ca.pem'), ...NO_VALKEY });
      // The JWKS was fetched through the CA: the check fails only later, at revocation (no Valkey here).
      await expect(v.verify(bearer(tokenFactory(key).valid()))).rejects.toThrow(/revocation could not be checked/);
      await v.close?.();
      expect(() => tokenVerifierFromEnv({ TECTON_JWKS_URL: jwks.url, TECTON_JWKS_CA_FILE: join(dir, 'missing.pem'), ...NO_VALKEY })).toThrow(
        /^TECTON_JWKS_CA_FILE could not be read$/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('JWKS cache and failures (Story 2.4 review)', () => {
  it('never follows a redirect, even to a server that would hand out a key (P3)', async () => {
    const attacker = createTestSigningKey(key.kid);
    const evil = await jwksTls({ keys: [attacker.publicJwk] });
    jwks.setRedirect(evil.url);
    jwks.setMode('redirect');
    try {
      const forged = tokenFactory(attacker, { now: NOW }).valid({ perms: ['finance:close'] });
      await expect(verifier({ ca: `${jwks.ca}\n${evil.ca}` }).verify(bearer(forged))).rejects.toBeInstanceOf(TokenVerificationUnavailableError);
      expect(evil.requests()).toBe(0);
    } finally {
      jwks.setMode('ok');
      await evil.stop();
    }
  });

  it('after a failed fetch, fails fast without fetching again until the backoff passes (P2)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    jwks.setMode('error');
    try {
      const v = verifier();
      const before = jwks.requests();
      for (let i = 0; i < 5; i += 1) await expect(v.verify(bearer(tokens.valid()))).rejects.toBeInstanceOf(TokenVerificationUnavailableError);
      expect(jwks.requests()).toBe(before + 1);

      jwks.setMode('ok');
      await expect(v.verify(bearer(tokens.valid()))).rejects.toBeInstanceOf(TokenVerificationUnavailableError);
      vi.setSystemTime(Date.now() + JWKS_FAILURE_BACKOFF_MS + 100);
      await expect(v.verify(bearer(tokens.valid()))).resolves.toBeDefined();
      expect(jwks.requests()).toBe(before + 2);
    } finally {
      jwks.setMode('ok');
      vi.useRealTimers();
    }
  });

  it('stops using expired keys while the Auth service is down: 503, never the old keys (P6)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const v = verifier();
      await expect(v.verify(bearer(tokens.valid()))).resolves.toBeDefined();
      jwks.setMode('error');
      vi.setSystemTime(Date.now() + 4 * 60_000);
      await expect(v.verify(bearer(tokens.valid()))).resolves.toBeDefined();
      vi.setSystemTime(Date.now() + 2 * 60_000);
      await expect(v.verify(bearer(tokens.valid()))).rejects.toBeInstanceOf(TokenVerificationUnavailableError);
    } finally {
      jwks.setMode('ok');
      vi.useRealTimers();
    }
  });

  it('treats a JWKS with a duplicated kid as unavailable, not as bad tokens (P5)', async () => {
    jwks.setKeys([key.publicJwk, { ...createTestSigningKey(key.kid).publicJwk }]);
    try {
      await expect(verifier().verify(bearer(tokens.valid()))).rejects.toBeInstanceOf(TokenVerificationUnavailableError);
    } finally {
      jwks.setKeys([key.publicJwk]);
    }
  });

  it('fails closed when the connection drops in the middle of the body (P10)', async () => {
    jwks.setMode('truncated');
    try {
      await expect(verifier().verify(bearer(tokens.valid()))).rejects.toBeInstanceOf(TokenVerificationUnavailableError);
    } finally {
      jwks.setMode('ok');
    }
  });

  it('says why, without the URL or the token (P7)', async () => {
    jwks.setMode('redirect');
    try {
      const error = await verifier()
        .verify(bearer(tokens.valid()))
        .then(
          () => undefined,
          (caught: unknown) => caught as Error,
        );
      expect(error?.message).toMatch(/redirect \(302\) refused/);
      expect(error?.message).not.toContain('127.0.0.1');
    } finally {
      jwks.setMode('ok');
    }
  });
});

describe('verifier settings (Story 2.4 review)', () => {
  it.each(['', 'not a certificate', '-----BEGIN CERTIFICATE-----\nbroken\n-----END CERTIFICATE-----\n'])(
    'refuses an unusable CA at creation: %j (P8)',
    (ca) => {
      expect(() => verifier({ ca })).toThrow(TokenVerifierConfigError);
    },
  );

  it.each([0, -1, 1.5, 120_000])('refuses jwksTimeoutMs %s (P9)', (jwksTimeoutMs) => {
    expect(() => verifier({ jwksTimeoutMs })).toThrow(TokenVerifierConfigError);
  });

  it('names the variable when the environment holds a bad value (P14)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tecton-ca-'));
    try {
      writeFileSync(join(dir, 'empty.pem'), '');
      expect(() => tokenVerifierFromEnv({ TECTON_JWKS_URL: 'http://auth.internal/jwks.json' })).toThrow(/^TECTON_JWKS_URL: /);
      expect(() => tokenVerifierFromEnv({ TECTON_JWKS_URL: 'not a url' })).toThrow(/^TECTON_JWKS_URL: /);
      expect(() => tokenVerifierFromEnv({ TECTON_JWKS_URL: jwks.url, TECTON_JWKS_CA_FILE: join(dir, 'empty.pem'), ...NO_VALKEY })).toThrow(/^TECTON_JWKS_CA_FILE: /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('revocation (Story 2.5, AC 2 to 4)', () => {
  it('refuses a token revoked by jti, and only that one', async () => {
    const store = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('down'));
    const v = verifier({ revocations: store });
    const revoked = tokens.valid({ jti: 'revoked-jti' });
    await store.revokeToken({ tokenId: 'revoked-jti', expiresAt: new Date(NOW.getTime() + 900_000) });

    await expect(v.verify(bearer(revoked))).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(v.verify(bearer(tokens.valid({ jti: 'other-jti' })))).resolves.toBeDefined();
  });

  it('refuses tokens of a revoked subject issued at or before the instant, and accepts later ones', async () => {
    const store = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('down'));
    const v = verifier({ revocations: store });
    const iat = Math.floor(NOW.getTime() / 1000);
    await store.revokeSubject({ subject: 'user-a', at: NOW });

    await expect(v.verify(bearer(tokens.valid({ sub: 'user-a', iat: iat - 60, exp: iat + 840 })))).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(v.verify(bearer(tokens.valid({ sub: 'user-a', iat })))).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(v.verify(bearer(tokens.valid({ sub: 'user-a', iat: iat + 1, exp: iat + 901 })))).resolves.toBeDefined();
    await expect(v.verify(bearer(tokens.valid({ sub: 'user-b', iat })))).resolves.toBeDefined();
  });

  it('fails closed when the store cannot answer: unavailable, never "not revoked"', async () => {
    const store = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('revocation store unavailable: timeout'));
    store.setUnavailable(true);

    const error = await verifier({ revocations: store })
      .verify(bearer(tokens.valid()))
      .then(
        () => undefined,
        (caught: unknown) => caught as Error,
      );
    expect(error).toBeInstanceOf(TokenVerificationUnavailableError);
    expect(error?.message).toMatch(/revocation could not be checked/);
  });

  it('checks revocation only for a token that is otherwise valid', async () => {
    const store = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('down'));
    const isRevoked = vi.spyOn(store, 'isRevoked');

    await expect(verifier({ revocations: store }).verify(bearer(tokens.forged()['tampered payload'] as string))).rejects.toBeInstanceOf(InvalidTokenError);
    expect(isRevoked).not.toHaveBeenCalled();
  });

  it('requires a revocation store (AC 7)', () => {
    expect(() => createTokenVerifier({ jwksUrl: jwks.url } as TokenVerifierOptions)).toThrow(TokenVerifierConfigError);
  });

  it('requires TECTON_VALKEY_URL in the environment, naming it (AC 7)', () => {
    expect(() => tokenVerifierFromEnv({ TECTON_JWKS_URL: jwks.url })).toThrow(/^TECTON_VALKEY_URL is not set/);
  });
});
