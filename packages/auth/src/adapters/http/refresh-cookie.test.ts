import { describe, expect, it } from 'vitest';
import { clearRefreshCookie, readRefreshCookie, readRefreshCookies, REFRESH_COOKIE, REFRESH_COOKIE_PATH, serializeRefreshCookie } from './refresh-cookie.js';

const TOKEN = 'a'.repeat(43);

describe('refresh cookie (Story 2.3, AC 1, AC 6, AC 7)', () => {
  it('sets tecton_refresh with HttpOnly, Secure, SameSite=Strict, Path=/auth and Max-Age, without Domain', () => {
    expect(REFRESH_COOKIE).toBe('tecton_refresh');
    expect(REFRESH_COOKIE_PATH).toBe('/auth');
    expect(serializeRefreshCookie(TOKEN, 604_800)).toBe(`tecton_refresh=${TOKEN}; Max-Age=604800; Path=/auth; HttpOnly; Secure; SameSite=Strict`);
    expect(serializeRefreshCookie(TOKEN, 12.9)).toContain('Max-Age=12;');
    expect(serializeRefreshCookie(TOKEN, -5)).toContain('Max-Age=0;');
    expect(serializeRefreshCookie(TOKEN, 1)).not.toMatch(/domain/i);
  });

  it('clears it with an empty value, Max-Age=0 and the same attributes', () => {
    expect(clearRefreshCookie()).toBe('tecton_refresh=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Strict');
  });

  it('reads it among other cookies', () => {
    expect(readRefreshCookie(`theme=dark; tecton_refresh=${TOKEN}; lang=pt-BR`)).toBe(TOKEN);
    expect(readRefreshCookie([`theme=dark`, `tecton_refresh=${TOKEN}`])).toBe(TOKEN);
  });

  it('reads nothing when absent, duplicated or only similarly named', () => {
    expect(readRefreshCookie(undefined)).toBeUndefined();
    expect(readRefreshCookie('')).toBeUndefined();
    expect(readRefreshCookie('theme=dark')).toBeUndefined();
    expect(readRefreshCookie('xtecton_refresh=abc; tecton_refresh_old=def')).toBeUndefined();
    expect(readRefreshCookie(`tecton_refresh=${TOKEN}; tecton_refresh=${'b'.repeat(43)}`)).toBeUndefined();
  });

  it('lists every value of the name for logout, which revokes them all (review P5)', () => {
    expect(readRefreshCookies(`tecton_refresh=${TOKEN}; theme=dark; tecton_refresh=${'b'.repeat(43)}`)).toEqual([TOKEN, 'b'.repeat(43)]);
    expect(readRefreshCookies(['theme=dark', `tecton_refresh=${TOKEN}`])).toEqual([TOKEN]);
    expect(readRefreshCookies(undefined)).toEqual([]);
    expect(readRefreshCookies('xtecton_refresh=abc')).toEqual([]);
  });
});
