// In-memory LoginLockout for tests without Docker (Story 2.6). Same contract as the port of
// @tecton/providers, typed structurally (tests/support depends on no package); windows and locks
// follow the given clock. Never for production: the count must be shared by every Auth instance.

export interface MemoryLoginLockout {
  check(identifier: string): Promise<{ locked: false } | { locked: true; retryAfterSeconds: number }>;
  recordFailure(identifier: string): Promise<{ lockedNow: false } | { lockedNow: true; lockSeconds: number }>;
  reset(identifier: string): Promise<void>;
  close(): Promise<void>;
  /** While true, every call throws the `unavailable` error (Valkey down). */
  setUnavailable(unavailable: boolean): void;
  failures(identifier: string): number;
}

export function createMemoryLoginLockout(
  unavailable: () => Error,
  now: () => Date,
  policy: { maxFailures?: number; windowSeconds?: number; lockSeconds?: number } = {},
): MemoryLoginLockout {
  const maxFailures = policy.maxFailures ?? 5;
  const windowMs = (policy.windowSeconds ?? 900) * 1000;
  const lockMs = (policy.lockSeconds ?? 900) * 1000;
  const counters = new Map<string, { count: number; until: number }>();
  const locks = new Map<string, number>();
  let down = false;
  const check = () => {
    if (down) throw unavailable();
  };
  const time = () => now().getTime();
  return {
    async check(identifier) {
      check();
      const until = locks.get(identifier);
      if (until === undefined || until <= time()) return { locked: false };
      return { locked: true, retryAfterSeconds: Math.ceil((until - time()) / 1000) };
    },
    async recordFailure(identifier) {
      check();
      const current = counters.get(identifier);
      const live = current && current.until > time() ? current : { count: 0, until: time() + windowMs };
      const count = live.count + 1;
      if (count >= maxFailures) {
        counters.delete(identifier);
        locks.set(identifier, time() + lockMs);
        return { lockedNow: true, lockSeconds: lockMs / 1000 };
      }
      counters.set(identifier, { count, until: live.until });
      return { lockedNow: false };
    },
    async reset(identifier) {
      check();
      counters.delete(identifier);
      locks.delete(identifier);
    },
    async close() {},
    setUnavailable: (value) => void (down = value),
    failures: (identifier) => {
      const current = counters.get(identifier);
      return current && current.until > time() ? current.count : 0;
    },
  };
}
