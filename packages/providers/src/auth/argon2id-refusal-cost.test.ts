import * as crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

// Counts the Argon2id derivations the adapter runs, keeping the real implementation.
const calls: Array<{ memory: number; passes: number }> = [];
vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof crypto>();
  return {
    ...original,
    argon2: (algorithm: string, parameters: { memory: number; passes: number }, callback: (error: Error | null, key: Buffer) => void) => {
      calls.push({ memory: parameters.memory, passes: parameters.passes });
      return original.argon2(algorithm as 'argon2id', parameters as never, callback);
    },
  };
});

const { createArgon2idAuthProvider } = await import('./argon2id-auth-provider.js');

const PEPPER = { id: '1', key: Buffer.from('refusal-cost-test-pepper-32-bytes!!', 'utf8') };
const OTHER = { id: '2', key: Buffer.from('refusal-cost-other-pepper-32-bytes!', 'utf8') };

// Story 2.2b review P1: every refusal costs one Argon2id at the current parameters, so the
// response time never tells a stored-but-unusable hash apart from a wrong password.
describe('Argon2id AuthProvider: refusals cost one derivation at the current parameters', () => {
  it.each([
    ['a malformed hash', async () => 'not-a-hash'],
    ['an unknown Pepper', async () => createArgon2idAuthProvider({ peppers: [OTHER], currentPepperId: '2' }).hashPassword('password-123')],
    ['a cost above the ceiling', async () => (await createArgon2idAuthProvider({ peppers: [PEPPER], currentPepperId: '1' }).hashPassword('password-123')).replace('m=19456', 'm=1100000')],
    ['a password that is too long', async () => createArgon2idAuthProvider({ peppers: [PEPPER], currentPepperId: '1' }).hashPassword('password-123')],
  ])('%s', async (label, storedHash) => {
    const auth = createArgon2idAuthProvider({ peppers: [PEPPER], currentPepperId: '1' });
    const hash = await storedHash();
    const password = label === 'a password that is too long' ? 'x'.repeat(5000) : 'password-123';
    calls.length = 0;

    expect(await auth.verifyPassword(password, hash)).toEqual({ valid: false, needsRehash: false });
    expect(calls).toEqual([{ memory: 19456, passes: 2 }]);
  });
});
