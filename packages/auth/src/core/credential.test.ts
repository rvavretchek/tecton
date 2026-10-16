import { describe, expect, it } from 'vitest';
import { InvalidCredentialError, InvalidLoginError, assertValidCredential, assertValidPermissions, normalizeLogin } from './credential.js';

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

describe('normalizeLogin: invisible and format characters (review P1)', () => {
  it.each([
    ['zero-width space', 0x200b],
    ['zero-width joiner', 0x200d],
    ['right-to-left override', 0x202e],
    ['soft hyphen', 0x00ad],
    ['byte order mark', 0xfeff],
    ['line separator', 0x2028],
    ['paragraph separator', 0x2029],
    ['private use', 0xe000],
  ])('rejects a login with a %s inside it', (_label, code) => {
    // Inside: at the ends, trim() already removes the whitespace-like ones (BOM, separators).
    expect(() => normalizeLogin(`ad${String.fromCodePoint(code)}min`)).toThrow(InvalidLoginError);
  });

  it('rejects malformed UTF-16', () => {
    expect(() => normalizeLogin(`admin${String.fromCodePoint(0xd800)}`)).toThrow(InvalidLoginError);
  });

  it('is stable: normalizing a normalized login changes nothing (dotted capital I included)', () => {
    const dottedCapitalI = `${String.fromCodePoint(0x130)}stanbul`;
    const once = normalizeLogin(dottedCapitalI);

    expect(normalizeLogin(once)).toBe(once);
    expect(once).toBe(once.normalize('NFKC'));
  });
});

describe('assertValidCredential (review P5)', () => {
  const base = {
    id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
    login: 'alice',
    passwordHash: 'hash',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  it.each([
    ['an unknown status', { ...base, status: 'locked', permissions: [] }],
    ['permissions that are not a list', { ...base, status: 'active', permissions: { a: 1 } }],
    ['a permission that is not a string', { ...base, status: 'active', permissions: ['tenant:create', 42] }],
  ])('fails closed on %s', (_label, credential) => {
    expect(() => assertValidCredential(credential as never)).toThrow(InvalidCredentialError);
  });
});
