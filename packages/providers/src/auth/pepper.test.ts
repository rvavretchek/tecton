import { assertNoSecretsLeaked } from '#test-support';
import { describe, expect, it } from 'vitest';
import { PepperConfigError, pepperFromEnv } from './pepper.js';

const VALID = 'k'.repeat(32);

function errorOf(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected an error');
}

describe('pepperFromEnv', () => {
  it('reads the Pepper and defaults its id to "1"', () => {
    const pepper = pepperFromEnv({ TECTON_AUTH_PEPPER: VALID });

    expect(pepper.id).toBe('1');
    expect(pepper.key.equals(Buffer.from(VALID, 'utf8'))).toBe(true);
  });

  it('reads the Pepper id', () => {
    expect(pepperFromEnv({ TECTON_AUTH_PEPPER: VALID, TECTON_AUTH_PEPPER_ID: '2026-q4' }).id).toBe('2026-q4');
  });

  it.each([
    ['missing', {}],
    ['empty', { TECTON_AUTH_PEPPER: '' }],
  ])('fails when the Pepper is %s', (_label, env) => {
    const error = errorOf(() => pepperFromEnv(env));

    expect(error).toBeInstanceOf(PepperConfigError);
    expect(error.message).toContain('TECTON_AUTH_PEPPER is not set');
  });

  it('fails when the Pepper is shorter than 32 bytes, naming the size but never the value', () => {
    const short = 'secret-pepper-31-bytes-long-xyz';
    const error = errorOf(() => pepperFromEnv({ TECTON_AUTH_PEPPER: short }));

    expect(short).toHaveLength(31);
    expect(error).toBeInstanceOf(PepperConfigError);
    expect(error.message).toContain('31 bytes');
    assertNoSecretsLeaked(`${error.message} ${error.stack ?? ''}`, { pepper: short });
  });

  it('counts bytes, not characters: 16 two-byte characters are 32 bytes and pass', () => {
    const twoByte = String.fromCodePoint(0xe9).repeat(16);

    expect(Buffer.byteLength(twoByte, 'utf8')).toBe(32);
    expect(pepperFromEnv({ TECTON_AUTH_PEPPER: twoByte }).key).toHaveLength(32);
  });

  it.each(['', 'too-long-id', 'has space', 'a/b'])('fails on the invalid Pepper id "%s"', (id) => {
    expect(() => pepperFromEnv({ TECTON_AUTH_PEPPER: VALID, TECTON_AUTH_PEPPER_ID: id })).toThrow(PepperConfigError);
  });
});
