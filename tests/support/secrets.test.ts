import { describe, expect, it } from 'vitest';
import { assertNoSecretsLeaked, findLeakedSecrets } from './secrets.js';

describe('secret leak detection', () => {
  const secrets = { password: 'correct-horse-battery', pepper: 'p'.repeat(32) };

  it('passes when no secret appears in the output', () => {
    expect(() => assertNoSecretsLeaked('{"msg":"login failed","user":"alice"}', secrets)).not.toThrow();
  });

  it('reports a leaked secret by label without echoing its value', () => {
    const output = '{"msg":"debug","body":{"password":"correct-horse-battery"}}';

    expect(findLeakedSecrets(output, secrets)).toEqual([{ label: 'password', index: output.indexOf('correct') }]);
    expect(() => assertNoSecretsLeaked(output, secrets)).toThrow(/password/);
    expect(() => assertNoSecretsLeaked(output, secrets)).not.toThrow(/correct-horse-battery/);
  });

  it('ignores very short secrets that would match ordinary text', () => {
    expect(findLeakedSecrets('id=abc', { tiny: 'abc' })).toEqual([]);
  });
});
