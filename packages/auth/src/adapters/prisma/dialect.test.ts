import { assertNoSecretsLeaked } from '#test-support';
import { describe, expect, it } from 'vitest';
import { dialectOf, UnsupportedDatabaseUrlError } from './dialect.js';

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
    if (url.includes('secret-password')) assertNoSecretsLeaked(message, { password: 'secret-password' });
  });
});
