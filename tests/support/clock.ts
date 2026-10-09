/**
 * Controllable clock for tests (Test Design ASR-1).
 *
 * Every expiry in Tecton (access/service/refresh tokens, login lockout, Idempotency-Key,
 * pending approvals, outbox retention, legacy bridge cache) must be testable without
 * waiting for real time. Production code receives time through a `Clock` port injected
 * by Awilix; this test clock satisfies the same `now(): Date` shape.
 */
export interface TestClock {
  /** Current instant. Returns a new Date on every call. */
  now(): Date;
  /** Moves time forward by `ms` milliseconds. */
  advance(ms: number): void;
  /** Jumps to an absolute instant (may move backwards to test clock skew). */
  set(instant: Date): void;
}

export const DEFAULT_TEST_EPOCH = new Date('2026-01-01T00:00:00.000Z');

export function createTestClock(start: Date = DEFAULT_TEST_EPOCH): TestClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms) => {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError(`advance() expects a non-negative finite number of milliseconds, got ${ms}`);
      }
      current += ms;
    },
    set: (instant) => {
      current = instant.getTime();
    },
  };
}
