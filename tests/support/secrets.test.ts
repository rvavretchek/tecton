import { describe, expect, it } from 'vitest';
import { assertNoSecretsLeaked, findLeakedSecrets } from './secrets.js';

describe('secret leak detection', () => {
  const secrets = { password: 'correct-horse-battery', pepper: 'p'.repeat(32) };

  it('passes when no secret appears in the output', () => {
    expect(() => assertNoSecretsLeaked('{"msg":"login failed","user":"alice"}', secrets)).not.toThrow();
  });

  it('reports a leaked secret by label without echoing its value', () => {
    const output = '{"msg":"debug","body":{"password":"correct-horse-battery"}}';

    expect(findLeakedSecrets(output, secrets)).toEqual([
      { label: 'password', index: output.indexOf('correct'), encoding: 'literal' },
    ]);
    expect(() => assertNoSecretsLeaked(output, secrets)).toThrow(/password/);
    expect(() => assertNoSecretsLeaked(output, secrets)).not.toThrow(/correct-horse-battery/);
  });

  it('finds the secret after JSON escaping', () => {
    const secret = 'pa"ss\\word';
    const output = JSON.stringify({ body: { password: secret } });

    expect(findLeakedSecrets(output, { password: secret })).toMatchObject([{ encoding: 'json' }]);
  });

  it('finds the secret URL-encoded in a query string or form body', () => {
    const secret = 'p@ss word&1';

    expect(findLeakedSecrets(`GET /login?pw=${encodeURIComponent(secret)}`, { password: secret })).toMatchObject([
      { encoding: 'url' },
    ]);
  });

  it('finds the secret base64-encoded, e.g. a bearer value or cookie', () => {
    const output = `Cookie: session=${Buffer.from('correct-horse-battery').toString('base64')}`;

    expect(findLeakedSecrets(output, secrets)).toMatchObject([{ label: 'password', encoding: 'base64' }]);
  });

  it('rejects secrets too short to check instead of skipping them', () => {
    expect(() => findLeakedSecrets('id=abc', { tiny: 'abc' })).toThrow(/tiny/);
  });
});
