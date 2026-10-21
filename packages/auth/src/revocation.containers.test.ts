import { createTokenVerifier, InvalidTokenError } from '@tecton/core';
import { createArgon2idAuthProvider, createValkeyTokenRevocationStore } from '@tecton/providers';
import { ed25519KeyPairPem, startValkey, type StartedValkey } from '#test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccessTokenIssuer } from './adapters/jose/access-token-issuer.js';
import { buildSigningKeys } from './adapters/jose/signing-keys.js';
import type { Credential } from './core/credential.js';
import type { CredentialStore } from './core/credential-store.js';
import { createMemoryRefreshTokenStore } from './core/memory-refresh-token-store.test-helper.js';
import { createAuthService, JWKS_PATH, type AuthServiceApp } from './service.js';

const PASSWORD = 'alice-password-123';
const auth = createArgon2idAuthProvider({ peppers: [{ id: '1', key: Buffer.from('revocation-e2e-pepper-with-32-bytes', 'utf8') }], currentPepperId: '1' });

// Story 2.5 end to end (FR-14): the Auth service and a domain verifier share one real Valkey; a
// logout revokes the access token everywhere. Runs with `pnpm test:containers`.
describe('token revocation end to end on a real Valkey', () => {
  let valkey: StartedValkey;
  let app: AuthServiceApp;
  let jwksUrl: string;
  const url = () => `redis://${valkey.host}:${valkey.port}`;

  beforeAll(async () => {
    valkey = await startValkey();
    const keys = await buildSigningKeys({ privateKeyPem: ed25519KeyPairPem().privatePem });
    const credential: Credential = {
      id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
      login: 'alice',
      passwordHash: await auth.hashPassword(PASSWORD),
      status: 'active',
      permissions: ['finance:close'],
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const store: CredentialStore = {
      count: async () => 1,
      findByLogin: async (login) => (login === 'alice' ? credential : undefined),
      findById: async (id) => (id === credential.id ? credential : undefined),
      create: async () => undefined,
      createIfEmpty: async () => false,
      updatePasswordHash: async () => true,
      close: async () => undefined,
    };
    app = await createAuthService({
      store,
      refreshTokens: createMemoryRefreshTokenStore().store,
      revocations: createValkeyTokenRevocationStore({ url: url() }),
      auth,
      issuer: createAccessTokenIssuer({ keys, clock: { now: () => new Date() } }),
      keys,
    });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    jwksUrl = `${address}${JWKS_PATH}`;
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await valkey?.stop();
  });

  it('refuses in a domain verifier the access token revoked by a logout at the Auth service', async () => {
    const verifier = createTokenVerifier({ jwksUrl, devMode: true, revocations: createValkeyTokenRevocationStore({ url: url() }) });
    try {
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { login: 'alice', password: PASSWORD } });
      const { accessToken } = login.json() as { accessToken: string };
      const authorization = `Bearer ${accessToken}`;
      // The store connects in the background: wait for the first accepted check.
      const deadline = Date.now() + 20_000;
      for (;;) {
        try {
          await verifier.verify(authorization);
          break;
        } catch (error) {
          if (Date.now() > deadline) throw error;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      expect((await app.inject({ method: 'POST', url: '/auth/logout', headers: { authorization } })).statusCode).toBe(200);

      await expect(verifier.verify(authorization)).rejects.toBeInstanceOf(InvalidTokenError);
    } finally {
      await verifier.close?.();
    }
  }, 60_000);
});
