import { createTestClock } from '#test-support';
import { describe, expect, it, vi } from 'vitest';
import type { AccessTokenIssuer } from './access-token.js';
import { InvalidCredentialError, type Credential } from './credential.js';
import type { CredentialStore } from './credential-store.js';
import { createMemoryRefreshTokenStore } from './memory-refresh-token-store.test-helper.js';
import { generateRefreshToken, hashRefreshToken, isWellFormedRefreshToken } from './refresh-token.js';
import {
  assertRefreshTokenTtl,
  endSession,
  InvalidRefreshTokenError,
  MAX_LOGOUT_TOKENS,
  openSession,
  REFRESH_TOKEN_TTL,
  refreshSession,
  type SessionDependencies,
} from './session.js';

const WEEK = 7 * 24 * 3600;

function credentialOf(overrides: Partial<Credential> = {}): Credential {
  return {
    id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
    login: 'alice',
    passwordHash: 'not-used-here',
    status: 'active',
    permissions: ['tenant:create'],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function setup() {
  const clock = createTestClock();
  const memory = createMemoryRefreshTokenStore();
  let current: Credential | undefined = credentialOf();
  let corrupt = false;
  const credentials: CredentialStore = {
    count: async () => 1,
    findByLogin: async () => current,
    findById: async (id) => {
      if (corrupt) throw new InvalidCredentialError('corrupt row');
      return current && current.id === id ? current : undefined;
    },
    create: async () => undefined,
    createIfEmpty: async () => false,
    updatePasswordHash: async () => true,
    close: async () => undefined,
  };
  const issuer: AccessTokenIssuer = {
    issue: async (credential) => ({ accessToken: `token:${credential.permissions.join(',')}`, tokenType: 'Bearer', expiresIn: 900 }),
  };
  const onReuseDetected = vi.fn();
  const onCorruptCredential = vi.fn();
  const deps: SessionDependencies = {
    refreshTokens: memory.store,
    credentials,
    issuer,
    clock,
    refreshTtlSeconds: WEEK,
    onReuseDetected,
    onCorruptCredential,
  };
  return {
    deps,
    clock,
    memory,
    onReuseDetected,
    onCorruptCredential,
    setCredential: (value: Credential | undefined) => void (current = value),
    corruptCredential: () => void (corrupt = true),
  };
}

const refuse = (promise: Promise<unknown>) => expect(promise).rejects.toBeInstanceOf(InvalidRefreshTokenError);

describe('refresh tokens (Story 2.3, AC 1)', () => {
  it('generates 256 random bits as 43 base64url characters, and stores only their SHA-256', () => {
    const token = generateRefreshToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateRefreshToken()).not.toBe(token);
    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(isWellFormedRefreshToken(token)).toBe(true);
    for (const bad of [undefined, '', `${token}x`, token.slice(1), `${token.slice(1)}=`, `${token.slice(1)}.`]) {
      expect(isWellFormedRefreshToken(bad)).toBe(false);
    }
  });

  it('accepts the default and limits of the family lifetime and refuses anything else', () => {
    expect(REFRESH_TOKEN_TTL).toEqual({ default: WEEK, min: 3600, max: 90 * 24 * 3600 });
    for (const ok of [REFRESH_TOKEN_TTL.min, REFRESH_TOKEN_TTL.default, REFRESH_TOKEN_TTL.max]) expect(() => assertRefreshTokenTtl(ok)).not.toThrow();
    for (const bad of [REFRESH_TOKEN_TTL.min - 1, REFRESH_TOKEN_TTL.max + 1, 3600.5, Number.NaN]) expect(() => assertRefreshTokenTtl(bad)).toThrow(RangeError);
  });
});

describe('session rotation (Story 2.3, AC 2 to 5)', () => {
  it('opens a family that expires a fixed time after the login', async () => {
    const { deps, clock, memory } = setup();

    const session = await openSession(deps, credentialOf());

    expect(session.expiresAt.getTime()).toBe(clock.now().getTime() + WEEK * 1000);
    expect(memory.families()).toEqual([expect.objectContaining({ credentialId: credentialOf().id, expiresAt: session.expiresAt })]);
    expect(memory.tokens()).toEqual([expect.objectContaining({ tokenHash: hashRefreshToken(session.refreshToken) })]);
    expect(JSON.stringify(memory.tokens())).not.toContain(session.refreshToken);
  });

  it('rotates: a new token, the old one marked used, permissions read from the credential now', async () => {
    const { deps, memory, setCredential } = setup();
    const first = await openSession(deps, credentialOf());
    setCredential(credentialOf({ permissions: ['tenant:create', 'tenant:delete'] }));

    const rotated = await refreshSession(deps, first.refreshToken);

    expect(rotated.refresh.refreshToken).not.toBe(first.refreshToken);
    expect(rotated.access.accessToken).toBe('token:tenant:create,tenant:delete');
    expect(memory.tokens().find((token) => token.tokenHash === hashRefreshToken(first.refreshToken))?.usedAt).toBeInstanceOf(Date);
    expect(await refreshSession(deps, rotated.refresh.refreshToken)).toMatchObject({ access: { tokenType: 'Bearer' } });
  });

  it('never extends the family: every rotated token expires with it', async () => {
    const { deps, clock } = setup();
    const first = await openSession(deps, credentialOf());

    clock.advance((WEEK - 60) * 1000);
    const rotated = await refreshSession(deps, first.refreshToken);
    expect(rotated.refresh.expiresAt).toEqual(first.expiresAt);

    clock.advance(60 * 1000);
    await refuse(refreshSession(deps, rotated.refresh.refreshToken));
  });

  it('on reuse, revokes the whole family (the newest token too) and reports it once', async () => {
    const { deps, memory, onReuseDetected } = setup();
    const first = await openSession(deps, credentialOf());
    const rotated = await refreshSession(deps, first.refreshToken);

    await refuse(refreshSession(deps, first.refreshToken));

    const [family] = memory.families();
    expect(family).toMatchObject({ revokedReason: 'reuse', revokedAt: expect.any(Date) });
    expect(onReuseDetected).toHaveBeenCalledTimes(1);
    expect(onReuseDetected).toHaveBeenCalledWith({ familyId: family?.id, subject: credentialOf().id });
    await refuse(refreshSession(deps, rotated.refresh.refreshToken));
    expect(onReuseDetected).toHaveBeenCalledTimes(1);
  });

  it('reports a replay of a used token into an already revoked family, without revoking again', async () => {
    const { deps, memory, onReuseDetected } = setup();
    const first = await openSession(deps, credentialOf());
    await refreshSession(deps, first.refreshToken);
    await endSession(deps, first.refreshToken);
    const revokedAt = memory.families()[0]?.revokedAt;

    await refuse(refreshSession(deps, first.refreshToken));

    expect(onReuseDetected).toHaveBeenCalledTimes(1);
    expect(memory.families()[0]).toMatchObject({ revokedReason: 'logout', revokedAt });
  });

  it('refuses an expired token without revoking the family', async () => {
    const { deps, clock, memory } = setup();
    const first = await openSession(deps, credentialOf());

    clock.advance(WEEK * 1000);

    await refuse(refreshSession(deps, first.refreshToken));
    expect(memory.families()[0]?.revokedAt).toBeUndefined();
  });

  it('still reports a used token replayed after the family expired as a reuse (review P6)', async () => {
    const { deps, clock, onReuseDetected } = setup();
    const first = await openSession(deps, credentialOf());
    await refreshSession(deps, first.refreshToken);

    clock.advance(WEEK * 1000);

    await refuse(refreshSession(deps, first.refreshToken));
    expect(onReuseDetected).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['disabled', credentialOf({ status: 'disabled' })],
    ['removed', undefined],
  ] as const)('refuses and revokes the family when the credential is %s', async (_label, value) => {
    const { deps, memory, setCredential } = setup();
    const first = await openSession(deps, credentialOf());
    setCredential(value);

    await refuse(refreshSession(deps, first.refreshToken));
    expect(memory.families()[0]?.revokedReason).toBe('inactive');
  });

  it('refuses a corrupt credential like an inactive one, reporting it', async () => {
    const { deps, memory, onCorruptCredential, corruptCredential } = setup();
    const first = await openSession(deps, credentialOf());
    corruptCredential();

    await refuse(refreshSession(deps, first.refreshToken));
    expect(onCorruptCredential).toHaveBeenCalledWith(expect.any(InvalidCredentialError));
    expect(memory.families()[0]?.revokedReason).toBe('inactive');
  });

  it('keeps the presented token usable when the credential lookup fails mid-rotation (review P1)', async () => {
    const { deps, onReuseDetected, memory } = setup();
    const first = await openSession(deps, credentialOf());
    const findById = deps.credentials.findById;
    deps.credentials.findById = async () => {
      throw new Error('database blip');
    };

    await expect(refreshSession(deps, first.refreshToken)).rejects.toThrow('database blip');
    deps.credentials.findById = findById;

    await expect(refreshSession(deps, first.refreshToken)).resolves.toMatchObject({ access: { tokenType: 'Bearer' } });
    expect(onReuseDetected).not.toHaveBeenCalled();
    expect(memory.families()[0]?.revokedAt).toBeUndefined();
  });

  it('keeps the presented token usable when signing the access token fails (review P1)', async () => {
    const { deps } = setup();
    const first = await openSession(deps, credentialOf());
    const issue = deps.issuer.issue;
    deps.issuer.issue = async () => {
      throw new Error('signing failed');
    };

    await expect(refreshSession(deps, first.refreshToken)).rejects.toThrow('signing failed');
    deps.issuer.issue = issue;

    await expect(refreshSession(deps, first.refreshToken)).resolves.toMatchObject({ access: { tokenType: 'Bearer' } });
  });

  it('refuses unknown and malformed tokens, never querying the store for a malformed one', async () => {
    const { deps } = setup();
    const rotate = vi.spyOn(deps.refreshTokens, 'rotate');

    await refuse(refreshSession(deps, generateRefreshToken()));
    expect(rotate).toHaveBeenCalledTimes(1);
    for (const bad of [undefined, '', 'short', 42]) await refuse(refreshSession(deps, bad));
    expect(rotate).toHaveBeenCalledTimes(1);
  });

  it('gives the same error, with the same message, for every refusal', async () => {
    const { deps } = setup();

    const error = await refreshSession(deps, 'x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidRefreshTokenError);
    expect((error as Error).message).toBe('invalid refresh token');
  });
});

describe('logout (Story 2.3, AC 6)', () => {
  it('revokes the family of the presented token, whatever its state', async () => {
    const { deps, memory } = setup();
    const first = await openSession(deps, credentialOf());
    await refreshSession(deps, first.refreshToken);

    await endSession(deps, first.refreshToken);

    expect(memory.families()[0]).toMatchObject({ revokedReason: 'logout' });
  });

  it('revokes every well-formed token presented, so a planted duplicate cannot hide the real one (review P5)', async () => {
    const { deps, memory } = setup();
    const real = await openSession(deps, credentialOf());

    await endSession(deps, [generateRefreshToken(), 'bad', real.refreshToken]);

    expect(memory.families()[0]).toMatchObject({ revokedReason: 'logout' });
  });

  it('acts on at most MAX_LOGOUT_TOKENS tokens', async () => {
    const { deps } = setup();
    const revoke = vi.spyOn(deps.refreshTokens, 'revokeFamilyOf');

    await endSession(deps, Array.from({ length: MAX_LOGOUT_TOKENS + 3 }, () => generateRefreshToken()));
    expect(revoke).toHaveBeenCalledTimes(MAX_LOGOUT_TOKENS);
  });

  it('refuses an invalid family lifetime when opening a session directly (review P8)', async () => {
    const { deps } = setup();

    await expect(openSession({ ...deps, refreshTtlSeconds: Number.NaN }, credentialOf())).rejects.toThrow(RangeError);
  });

  it('never fails for a missing, malformed, unknown or already revoked token', async () => {
    const { deps } = setup();
    const first = await openSession(deps, credentialOf());
    await endSession(deps, first.refreshToken);

    for (const presented of [undefined, 'short', generateRefreshToken(), first.refreshToken]) {
      await expect(endSession(deps, presented)).resolves.toBeUndefined();
    }
  });
});
