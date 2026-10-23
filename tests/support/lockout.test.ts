import { describe, expect, it } from 'vitest';
import { createTestClock } from './clock.js';
import { createMemoryLoginLockout } from './lockout.js';

// The in-memory double must follow the rules of the Valkey adapter (Story 2.6 review P19).
describe('createMemoryLoginLockout', () => {
  it('neither counts nor extends while locked', async () => {
    const clock = createTestClock();
    const lockout = createMemoryLoginLockout(() => new Error('down'), () => clock.now(), { maxFailures: 2 });
    await lockout.recordFailure('alice');
    await lockout.recordFailure('alice');
    clock.advance(600_000);

    for (let i = 0; i < 5; i += 1) expect(await lockout.recordFailure('alice')).toEqual({ lockedNow: false });
    expect(lockout.failures('alice')).toBe(0);
    expect(await lockout.check('alice')).toEqual({ locked: true, retryAfterSeconds: 300 });
  });

  it('keeps the lock when only the failures are cleared, and reports what a reset removed', async () => {
    const clock = createTestClock();
    const lockout = createMemoryLoginLockout(() => new Error('down'), () => clock.now(), { maxFailures: 2 });
    await lockout.recordFailure('alice');
    await lockout.recordFailure('alice');

    await lockout.clearFailures('alice');
    expect(await lockout.check('alice')).toMatchObject({ locked: true });
    expect(await lockout.reset('alice')).toBe(true);
    expect(await lockout.reset('alice')).toBe(false);
  });

  it('refuses a policy outside the limits, like the adapter', () => {
    expect(() => createMemoryLoginLockout(() => new Error('down'), () => new Date(), { maxFailures: 0 })).toThrow(RangeError);
  });
});
