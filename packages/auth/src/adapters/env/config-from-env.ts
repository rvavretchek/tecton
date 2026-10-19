import { buildSigningKeys, SigningKeyConfigError, type SigningKeys } from '../jose/signing-keys.js';
import { ACCESS_TOKEN_TTL, DEFAULT_AUDIENCE, DEFAULT_ISSUER } from '../jose/access-token-issuer.js';

// Minimal environment reading of the Auth service, like pepperFromEnv: the ConfigProvider
// (Story 3.1) will take it over. Every error message names the variable, never its value.

/** Invalid Auth service configuration. */
export class AuthConfigError extends Error {
  override readonly name = 'AuthConfigError';
}

const PUBLIC_KEY_BLOCK = /-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g;

/** PEM values pasted into a single-line variable often carry literal "\n" sequences. */
function pemFromEnv(value: string): string {
  return value.includes('-----') && !value.includes('\n') ? value.replace(/\\n/g, '\n') : value;
}

/** TECTON_AUTH_SIGNING_KEY (Ed25519 private key, PEM PKCS#8) and TECTON_AUTH_PREVIOUS_PUBLIC_KEYS (PEM SPKI blocks). */
export async function signingKeysFromEnv(env: NodeJS.ProcessEnv): Promise<SigningKeys> {
  const privateKeyPem = env['TECTON_AUTH_SIGNING_KEY'];
  if (privateKeyPem === undefined || privateKeyPem.trim() === '') {
    throw new SigningKeyConfigError(
      'TECTON_AUTH_SIGNING_KEY is not set; it must hold an Ed25519 private key in PEM PKCS#8 (generate one with: openssl genpkey -algorithm ed25519)',
    );
  }
  const previous = env['TECTON_AUTH_PREVIOUS_PUBLIC_KEYS'];
  const previousPublicKeyPems = previous ? (pemFromEnv(previous).match(PUBLIC_KEY_BLOCK) ?? []) : [];
  if (previous && previous.trim() !== '' && previousPublicKeyPems.length === 0) {
    throw new SigningKeyConfigError('TECTON_AUTH_PREVIOUS_PUBLIC_KEYS holds no PEM public key block ("BEGIN PUBLIC KEY")');
  }
  return buildSigningKeys({ privateKeyPem: pemFromEnv(privateKeyPem), previousPublicKeyPems });
}

export interface TokenSettings {
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

/** TECTON_AUTH_ISSUER, TECTON_AUTH_AUDIENCE and TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS, with their defaults. */
export function tokenSettingsFromEnv(env: NodeJS.ProcessEnv): TokenSettings {
  const ttl = env['TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS'];
  const ttlSeconds = ttl === undefined || ttl.trim() === '' ? ACCESS_TOKEN_TTL.default : Number(ttl);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < ACCESS_TOKEN_TTL.min || ttlSeconds > ACCESS_TOKEN_TTL.max) {
    throw new AuthConfigError(
      `TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS must be an integer between ${ACCESS_TOKEN_TTL.min} and ${ACCESS_TOKEN_TTL.max}`,
    );
  }
  return {
    issuer: env['TECTON_AUTH_ISSUER'] || DEFAULT_ISSUER,
    audience: env['TECTON_AUTH_AUDIENCE'] || DEFAULT_AUDIENCE,
    ttlSeconds,
  };
}

/** PORT (default 3000; 0 picks a free port) and HOST (default 127.0.0.1, loopback only). */
export function listenSettingsFromEnv(env: NodeJS.ProcessEnv): { port: number; host: string } {
  const value = env['PORT'];
  const port = value === undefined || value.trim() === '' ? 3000 : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new AuthConfigError('PORT must be an integer between 0 and 65535');
  return { port, host: env['HOST'] || '127.0.0.1' };
}
