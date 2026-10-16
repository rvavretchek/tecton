import { describe, expect, it } from 'vitest';
import { migrationEnvironment, redactDatabaseUrl } from './migrations.js';

describe('migrationEnvironment (review P7)', () => {
  it('passes only what the Prisma CLI needs and the database URL, never other secrets', () => {
    const env = migrationEnvironment(
      {
        PATH: '/usr/bin',
        HOME: '/home/app',
        HTTPS_PROXY: 'http://proxy:3128',
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
        TECTON_AUTH_PEPPER: 'pepper-value-that-must-not-leak',
        TECTON_AUTH_BOOTSTRAP_PASSWORD: 'admin-password-that-must-not-leak',
        AWS_SECRET_ACCESS_KEY: 'aws-secret',
      },
      'postgresql://u:p@h/auth',
    );

    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/app',
      HTTPS_PROXY: 'http://proxy:3128',
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
      TECTON_AUTH_DATABASE_URL: 'postgresql://u:p@h/auth',
    });
  });
});

describe('redactDatabaseUrl (review P8)', () => {
  const url = 'postgresql://tecton:p%40ss%3Aword-123@db:5432/auth';

  it('removes the URL and the password in raw, decoded and re-encoded forms', () => {
    const output = [`failed for ${url}`, 'auth failed for password p%40ss%3Aword-123', 'decoded p@ss:word-123'].join('\n');
    const redacted = redactDatabaseUrl(output, [url]);

    expect(redacted).not.toContain('p%40ss%3Aword-123');
    expect(redacted).not.toContain('p@ss:word-123');
    expect(redacted).not.toContain(url);
    expect(redacted).toContain('<redacted>');
  });

  it('caps the output size, keeping the end', () => {
    const redacted = redactDatabaseUrl(`${'x'.repeat(10_000)}END`, [url]);

    expect(redacted.length).toBeLessThanOrEqual(4_003);
    expect(redacted.endsWith('END')).toBe(true);
  });
});
