import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findManifests, parseManifest, type TectonManifest } from '@tecton/manifest';
import { createMemoryTokenRevocationStore, createTestSigningKey, jwksTls, tokenFactory, type JwksTlsServer } from '#test-support';
import { RevocationStoreUnavailableError } from '@tecton/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTokenVerifier } from './auth/token-verifier.js';
import { isPublicAction, registerActionRoutes, actionRoutePath } from './routes.js';
import { createTectonServer } from './server.js';

// Test Design P0-001 (R-01): the generated Zero Trust sweep. Every protected action of every
// manifest in the repository (the reference examples and the ready-made Auth service) refuses a
// call without a token, with a forged token and with a user token alone (AD-7 amendment), before
// its body is read. A new manifest is covered without writing a test for it.

const repo = fileURLToPath(new URL('../../../', import.meta.url));
// Every tecton.yaml under these roots, plus the reference examples (named after their version).
const MANIFEST_ROOTS = ['docs/examples', 'packages/auth'];
const REFERENCE_EXAMPLES = ['docs/examples/tenant-domain-manifest-v0.yaml', 'docs/examples/leave-domain-manifest-v0.yaml'];

const paths = [...MANIFEST_ROOTS.flatMap((root) => findManifests(`${repo}${root}`)), ...REFERENCE_EXAMPLES.map((path) => `${repo}${path}`)];
const manifests: TectonManifest[] = paths.flatMap((path) => {
  const result = parseManifest(readFileSync(path, 'utf8'));
  return result.ok ? [result.manifest] : [];
});
const protectedActions = manifests.flatMap((manifest) => manifest.actions.filter((action) => !isPublicAction(action)).map((action) => ({ manifest, action })));

const key = createTestSigningKey();
const tokens = tokenFactory(key);
let jwks: JwksTlsServer;

beforeAll(async () => {
  jwks = await jwksTls({ keys: [key.publicJwk] });
}, 60_000);

afterAll(async () => {
  await jwks?.stop();
});

describe('Zero Trust sweep of every manifest (P0-001)', () => {
  it('finds the manifests and their protected actions', () => {
    expect(manifests.map((manifest) => manifest.domain)).toEqual(expect.arrayContaining(['auth', 'tenant']));
    expect(protectedActions.length).toBeGreaterThanOrEqual(3);
  });

  it.each(protectedActions.map(({ manifest, action }) => [`${manifest.domain}.${action.name}`, manifest, action] as const))(
    '%s refuses no token, a forged token and a user token alone with 401',
    async (_name, manifest, action) => {
      const app = createTectonServer({ logger: false });
      const revocations = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('down'));
      registerActionRoutes(app, manifest, {}, { verifier: createTokenVerifier({ jwksUrl: jwks.url, ca: jwks.ca, revocations }) });
      await app.ready();
      const requires = 'requires' in action.auth ? action.auth.requires : [];
      const call = (authorization?: string) =>
        app.inject({ method: 'POST', url: actionRoutePath(manifest.domain, action.name), headers: authorization ? { authorization } : {}, payload: {} });
      try {
        expect((await call()).statusCode).toBe(401);
        expect((await call(`Bearer ${tokens.forged()['tampered signature']}`)).statusCode).toBe(401);
        expect((await call(`Bearer ${tokens.valid({ perms: requires })}`)).statusCode).toBe(401);
      } finally {
        await app.close();
      }
    },
  );
});
