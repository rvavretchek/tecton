// The refresh cookie, written and read by hand: the few attributes it needs do not justify a
// cookie library (Story 2.3).

export const REFRESH_COOKIE = 'tecton_refresh';
/**
 * Every route of the Auth service and nothing else: login sets it, refresh rotates it, logout
 * clears it, and no domain service ever receives it (FR-12). `__Host-` would force Path=/.
 */
export const REFRESH_COOKIE_PATH = '/auth';

const ATTRIBUTES = `Path=${REFRESH_COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict`;

/** Set-Cookie value carrying a refresh token, living at most `maxAgeSeconds` (host-only: no Domain). */
export function serializeRefreshCookie(token: string, maxAgeSeconds: number): string {
  return `${REFRESH_COOKIE}=${token}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; ${ATTRIBUTES}`;
}

/** Set-Cookie value that removes the refresh cookie from the browser. */
export function clearRefreshCookie(): string {
  return `${REFRESH_COOKIE}=; Max-Age=0; ${ATTRIBUTES}`;
}

/**
 * The refresh token in a Cookie header, or undefined. More than one cookie with this name (e.g. one
 * planted with another Path) is ambiguous and counts as none.
 */
export function readRefreshCookie(cookieHeader: string | readonly string[] | undefined): string | undefined {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  if (typeof header !== 'string') return undefined;
  const values: string[] = [];
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === REFRESH_COOKIE) values.push(pair.slice(separator + 1).trim());
  }
  return values.length === 1 ? values[0] : undefined;
}
