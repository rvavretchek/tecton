// In-memory LoginLockout for tests without Docker (Story 2.6). Same contract as the port of
// @tecton/providers and the same rules as its Valkey adapter (no counting while locked, the lock
// never extended, policy limits), typed structurally (tests/support depends on no package);
// windows and locks follow the given clock. Never for production: the count must be shared by
// every Auth instance.

export interface MemoryLoginLockout {
  check(identifier: string): Promise<{ locked: false } | { locked: true; retryAfterSeconds: number }>;
  recordFailure(identifier: string): Promise<{ lockedNow: false } | { lockedNow: true; lockSeconds: number }>;
  clearFailures(identifier: string): Promise<void>;
  reset(identifier: string): Promise<boolean>;
  close(): Promise<void>;
  /** While true, every call throws the `unavailable` error (Valkey down). */
  setUnavailable(unavailable: boolean): void;
  /** Makes only these methods unavailable (e.g. a Valkey failure in the middle of a login). */
  failOn(methods: ReadonlyArray<'check' | 'recordFailure' | 'clearFailures' | 'reset'>): void;
  failures(identifier: string): number;
}

const LIMITS = { maxFailures: [1, 100], windowSeconds: [60, 86_400], lockSeconds: [60, 86_400] } as const;

export function createMemoryLoginLockout(
  unavailable: () => Error,
  now: () => Date,
  policy: { maxFailures?: number; windowSeconds?: number; lockSeconds?: number } = {},
): MemoryLoginLockout {
  const resolved = { maxFailures: policy.maxFailures ?? 5, windowSeconds: policy.windowSeconds ?? 900, lockSeconds: policy.lockSeconds ?? 900 };
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const value = resolved[key as keyof typeof resolved];
    if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${key} must be an integer between ${min} and ${max}`);
  }
  const windowMs = resolved.windowSeconds * 1000;
  const lockMs = resolved.lockSeconds * 1000;
  const counters = new Map<string, { count: number; until: number }>();
  const locks = new Map<string, number>();
  let down = false;
  let failing = new Set<string>();
  const check = (method: string) => {
    if (down || failing.has(method)) throw unavailable();
  };
  const time = () => now().getTime();
  const lockedUntil = (identifier: string) => {
    const until = locks.get(identifier);
    return until !== undefined && until > time() ? until : undefined;
  };
  return {
    async check(identifier) {
      check('check');
      const until = lockedUntil(identifier);
      if (until === undefined) return { locked: false };
      return { locked: true, retryAfterSeconds: Math.max(1, Math.ceil((until - time()) / 1000)) };
    },
    async recordFailure(identifier) {
      check('recordFailure');
      // While locked, nothing is counted and the lock is never extended.
      if (lockedUntil(identifier) !== undefined) return { lockedNow: false };
      const current = counters.get(identifier);
      const live = current && current.until > time() ? current : { count: 0, until: time() + windowMs };
      const count = live.count + 1;
      if (count >= resolved.maxFailures) {
        counters.delete(identifier);
        locks.set(identifier, time() + lockMs);
        return { lockedNow: true, lockSeconds: resolved.lockSeconds };
      }
      counters.set(identifier, { count, until: live.until });
      return { lockedNow: false };
    },
    async clearFailures(identifier) {
      check('clearFailures');
      counters.delete(identifier);
    },
    async reset(identifier) {
      check('reset');
      const had = counters.delete(identifier);
      return locks.delete(identifier) || had;
    },
    async close() {},
    setUnavailable: (value) => void (down = value),
    failOn: (methods) => void (failing = new Set(methods)),
    failures: (identifier) => {
      const current = counters.get(identifier);
      return current && current.until > time() ? current.count : 0;
    },
  };
}
