import { createHash, randomBytes } from 'node:crypto';

/** Random bytes of an opaque refresh token: 256 bits. */
export const REFRESH_TOKEN_BYTES = 32;

// 32 bytes in base64url without padding are always 43 characters.
const WELL_FORMED = /^[A-Za-z0-9_-]{43}$/;

/** A new opaque refresh token: 256 random bits in base64url (43 characters). */
export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/**
 * What the Auth database stores instead of the token: its SHA-256, in lowercase hex. A fast hash
 * is enough (no Argon2id, no Pepper) because the token carries 256 bits of entropy.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Whether `value` has the shape of a refresh token; anything else is unknown without a lookup. */
export function isWellFormedRefreshToken(value: unknown): value is string {
  return typeof value === 'string' && WELL_FORMED.test(value);
}
