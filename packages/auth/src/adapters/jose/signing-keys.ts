import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { calculateJwkThumbprint, exportJWK, type JWK } from 'jose';

/** Invalid signing key configuration. The message never contains the key material. */
export class SigningKeyConfigError extends Error {
  override readonly name = 'SigningKeyConfigError';
}

/** A public key as published in the JWKS: Ed25519 (OKP), never with the private part `d`. */
export interface PublishedJwk extends JWK {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid: string;
  alg: 'EdDSA';
  use: 'sig';
}

export interface SigningKeys {
  /** The key that signs new tokens. */
  current: { kid: string; privateKey: KeyObject };
  /** Current public key first, then the previous ones still published during a rotation. */
  publicJwks: readonly PublishedJwk[];
}

export interface SigningKeyMaterial {
  /** Ed25519 private key, PEM PKCS#8 ("-----BEGIN PRIVATE KEY-----"). */
  privateKeyPem: string;
  /** Previous public keys, PEM SPKI ("-----BEGIN PUBLIC KEY-----"), kept in the JWKS during a rotation. */
  previousPublicKeyPems?: readonly string[];
}

const GENERATE_HINT = 'generate one with: openssl genpkey -algorithm ed25519';

function privateKeyFrom(pem: string): KeyObject {
  if (typeof pem !== 'string' || pem.trim() === '') {
    throw new SigningKeyConfigError(`the signing key is not set; it must be an Ed25519 private key in PEM PKCS#8 (${GENERATE_HINT})`);
  }
  if (!pem.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new SigningKeyConfigError(`the signing key must be an Ed25519 private key in PEM PKCS#8 ("BEGIN PRIVATE KEY"; ${GENERATE_HINT})`);
  }
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: 'pem' });
  } catch {
    throw new SigningKeyConfigError(`the signing key could not be read as a PEM private key (${GENERATE_HINT})`);
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new SigningKeyConfigError(`the signing key must be Ed25519 (EdDSA), not ${key.asymmetricKeyType ?? 'unknown'}`);
  }
  return key;
}

function publicKeyFrom(pem: string, position: number): KeyObject {
  let key: KeyObject;
  try {
    if (!pem.includes('-----BEGIN PUBLIC KEY-----')) throw new Error('not SPKI');
    key = createPublicKey({ key: pem, format: 'pem' });
  } catch {
    throw new SigningKeyConfigError(`previous public key #${position + 1} is not a PEM SPKI public key ("BEGIN PUBLIC KEY")`);
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new SigningKeyConfigError(`previous public key #${position + 1} must be Ed25519, not ${key.asymmetricKeyType ?? 'unknown'}`);
  }
  return key;
}

/** JWKS entry of a public key; `kid` is its RFC 7638 thumbprint. Built field by field, so `d` cannot slip in. */
async function publish(publicKey: KeyObject): Promise<PublishedJwk> {
  const jwk = await exportJWK(publicKey);
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
    throw new SigningKeyConfigError('unexpected public key encoding');
  }
  const kid = await calculateJwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: jwk.x }, 'sha256');
  return { kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid, alg: 'EdDSA', use: 'sig' };
}

/**
 * Validates the signing key and the previous public keys and builds the JWKS. A rotation needs no
 * old private key: tokens signed before it are verified with the published public key.
 */
export async function buildSigningKeys({ privateKeyPem, previousPublicKeyPems = [] }: SigningKeyMaterial): Promise<SigningKeys> {
  const privateKey = privateKeyFrom(privateKeyPem);
  const current = await publish(createPublicKey(privateKey));
  const previous = await Promise.all(previousPublicKeyPems.map((pem, position) => publish(publicKeyFrom(pem, position))));
  const publicJwks: PublishedJwk[] = [current];
  for (const jwk of previous) if (!publicJwks.some((known) => known.kid === jwk.kid)) publicJwks.push(jwk);
  return { current: { kid: current.kid, privateKey }, publicJwks };
}
