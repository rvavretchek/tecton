import { describe, expect, it } from 'vitest';
import { createTestClock, DEFAULT_TEST_EPOCH } from './clock.js';

describe('createTestClock', () => {
  it('starts at the fixed epoch and only moves when told to', () => {
    const clock = createTestClock();

    expect(clock.now().toISOString()).toBe(DEFAULT_TEST_EPOCH.toISOString());
    expect(clock.now().toISOString()).toBe(DEFAULT_TEST_EPOCH.toISOString());
  });

  it('advances by the given milliseconds, e.g. past a 15-minute access token', () => {
    const clock = createTestClock();

    clock.advance(15 * 60 * 1000 + 1);

    expect(clock.now().toISOString()).toBe('2026-01-01T00:15:00.001Z');
  });

  it('can jump to an absolute instant, including backwards', () => {
    const clock = createTestClock(new Date('2026-06-01T12:00:00.000Z'));

    clock.set(new Date('2026-05-31T12:00:00.000Z'));

    expect(clock.now().toISOString()).toBe('2026-05-31T12:00:00.000Z');
  });

  it('returns a new Date each call so callers cannot mutate the clock', () => {
    const clock = createTestClock();

    clock.now().setFullYear(1999);

    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('rejects negative or non-finite advances', () => {
    const clock = createTestClock();

    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
  });
});
