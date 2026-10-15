/** Outcome of a password verification. */
export interface PasswordVerification {
  /** True only when the password matches the stored hash. */
  valid: boolean;
  /**
   * True when the password is valid but the stored hash should be replaced by a fresh one
   * (weaker parameters than configured, or a Pepper that is no longer the current one).
   * Always false when `valid` is false.
   */
  needsRehash: boolean;
}

/**
 * Port for password hashing (AD-1). Services depend on this interface only; the reference
 * adapter is `createArgon2idAuthProvider`.
 */
export interface AuthProvider {
  /** Hashes a password; returns a self-describing PHC string safe to store. */
  hashPassword(password: string): Promise<string>;
  /**
   * Verifies a password against a stored hash. Never throws because of the stored value:
   * a malformed, foreign or unknown-Pepper hash is simply not valid.
   */
  verifyPassword(password: string, storedHash: string): Promise<PasswordVerification>;
}
