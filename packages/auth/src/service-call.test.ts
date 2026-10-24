import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTokenVerifier, startDomainServer } from '@tecton/core';
import { createArgon2idAuthProvider, LoginLockoutUnavailableError, RevocationStoreUnavailableError, systemClock } from '@tecton/providers';
import { createMemoryLoginLockout, createMemoryTokenRevocationStore, ed25519KeyPairPem } from '#test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccessTokenIssuer, createServiceTokenIssuer } from './adapters/jose/access-token-issuer.js';
import { buildSigningKeys } from './adapters/jose/signing-keys.js';
import type { Credential } from './core/credential.js';
import type { CredentialStore } from './core/credential-store.js';
import { createMemoryRefreshTokenStore } from './core/memory-refresh-token-store.test-helper.js';
import { createMemoryServiceCredentialStore } from './core/memory-service-credential-store.test-helper.js';
import { createAuthService, type AuthServiceApp } from './service.js';

// Story 2.7b end to end: the Auth service in process issues a service token (Story 2.7a), and a
// domain service verifies it through the Auth JWKS, alone or with the user in Tecton-On-Behalf-Of.

const PASSWORD = 'admin-password-123';
const auth = createArgon2idAuthProvider({ peppers: [{ id: '1', key: Buffer.from('service-call-test-pepper-32-bytes!', 'utf8') }], currentPepperId: '1' });
const FINANCE = `manifestVersion: "0.1"
domain: finance
version: 0.1.0
description: "Finance."
actions:
  - name: closeMonth
    description: "Closes the month."
    input: { month: string }
    output: { closedBy: string }
    auth: { requires: [finance:close] }
`;

let authApp: AuthServiceApp;
let domain: Awaited<ReturnType<typeof startDomainServer>>;
let dir: string;
const revocations = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('down'));

beforeAll(async () => {
  const keys = await buildSigningKeys({ privateKeyPem: ed25519KeyPairPem().privatePem });
  const hash = await auth.hashPassword(PASSWORD);
  const credentials: Credential[] = [
    { id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f', login: 'admin', passwordHash: hash, status: 'active', permissions: ['auth:service:register'], createdAt: new Date(0), updatedAt: new Date(0) },
    { id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e60', login: 'alice', passwordHash: hash, status: 'active', permissions: ['finance:close'], createdAt: new Date(0), updatedAt: new Date(0) },
  ];
  const store: CredentialStore = {
    count: async () => credentials.length,
    findByLogin: async (login) => credentials.find((credential) => credential.login === login),
    findById: async (id) => credentials.find((credential) => credential.id === id),
    create: async () => undefined,
    createIfEmpty: async () => false,
    updatePasswordHash: async () => true,
    close: async () => undefined,
  };
  authApp = await createAuthService({
    store,
    refreshTokens: createMemoryRefreshTokenStore().store,
    revocations,
    lockout: createMemoryLoginLockout(() => new LoginLockoutUnavailableError('down'), () => new Date()),
    auth,
    issuer: createAccessTokenIssuer({ keys, clock: systemClock }),
    keys,
    clock: systemClock,
    services: createMemoryServiceCredentialStore().store,
    serviceTokens: createServiceTokenIssuer({ keys, clock: systemClock }),
    logger: false,
  });
  const authUrl = await authApp.listen({ port: 0, host: '127.0.0.1' });
  dir = mkdtempSync(join(tmpdir(), 'tecton-service-call-'));
  writeFileSync(join(dir, 'tecton.yaml'), FINANCE);
  domain = await startDomainServer({
    manifestPath: join(dir, 'tecton.yaml'),
    port: 0,
    // The same revocation store as the Auth service: a rotation there is seen here.
    verifier: createTokenVerifier({ jwksUrl: `${authUrl}/auth/.well-known/jwks.json`, devMode: true, revocations }),
    handlers: { closeMonth: (_input, context) => ({ closedBy: `${context.principal?.subject} via ${context.service?.subject ?? 'nobody'}` }) },
    env: {},
    logger: false,
  });
}, 60_000);

afterAll(async () => {
  await domain?.close();
  await authApp?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const login = async (who: string) =>
  ((await authApp.inject({ method: 'POST', url: '/auth/login', payload: { login: who, password: PASSWORD } })).json() as { accessToken: string }).accessToken;

async function register(serviceDomain: string, dependencies: string, rotate = false) {
  const response = await authApp.inject({
    method: 'POST',
    url: '/auth/register-service',
    headers: { authorization: `Bearer ${await login('admin')}` },
    payload: { domain: serviceDomain, dependencies, permissions: 'finance:close', rotate },
  });
  // A failed registration must fail here, never pass a later "401 expected" for the wrong reason.
  expect(response.statusCode).toBe(200);
  const { secret } = response.json() as { secret: string };
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return secret;
}

async function serviceToken(serviceId: string, secret: string) {
  const response = await authApp.inject({ method: 'POST', url: '/auth/service-token', payload: { serviceId, secret } });
  expect(response.statusCode).toBe(200);
  return (response.json() as { accessToken: string }).accessToken;
}

const close = (headers: Record<string, string>) => domain.inject({ method: 'POST', url: '/finance/close-month', headers, payload: { month: '2026-10' } });

describe('a service calls a domain with the token the Auth service issued (Story 2.7b)', () => {
  it('works alone and on behalf of a user; a service without the dependency gets 403; a user alone gets 401', async () => {
    const billing = await serviceToken('billing', await register('billing', 'finance'));
    const catalog = await serviceToken('catalog', await register('catalog', 'tenant'));
    const alice = await login('alice');

    const alone = await close({ authorization: `Bearer ${billing}` });
    const onBehalf = await close({ authorization: `Bearer ${billing}`, 'tecton-on-behalf-of': alice });

    expect(alone.statusCode).toBe(200);
    expect(alone.json()).toEqual({ closedBy: 'service:billing via service:billing' });
    expect(onBehalf.statusCode).toBe(200);
    expect(onBehalf.json()).toEqual({ closedBy: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e60 via service:billing' });
    expect((await close({ authorization: `Bearer ${catalog}`, 'tecton-on-behalf-of': alice })).statusCode).toBe(403);
    expect((await close({ authorization: `Bearer ${alice}` })).statusCode).toBe(401);
  });

  it('refuses the old service token after a rotation, and accepts the new one', async () => {
    const old = await serviceToken('ledger', await register('ledger', 'finance'));
    expect((await close({ authorization: `Bearer ${old}` })).statusCode).toBe(200);

    const fresh = await serviceToken('ledger', await register('ledger', 'finance', true));

    expect((await close({ authorization: `Bearer ${old}` })).statusCode).toBe(401);
    expect((await close({ authorization: `Bearer ${fresh}` })).statusCode).toBe(200);
  });

  it('refuses the user once logged out, even with a valid service token', async () => {
    const billing = await serviceToken('payroll', await register('payroll', 'finance'));
    const alice = await login('alice');
    await authApp.inject({ method: 'POST', url: '/auth/logout', headers: { authorization: `Bearer ${alice}` } });

    expect((await close({ authorization: `Bearer ${billing}`, 'tecton-on-behalf-of': alice })).statusCode).toBe(401);
  });
});
