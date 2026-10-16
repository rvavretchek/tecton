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

/**
 * Characters a login must never contain: control (Cc), invisible format characters such as
 * zero-width space, joiners, bidirectional overrides and soft hyphen (Cf), line and paragraph
 * separators (Zl, Zp), private use (Co) and unassigned code points (Cn). Invisible characters
 * would allow logins that look identical to an existing one.
 */
const FORBIDDEN_IN_LOGIN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}]/u;

/**
 * Canonical form of a login identifier: Unicode NFKC, surrounding whitespace removed, lower case
 * (locale-independent). Accents are kept, so "josé" and "jose" are different logins. Lower-casing
 * never takes an NFKC string out of NFKC (checked over every code point), and the result is
 * stable: normalizeLogin(normalizeLogin(x)) === normalizeLogin(x).
 */
export function normalizeLogin(raw: string): string {
  if (typeof raw !== 'string') throw new InvalidLoginError('login must be a string');
  if (!raw.isWellFormed()) throw new InvalidLoginError('login is not well-formed UTF-16');
  const login = raw.normalize('NFKC').trim().toLowerCase();
  if (login === '') throw new InvalidLoginError('login must not be empty');
  if (login.length > MAX_LOGIN_LENGTH) throw new InvalidLoginError(`login must be at most ${MAX_LOGIN_LENGTH} characters`);
  if (FORBIDDEN_IN_LOGIN.test(login)) {
    throw new InvalidLoginError('login must not contain control, invisible or unassigned characters');
  }
  return login;
}

const STATUSES: readonly string[] = ['active', 'disabled'];

/** Fail closed on a credential that breaks the model (e.g. a row edited by hand). */
export function assertValidCredential(credential: Credential): void {
  if (!STATUSES.includes(credential.status)) {
    throw new InvalidCredentialError(`invalid credential status ${JSON.stringify(credential.status)}`);
  }
  if (!Array.isArray(credential.permissions)) throw new InvalidCredentialError('credential permissions must be a list');
  assertValidPermissions(credential.permissions);
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
