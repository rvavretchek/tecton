import type { Pepper } from '@tecton/providers';
import { buildSigningKeys, SigningKeyConfigError, type SigningKeys } from '../jose/signing-keys.js';
import { ACCESS_TOKEN_TTL, DEFAULT_AUDIENCE, DEFAULT_ISSUER } from '../jose/access-token-issuer.js';
import { REFRESH_TOKEN_TTL } from '../../core/session.js';

// Minimal environment reading of the Auth service, like pepperFromEnv: the ConfigProvider
// (Story 3.1) will take it over. Every error message names the variable, never its value.

/** Invalid Auth service configuration. */
export class AuthConfigError extends Error {
  override readonly name = 'AuthConfigError';
}

const PUBLIC_KEY_BLOCK = /-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g;
const BEGIN_MARKER = /-----BEGIN /g;
const DECIMAL = /^\d+$/;

/**
 * PEM as written in an environment variable: trimmed, with literal "\n" (or "\r\n") sequences
 * turned into line breaks. A one-line PEM often also ends with a real newline (echo, secret files).
 */
function pemFromEnv(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes('-----BEGIN') ? trimmed.replace(/\\r\\n|\\n/g, '\n') : trimmed;
}

/**
 * Public key blocks of a variable that may hold several; anything else (truncated blocks, private
 * keys, stray text) is an error, never silently dropped.
 */
function publicKeyBlocks(variable: string, value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return [];
  const pem = pemFromEnv(value);
  if (pem.includes('PRIVATE KEY')) throw new SigningKeyConfigError(`${variable} contains a private key; it must hold public keys only`);
  const blocks = pem.match(PUBLIC_KEY_BLOCK) ?? [];
  const leftover = pem.replace(PUBLIC_KEY_BLOCK, '').trim();
  if (blocks.length === 0 || leftover !== '' || (pem.match(BEGIN_MARKER) ?? []).length !== blocks.length) {
    throw new SigningKeyConfigError(`${variable} must hold only complete PEM public key blocks ("BEGIN PUBLIC KEY" ... "END PUBLIC KEY")`);
  }
  return blocks;
}

/**
 * TECTON_AUTH_SIGNING_KEY (Ed25519 private key, PEM PKCS#8), TECTON_AUTH_PREVIOUS_PUBLIC_KEYS (still
 * verifying tokens signed before a rotation) and TECTON_AUTH_NEXT_PUBLIC_KEYS (published before a
 * rotation, so verifiers know the next key before it signs).
 */
export async function signingKeysFromEnv(env: NodeJS.ProcessEnv): Promise<SigningKeys> {
  const privateKeyPem = env['TECTON_AUTH_SIGNING_KEY'];
  if (privateKeyPem === undefined || privateKeyPem.trim() === '') {
    throw new SigningKeyConfigError(
      'TECTON_AUTH_SIGNING_KEY is not set; it must hold an Ed25519 private key in PEM PKCS#8 (generate one with: openssl genpkey -algorithm ed25519)',
    );
  }
  return buildSigningKeys({
    privateKeyPem: pemFromEnv(privateKeyPem),
    previousPublicKeyPems: publicKeyBlocks('TECTON_AUTH_PREVIOUS_PUBLIC_KEYS', env['TECTON_AUTH_PREVIOUS_PUBLIC_KEYS']),
    nextPublicKeyPems: publicKeyBlocks('TECTON_AUTH_NEXT_PUBLIC_KEYS', env['TECTON_AUTH_NEXT_PUBLIC_KEYS']),
  });
}

/**
 * TECTON_AUTH_PREVIOUS_PEPPERS: Peppers kept after a rotation, as a JSON object of id to value,
 * e.g. {"1": "<old pepper>"}. Hashes made with them keep verifying and are re-hashed with the
 * current Pepper at the next login.
 */
export function previousPeppersFromEnv(env: NodeJS.ProcessEnv): Pepper[] {
  const value = env['TECTON_AUTH_PREVIOUS_PEPPERS'];
  if (value === undefined || value.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AuthConfigError('TECTON_AUTH_PREVIOUS_PEPPERS must be a JSON object of Pepper id to value, e.g. {"1": "..."}');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AuthConfigError('TECTON_AUTH_PREVIOUS_PEPPERS must be a JSON object of Pepper id to value, e.g. {"1": "..."}');
  }
  return Object.entries(parsed as Record<string, unknown>).map(([id, key]) => {
    if (typeof key !== 'string') throw new AuthConfigError('every value of TECTON_AUTH_PREVIOUS_PEPPERS must be a string');
    return { id, key: Buffer.from(key, 'utf8') };
  });
}

export interface TokenSettings {
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

/** A decimal integer variable (no hex, exponent or fraction), or the default when unset or blank. */
function integerFromEnv(variable: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const trimmed = value.trim();
  const number = DECIMAL.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new AuthConfigError(`${variable} must be a decimal integer between ${min} and ${max}`);
  }
  return number;
}

/** A text variable, trimmed; blank means the default. */
function textFromEnv(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? fallback : trimmed;
}

/** TECTON_AUTH_ISSUER, TECTON_AUTH_AUDIENCE and TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS, with their defaults. */
export function tokenSettingsFromEnv(env: NodeJS.ProcessEnv): TokenSettings {
  return {
    issuer: textFromEnv(env['TECTON_AUTH_ISSUER'], DEFAULT_ISSUER),
    audience: textFromEnv(env['TECTON_AUTH_AUDIENCE'], DEFAULT_AUDIENCE),
    ttlSeconds: integerFromEnv(
      'TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS',
      env['TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS'],
      ACCESS_TOKEN_TTL.default,
      ACCESS_TOKEN_TTL.min,
      ACCESS_TOKEN_TTL.max,
    ),
  };
}

/** TECTON_AUTH_REFRESH_TOKEN_TTL_SECONDS: fixed lifetime of a refresh token family (default 7 days). */
export function refreshTokenTtlFromEnv(env: NodeJS.ProcessEnv): number {
  return integerFromEnv(
    'TECTON_AUTH_REFRESH_TOKEN_TTL_SECONDS',
    env['TECTON_AUTH_REFRESH_TOKEN_TTL_SECONDS'],
    REFRESH_TOKEN_TTL.default,
    REFRESH_TOKEN_TTL.min,
    REFRESH_TOKEN_TTL.max,
  );
}

/** PORT (default 3000; 0 picks a free port) and HOST (default 127.0.0.1, loopback only). */
export function listenSettingsFromEnv(env: NodeJS.ProcessEnv): { port: number; host: string } {
  return { port: integerFromEnv('PORT', env['PORT'], 3000, 0, 65535), host: textFromEnv(env['HOST'], '127.0.0.1') };
}
