import { PERMISSION_PATTERN } from '@tecton/manifest';

export type CredentialStatus = 'active' | 'disabled';

/** What the Auth service stores about a subject, and nothing else (AD-9). */
export interface Credential {
  /** Subject id: UUID v7 in canonical form (AD-5). */
  id: string;
  /** Normalized login identifier (see normalizeLogin); unique. */
  login: string;
  /** PHC string from the AuthProvider; never the password. */
  passwordHash: string;
  status: CredentialStatus;
  /** Permissions in the manifest format, e.g. "tenant:create". */
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

export const MAX_LOGIN_LENGTH = 320;
const PERMISSION = new RegExp(PERMISSION_PATTERN);

export class InvalidLoginError extends Error {
  override readonly name = 'InvalidLoginError';
}

export class InvalidCredentialError extends Error {
  override readonly name = 'InvalidCredentialError';
}

function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Canonical form of a login identifier: Unicode NFKC, surrounding whitespace removed, lower case
 * (locale-independent). Accents are kept, so "josé" and "jose" are different logins.
 */
export function normalizeLogin(raw: string): string {
  if (typeof raw !== 'string') throw new InvalidLoginError('login must be a string');
  const login = raw.normalize('NFKC').trim().toLowerCase();
  if (login === '') throw new InvalidLoginError('login must not be empty');
  if (login.length > MAX_LOGIN_LENGTH) throw new InvalidLoginError(`login must be at most ${MAX_LOGIN_LENGTH} characters`);
  if (hasControlCharacter(login)) throw new InvalidLoginError('login must not contain control characters');
  return login;
}

/** Permissions use the same format as `auth.requires` in tecton.yaml, without repetition. */
export function assertValidPermissions(permissions: readonly string[]): void {
  const seen = new Set<string>();
  for (const permission of permissions) {
    if (typeof permission !== 'string' || !PERMISSION.test(permission)) {
      throw new InvalidCredentialError(`invalid permission ${JSON.stringify(permission)}: use <resource>:<action>, e.g. "tenant:create"`);
    }
    if (seen.has(permission)) throw new InvalidCredentialError(`permission "${permission}" is listed more than once`);
    seen.add(permission);
  }
}
