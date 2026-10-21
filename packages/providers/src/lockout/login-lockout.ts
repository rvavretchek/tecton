/**
 * Port for the login lockout by identifier (Story 2.6, FR-12): after too many failed logins of one
 * identifier, from any origin, its logins are refused for a while. Implementations fail closed:
 * when they cannot answer, they throw LoginLockoutUnavailableError, never "not locked".
 */
export interface LoginLockout {
  /** Whether the identifier is locked now, and for how many more seconds. */
  check(identifier: string): Promise<{ locked: false } | { locked: true; retryAfterSeconds: number }>;
  /** Counts one failed login, atomically; `lockedNow` when this failure reached the limit. */
  recordFailure(identifier: string): Promise<{ lockedNow: false } | { lockedNow: true; lockSeconds: number }>;
  /** Clears the failures and the lock (successful login, administrator unlock). */
  reset(identifier: string): Promise<void>;
  close(): Promise<void>;
}

/** The lockout could not answer (Valkey unreachable, too slow, unexpected reply). Refuse the login. */
export class LoginLockoutUnavailableError extends Error {
  override readonly name = 'LoginLockoutUnavailableError';
}

/** Default and limits of the lockout policy. */
export const LOGIN_LOCKOUT_DEFAULTS = { maxFailures: 5, windowSeconds: 900, lockSeconds: 900 } as const;
export const LOGIN_LOCKOUT_LIMITS = {
  maxFailures: { min: 1, max: 100 },
  windowSeconds: { min: 60, max: 86_400 },
  lockSeconds: { min: 60, max: 86_400 },
} as const;

export interface LoginLockoutPolicy {
  maxFailures: number;
  windowSeconds: number;
  lockSeconds: number;
}

/** Invalid lockout configuration. Messages name the setting, never a login. */
export class LoginLockoutConfigError extends Error {
  override readonly name = 'LoginLockoutConfigError';
}

/** The policy with its defaults, every value checked against its limits. */
export function lockoutPolicy(policy: Partial<LoginLockoutPolicy> = {}): LoginLockoutPolicy {
  const resolved: LoginLockoutPolicy = { ...LOGIN_LOCKOUT_DEFAULTS, ...policy };
  for (const key of Object.keys(LOGIN_LOCKOUT_LIMITS) as Array<keyof LoginLockoutPolicy>) {
    const { min, max } = LOGIN_LOCKOUT_LIMITS[key];
    const value = resolved[key];
    if (!Number.isInteger(value) || value < min || value > max) throw new LoginLockoutConfigError(`${key} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

/** Throws a RangeError for an identifier that cannot be locked: a programming error. */
export function assertLockoutIdentifier(identifier: unknown): asserts identifier is string {
  if (typeof identifier !== 'string' || identifier === '' || identifier.length > 1024) {
    throw new RangeError('the lockout identifier must be a non-empty string of at most 1024 characters');
  }
}
