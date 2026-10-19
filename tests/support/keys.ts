import { generateKeyPairSync } from 'node:crypto';

/** A fresh Ed25519 key pair as PEM (private PKCS#8, public SPKI), for Auth tests (Story 2.2b). */
export function ed25519KeyPairPem(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}
