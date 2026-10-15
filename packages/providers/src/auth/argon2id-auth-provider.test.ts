import { argon2, createHmac } from 'node:crypto';
import { inspect, promisify } from 'node:util';
import { assertNoSecretsLeaked } from '#test-support';
import { describe, expect, it } from 'vitest';
import type { AuthProvider } from './auth-provider.js';
import { createArgon2idAuthProvider, MAX_PASSWORD_LENGTH } from './argon2id-auth-provider.js';
import { PepperConfigError, type Pepper } from './pepper.js';

const argon2Async = promisify(argon2);

const PEPPER_1: Pepper = { id: '1', key: Buffer.from('first-pepper-with-at-least-32-bytes!', 'utf8') };
const PEPPER_2: Pepper = { id: '2', key: Buffer.from('second-pepper-with-at-least-32-bytes', 'utf8') };
const PASSWORD = 'correct horse battery staple';

const provider = (options: Partial<Parameters<typeof createArgon2idAuthProvider>[0]> = {}): AuthProvider =>
  createArgon2idAuthProvider({ peppers: [PEPPER_1], currentPepperId: '1', ...options });

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+),keyid=([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;
const b64 = (value: string) => Buffer.from(value, 'base64');
const unpadded = (buffer: Buffer) => buffer.toString('base64').replace(/=+$/, '');

describe('Argon2id AuthProvider: hash (AC 2)', () => {
  it('produces a PHC string with the default parameters and the Pepper id as keyid', async () => {
    const hash = await provider().hashPassword(PASSWORD);
    const match = PHC.exec(hash);

    expect(match, hash).not.toBeNull();
    expect(match?.slice(1, 4)).toEqual(['19456', '2', '1']);
    expect(b64(match?.[4] ?? '').toString('utf8')).toBe('1');
    expect(b64(match?.[5] ?? '')).toHaveLength(16);
    expect(b64(match?.[6] ?? '')).toHaveLength(32);
  });

  it('uses a new salt for every hash', async () => {
    const auth = provider();

    expect(await auth.hashPassword(PASSWORD)).not.toBe(await auth.hashPassword(PASSWORD));
  });

  it('applies HMAC-SHA256 with the Pepper before Argon2id (recomputed by hand from the PHC)', async () => {
    const hash = await provider().hashPassword(PASSWORD);
    const [, m, t, p, , salt, tag] = PHC.exec(hash) ?? [];
    const message = createHmac('sha256', PEPPER_1.key).update(PASSWORD.normalize('NFKC'), 'utf8').digest();
    const expected = await argon2Async('argon2id', {
      message,
      nonce: b64(salt ?? ''),
      memory: Number(m),
      passes: Number(t),
      parallelism: Number(p),
      tagLength: 32,
    });

    expect(unpadded(expected)).toBe(tag);
  });

  it('honours higher configured parameters', async () => {
    const hash = await provider({ params: { memoryKiB: 32768, passes: 3, parallelism: 2 } }).hashPassword(PASSWORD);

    expect(PHC.exec(hash)?.slice(1, 4)).toEqual(['32768', '3', '2']);
  });

  it.each([
    ['memoryKiB', { memoryKiB: 19455 }],
    ['passes', { passes: 1 }],
    ['parallelism', { parallelism: 0 }],
  ])('rejects %s below the floor', (_label, params) => {
    expect(() => provider({ params })).toThrow(RangeError);
  });
});

describe('Argon2id AuthProvider: verification (AC 3)', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const auth = provider();
    const hash = await auth.hashPassword(PASSWORD);

    expect(await auth.verifyPassword(PASSWORD, hash)).toEqual({ valid: true, needsRehash: false });
    expect(await auth.verifyPassword('correct horse battery stapler', hash)).toEqual({ valid: false, needsRehash: false });
  });

  it('rejects a hash made with another Pepper for the same password', async () => {
    const otherPepper: Pepper = { id: '1', key: PEPPER_2.key };
    const hash = await provider({ peppers: [otherPepper] }).hashPassword(PASSWORD);

    expect((await provider().verifyPassword(PASSWORD, hash)).valid).toBe(false);
  });

  it('normalizes with NFKC: the ligature and the two letters verify the same', async () => {
    const auth = provider();
    const ligature = `${String.fromCodePoint(0xfb01)}ve-boxing-wizards`;
    const hash = await auth.hashPassword(ligature);

    expect((await auth.verifyPassword('five-boxing-wizards', hash)).valid).toBe(true);
  });

  it('rejects malformed or foreign hashes without throwing', async () => {
    const auth = provider();
    const good = await auth.hashPassword(PASSWORD);
    const unknownKeyId = good.replace(/keyid=[^$]+/, `keyid=${unpadded(Buffer.from('9'))}`);
    const cases = [
      '',
      'not-a-hash',
      good.slice(0, -5),
      good.replace('$argon2id$', '$argon2i$'),
      good.replace('v=19', 'v=16'),
      unknownKeyId,
      good.replace(/\$([A-Za-z0-9+/]+)$/, '$***'),
      `${good}$extra`,
    ];

    for (const hash of cases) {
      await expect(auth.verifyPassword(PASSWORD, hash), hash).resolves.toEqual({ valid: false, needsRehash: false });
    }
  });

  it('rejects a hash whose memory cost is above the ceiling without running Argon2id', async () => {
    const auth = provider();
    const good = await auth.hashPassword(PASSWORD);
    // Just above the 1 GiB ceiling: a value Argon2id would accept and actually try to allocate.
    const huge = good.replace('m=19456', 'm=1100000');
    const started = Date.now();

    expect(await auth.verifyPassword(PASSWORD, huge)).toEqual({ valid: false, needsRehash: false });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('Argon2id AuthProvider: rehash (AC 4)', () => {
  it.each([
    ['memory', { memoryKiB: 32768 }],
    ['passes', { passes: 3 }],
    ['parallelism', { parallelism: 2 }],
  ])('asks for a rehash when the stored %s is lower than configured', async (_label, params) => {
    const hash = await provider().hashPassword(PASSWORD);

    expect(await provider({ params }).verifyPassword(PASSWORD, hash)).toEqual({ valid: true, needsRehash: true });
  });

  it('keeps verifying hashes of the previous Pepper after a rotation, asking for a rehash', async () => {
    const hash = await provider().hashPassword(PASSWORD);
    const rotated = provider({ peppers: [PEPPER_1, PEPPER_2], currentPepperId: '2' });

    expect(await rotated.verifyPassword(PASSWORD, hash)).toEqual({ valid: true, needsRehash: true });
    expect(await rotated.verifyPassword(PASSWORD, await rotated.hashPassword(PASSWORD))).toEqual({ valid: true, needsRehash: false });
  });

  it('never asks for a rehash when the password is wrong', async () => {
    const hash = await provider().hashPassword(PASSWORD);

    expect(await provider({ params: { passes: 3 } }).verifyPassword('wrong password', hash)).toEqual({ valid: false, needsRehash: false });
  });
});

describe('Argon2id AuthProvider: Pepper configuration (AC 5)', () => {
  it.each([
    ['no Pepper', { peppers: [] }],
    ['a Pepper under 32 bytes', { peppers: [{ id: '1', key: Buffer.alloc(31, 1) }] }],
    ['an unknown current Pepper', { currentPepperId: '7' }],
    ['repeated Pepper ids', { peppers: [PEPPER_1, { ...PEPPER_2, id: '1' }] }],
  ])('fails at construction with %s', (_label, options) => {
    expect(() => provider(options)).toThrow(PepperConfigError);
  });
});

describe('Argon2id AuthProvider: no leaks (AC 6)', () => {
  const secrets = { pepper: PEPPER_1.key.toString('utf8'), password: PASSWORD };

  it('never puts the Pepper or the password in the hash, the result or the provider object', async () => {
    const auth = provider();
    const hash = await auth.hashPassword(PASSWORD);
    const result = await auth.verifyPassword(PASSWORD, hash);

    assertNoSecretsLeaked(hash, secrets);
    assertNoSecretsLeaked(JSON.stringify(result), secrets);
    assertNoSecretsLeaked(inspect(auth, { depth: Infinity, showHidden: true }), secrets);
    assertNoSecretsLeaked(JSON.stringify(auth), secrets);
  });

  it('never puts the Pepper in configuration errors', () => {
    const short = 'short-pepper-value';
    let message = '';
    try {
      provider({ peppers: [{ id: '1', key: Buffer.from(short) }] });
    } catch (error) {
      message = `${(error as Error).message} ${(error as Error).stack ?? ''}`;
    }

    expect(message).not.toBe('');
    assertNoSecretsLeaked(message, { pepper: short });
  });
});

describe('Argon2id AuthProvider: code review fixes (Story 2.1)', () => {
  const tamper = (hash: string, from: RegExp | string, to: string) => hash.replace(from, to);

  /** A valid hash built by hand with chosen salt and tag sizes (the provider always uses 16 and 32). */
  async function handMadeHash(saltBytes: number, tagBytes: number): Promise<string> {
    const salt = Buffer.alloc(saltBytes, 7);
    const message = createHmac('sha256', PEPPER_1.key).update(PASSWORD.normalize('NFKC'), 'utf8').digest();
    // Argon2 itself refuses salts under 8 bytes; those hashes must be refused by the parser
    // before Argon2 runs, so any tag will do.
    const tag =
      saltBytes < 8
        ? Buffer.alloc(tagBytes, 1)
        : await argon2Async('argon2id', { message, nonce: salt, memory: 19456, passes: 2, parallelism: 1, tagLength: tagBytes });
    return `$argon2id$v=19$m=19456,t=2,p=1,keyid=${unpadded(Buffer.from('1'))}$${unpadded(salt)}$${unpadded(tag)}`;
  }

  it('P1: a caller mutating a rejection result never turns later rejections into matches', async () => {
    const auth = provider();
    const first = await auth.verifyPassword(PASSWORD, 'garbage');
    (first as { valid: boolean }).valid = true;

    expect(await auth.verifyPassword(PASSWORD, 'other-garbage')).toEqual({ valid: false, needsRehash: false });
  });

  it('P2: refuses passwords with lone UTF-16 surrogates instead of letting them collide', async () => {
    const auth = provider();
    const lone = (code: number) => `pw${String.fromCodePoint(code)}`;
    const hash = await auth.hashPassword('pw-normal');

    await expect(auth.hashPassword(lone(0xd800))).rejects.toThrow(/well-formed/);
    expect(await auth.verifyPassword(lone(0xdfff), hash)).toEqual({ valid: false, needsRehash: false });
  });

  it.each([
    ['t', 'm=19456,t=2,', 'm=19456,t=9,'],
    ['p', ',p=1,', ',p=5,'],
    ['m', 'm=19456,', 'm=77825,'],
  ])('P3: refuses a stored %s above 4x the configured value', async (_label, from, to) => {
    const auth = provider();
    const hash = tamper(await auth.hashPassword(PASSWORD), from, to);

    expect(await auth.verifyPassword(PASSWORD, hash)).toEqual({ valid: false, needsRehash: false });
  });

  it.each([
    ['a salt under 8 bytes', 7, 32],
    ['a salt over 64 bytes', 65, 32],
    ['a tag under 16 bytes', 16, 15],
    ['a tag over 64 bytes', 16, 65],
  ])('P4: refuses a hash with %s', async (_label, salt, tag) => {
    expect(await provider().verifyPassword(PASSWORD, await handMadeHash(salt, tag))).toEqual({ valid: false, needsRehash: false });
  });

  it.each([
    ['a short salt', 8, 32],
    ['a short tag', 16, 16],
    ['a long tag', 16, 64],
  ])('P4: accepts but asks to rehash a hash with %s', async (_label, salt, tag) => {
    expect(await provider().verifyPassword(PASSWORD, await handMadeHash(salt, tag))).toEqual({ valid: true, needsRehash: true });
  });

  it('P5: refuses passwords longer than MAX_PASSWORD_LENGTH', async () => {
    const auth = provider();
    const long = 'x'.repeat(MAX_PASSWORD_LENGTH + 1);

    await expect(auth.hashPassword(long)).rejects.toThrow(RangeError);
    expect(await auth.verifyPassword(long, await auth.hashPassword('x'))).toEqual({ valid: false, needsRehash: false });
    await expect(auth.hashPassword('x'.repeat(MAX_PASSWORD_LENGTH))).resolves.toMatch(PHC);
  });

  it.each([
    ['parallelism above memoryKiB / 8', { parallelism: 4096 }],
    ['memoryKiB above the Argon2 limit', { memoryKiB: 2 ** 33 }],
    ['parallelism above the Argon2 limit', { parallelism: 2 ** 25, memoryKiB: 2 ** 32 - 1 }],
  ])('P6: rejects %s at construction, not at the first login', (_label, params) => {
    expect(() => provider({ params })).toThrow(RangeError);
  });

  it('P10: an explicit undefined parameter falls back to the default', async () => {
    const params = { memoryKiB: undefined } as unknown as Partial<{ memoryKiB: number }>;

    expect(PHC.exec(await provider({ params }).hashPassword(PASSWORD))?.[1]).toBe('19456');
  });

  it.each([
    ['v', 'v=19', 'v=019'],
    ['m', 'm=19456', 'm=019456'],
  ])('P9: refuses a non-canonical %s with a leading zero', async (_label, from, to) => {
    const auth = provider();
    const hash = tamper(await auth.hashPassword(PASSWORD), from, to);

    expect(await auth.verifyPassword(PASSWORD, hash)).toEqual({ valid: false, needsRehash: false });
  });

  it('P8/P12: rejects a non-string Pepper id or current id without echoing it', () => {
    const misplaced = 'swapped-secret-value-0123456789abcdef';

    expect(() => provider({ peppers: [{ id: 1 as unknown as string, key: PEPPER_1.key }] })).toThrow(PepperConfigError);
    let message = '';
    try {
      provider({ currentPepperId: misplaced });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    assertNoSecretsLeaked(message, { misplaced });
  });
});
