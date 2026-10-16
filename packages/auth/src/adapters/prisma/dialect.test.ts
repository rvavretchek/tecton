import { assertNoSecretsLeaked } from '#test-support';
import { describe, expect, it } from 'vitest';
import { dialectOf, UnsupportedDatabaseUrlError, withScheme } from './dialect.js';

describe('dialectOf', () => {
  it.each([
    ['postgresql://tecton:secret@localhost:5432/auth', 'postgresql'],
    ['postgres://tecton:secret@localhost:5432/auth', 'postgresql'],
    ['mysql://tecton:secret@localhost:3306/auth', 'mysql'],
    ['mariadb://tecton:secret@localhost:3306/auth', 'mysql'],
  ])('%s -> %s', (url, dialect) => {
    expect(dialectOf(url)).toBe(dialect);
  });

  it.each(['sqlite://file.db', 'not a url', '', 'sqlserver://sa:secret-password@host/auth'])('rejects %j without echoing it', (url) => {
    let message = '';
    try {
      dialectOf(url);
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedDatabaseUrlError);
      message = (error as Error).message;
    }

    expect(message).not.toBe('');
    if (url !== '') assertNoSecretsLeaked(message, { url });
  });
});

describe('dialect review fixes (P10, P13)', () => {
  it.each([
    [' mysql://u:p@h:3306/auth ', 'mysql'],
    ['MARIADB://u:p@h:3306/auth', 'mysql'],
    ['PostgreSQL://u:p@h:5432/auth', 'postgresql'],
  ])('accepts %j regardless of case and surrounding spaces', (url, dialect) => {
    expect(dialectOf(url)).toBe(dialect);
  });

  it.each([
    [' mysql://u:p@h:3306/auth', 'mariadb:', 'mariadb://u:p@h:3306/auth'],
    ['MariaDB://u:p@h:3306/auth', 'mysql:', 'mysql://u:p@h:3306/auth'],
  ] as const)('rewrites the scheme of %j to %s', (url, scheme, expected) => {
    expect(withScheme(url, scheme)).toBe(expected);
  });

  it('never echoes the "scheme" of an unsupported URL: it may be the start of a pasted secret', () => {
    let message = '';
    try {
      dialectOf('hunter2secret:value@db/auth');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('unsupported database URL scheme');
    expect(message).not.toContain('hunter2secret');
  });
});
