import { createTestClock } from '#test-support';
import { describe, expect, it } from 'vitest';
import { systemClock, type Clock } from './clock.js';

describe('Clock port (Test Design ASR-1)', () => {
  it('systemClock returns the current time as a new Date each call', () => {
    const before = Date.now();
    const now = systemClock.now();

    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
    expect(systemClock.now()).not.toBe(now);
  });

  it('the test clock satisfies the same port', () => {
    const clock = createTestClock() satisfies Clock;

    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
