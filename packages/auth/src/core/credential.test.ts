import { describe, expect, it } from 'vitest';
import { InvalidCredentialError, InvalidLoginError, assertValidPermissions, normalizeLogin } from './credential.js';

describe('normalizeLogin', () => {
  it.each([
    ['  Alice@Example.COM ', 'alice@example.com'],
    [`${String.fromCodePoint(0xff21)}lice`, 'alice'], // fullwidth A, folded by NFKC
    ['MARIA.Souza', 'maria.souza'],
  ])('normalizes %j to %j', (raw, expected) => {
    expect(normalizeLogin(raw)).toBe(expected);
  });

  it('keeps accents: josé and jose are different logins', () => {
    expect(normalizeLogin('José')).not.toBe(normalizeLogin('Jose'));
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['too long', `${'a'.repeat(321)}`],
    ['a control character', `ali${String.fromCodePoint(0)}ce`],
    ['a line break', `ali${String.fromCodePoint(10)}ce`],
    ['not a string', 42 as unknown as string],
  ])('rejects %s', (_label, raw) => {
    expect(() => normalizeLogin(raw)).toThrow(InvalidLoginError);
  });

  it('accepts exactly 320 characters', () => {
    expect(normalizeLogin('a'.repeat(320))).toHaveLength(320);
  });
});

describe('assertValidPermissions', () => {
  it('accepts permissions in the manifest format', () => {
    expect(() => assertValidPermissions(['auth:service:register', 'tenant:create'])).not.toThrow();
  });

  it.each([['Tenant:Create'], ['tenant'], ['tenant:'], [42]])('rejects %j', (permission) => {
    expect(() => assertValidPermissions([permission as string])).toThrow(InvalidCredentialError);
  });

  it('rejects repeated permissions', () => {
    expect(() => assertValidPermissions(['tenant:create', 'tenant:create'])).toThrow(InvalidCredentialError);
  });
});
