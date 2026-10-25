import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { parseManifest, type TectonManifest } from '@tecton/manifest';
import type { CustodyRequesterKind, KeyCustodyProvider } from '@tecton/providers';
import { assertNoSecretsLeaked } from '#test-support';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { InvalidTokenError, TokenVerificationUnavailableError, type Principal, type PrincipalKind, type TokenVerifier } from './auth/token-verifier.js';
import { loadDomainManifest, startDomainServer } from './domain-server.js';
import { buildOpenApiDocument } from './openapi.js';
import { KEY_CUSTODY_NOT_SUPPORTED, registerActionRoutes, type ActionHandlers } from './routes.js';
import { createTectonServer } from './server.js';

// Story 2.8 (FR-11, Test Design P1-011): sensitive.quorum without a KeyCustodyProvider runs
// normally and logs a warning at every execution; a configured provider is refused.

function manifestOf(source: string): TectonManifest {
  const result = parseManifest(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.manifest;
}

const LEDGER = manifestOf(`manifestVersion: "0.1"
domain: ledger
version: 0.1.0
description: "Ledger."
actions:
  - name: exportBooks
    description: "Exports the books."
    input: { year: string }
    output: { url: string }
    auth: { requires: [ledger:export] }
    sensitive: { quorum: true, description: "Every entry of the year." }
  - name: closeYear
    description: "Closes the year."
    input: {}
    output: { ok: boolean }
    auth: { requires: [ledger:export] }
    sensitive: { quorum: false, description: "Marked sensitive, without quorum." }
  - name: approveRefund
    description: "Approves a refund."
    input: {}
    output: { ok: boolean }
    auth: { requires: [ledger:export] }
    approval: { required: true }
  - name: rate
    description: "Public rate."
    input: {}
    output: { ok: boolean }
    auth: { public: true }
`);

const NOW = new Date('2026-10-25T12:00:00.000Z');
const USER: Principal = { kind: 'user', subject: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5a', permissions: ['ledger:export'], tokenId: 't', issuedAt: NOW, expiresAt: NOW };
const ACCEPT: TokenVerifier = { verify: async () => USER };
const servers: Array<ReturnType<typeof createTectonServer>> = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const app of servers.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function serve(options: { manifest?: TectonManifest; verifier?: TokenVerifier; handlers?: ActionHandlers } = {}) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const app = createTectonServer({ logger: { level: 'trace', stream } });
  servers.push(app);
  const handlers: ActionHandlers = options.handlers ?? {
    exportBooks: async () => ({ url: 'https://files.example/books' }),
    closeYear: async () => ({ ok: true }),
    approveRefund: async () => ({ ok: true }),
    rate: async () => ({ ok: true }),
  };
  registerActionRoutes(app, options.manifest ?? LEDGER, handlers, { verifier: options.verifier ?? ACCEPT, directUserCalls: true });
  await app.ready();
  const call = (action: string, payload: unknown = {}) =>
    app.inject({ method: 'POST', url: `/ledger/${action}`, headers: { authorization: 'Bearer x' }, payload: payload as Record<string, unknown> });
  const warnings = (event: string) =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry['event'] === event);
  return { app, call, warnings, logs: () => lines.join('') };
}

const UNPROTECTED = 'sensitive_quorum_unprotected';

describe('sensitive.quorum without a KeyCustodyProvider (AC 3, AC 4, P1-011)', () => {
  it('runs normally (200, never 202) and warns at every execution, with the domain and the action', async () => {
    const { call, warnings } = await serve();

    const first = await call('export-books', { year: '2026' });
    const second = await call('export-books', { year: '2025' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toEqual({ url: 'https://files.example/books' });
    expect(warnings(UNPROTECTED)).toEqual([
      expect.objectContaining({ level: 40, event: UNPROTECTED, domain: 'ledger', action: 'exportBooks', msg: 'action "exportBooks" is sensitive.quorum but no KeyCustodyProvider is configured: running without quorum protection' }),
      expect.objectContaining({ event: UNPROTECTED, action: 'exportBooks' }),
    ]);
  });

  it('logs only the event, the domain and the action: never the input', async () => {
    const { call, warnings, logs } = await serve();

    await call('export-books', { year: 'secret-year-2026' });

    const entry = warnings(UNPROTECTED)[0] ?? {};
    expect(Object.keys(entry).filter((key) => !['level', 'time', 'pid', 'hostname', 'reqId', 'msg'].includes(key)).sort()).toEqual(['action', 'domain', 'event']);
    assertNoSecretsLeaked(logs(), { input: 'secret-year-2026' });
  });

  it('warns when the handler fails, but not on 501 without a handler (nothing ran, review P2)', async () => {
    const failing = await serve({ handlers: { exportBooks: async () => Promise.reject(new Error('boom')) } });
    expect((await failing.call('export-books', { year: '2026' })).statusCode).toBe(500);
    expect(failing.warnings(UNPROTECTED)).toHaveLength(1);

    const missing = await serve({ handlers: {} });
    expect((await missing.call('export-books', { year: '2026' })).statusCode).toBe(501);
    expect(missing.warnings(UNPROTECTED)).toEqual([]);
  });

  it.each([
    ['400 (invalid body)', ACCEPT, { year: 2026 }, 400],
    ['401 (bad token)', { verify: async () => Promise.reject(new InvalidTokenError()) }, { year: '2026' }, 401],
    ['403 (missing permission)', { verify: async () => ({ ...USER, permissions: [] }) }, { year: '2026' }, 403],
    ['503 (verification unavailable)', { verify: async () => Promise.reject(new TokenVerificationUnavailableError('down')) }, { year: '2026' }, 503],
  ] as Array<[string, TokenVerifier, unknown, number]>)('does not warn on %s: nothing ran', async (_name, verifier, payload, status) => {
    const { call, warnings } = await serve({ verifier });

    expect((await call('export-books', payload)).statusCode).toBe(status);
    expect(warnings(UNPROTECTED)).toEqual([]);
  });

  it('does not warn for sensitive.quorum: false, approval or a public action', async () => {
    const { call, warnings } = await serve();

    expect((await call('close-year')).statusCode).toBe(200);
    expect((await call('approve-refund')).statusCode).toBe(200);
    expect((await call('rate')).statusCode).toBe(200);
    expect(warnings(UNPROTECTED)).toEqual([]);
  });

  it.each([
    ['a quorum that is not a boolean', { quorum: 'true', description: 'x' }, { requires: ['ledger:export'] }],
    ['a public quorum action', { quorum: true, description: 'x' }, { public: true }],
  ])('refuses a hand-built manifest with %s (review P3, P6)', (_name, sensitive, auth) => {
    const app = createTectonServer({ logger: false });
    servers.push(app);
    const action = LEDGER.actions[0] as TectonManifest['actions'][number];
    const manifest = { ...LEDGER, actions: [{ ...action, sensitive, auth }] } as unknown as TectonManifest;

    expect(() => registerActionRoutes(app, manifest, {}, { verifier: ACCEPT })).toThrow(/invalid sensitive.quorum.*exportBooks/);
  });

  it('warns once at startup, listing the unprotected actions', async () => {
    const { warnings } = await serve();

    expect(warnings('sensitive_quorum_unprotected_actions')).toEqual([
      expect.objectContaining({
        level: 40,
        domain: 'ledger',
        actions: ['exportBooks'],
        msg: 'sensitive.quorum actions run without quorum protection: no KeyCustodyProvider is configured',
      }),
    ]);
  });

  it('announces nothing for a registration that fails midway (review P8)', async () => {
    const { app, warnings } = await serve();
    expect(warnings('sensitive_quorum_unprotected_actions')).toHaveLength(1);

    // The same routes again on the same app: Fastify refuses the duplicate.
    expect(() => registerActionRoutes(app, LEDGER, {}, { verifier: ACCEPT })).toThrow();
    expect(warnings('sensitive_quorum_unprotected_actions')).toHaveLength(1);
  });

  it('does not warn at startup without sensitive.quorum actions', async () => {
    const plain = manifestOf(`manifestVersion: "0.1"
domain: ledger
version: 0.1.0
description: "Ledger."
actions:
  - name: rate
    description: "Public rate."
    input: {}
    output: { ok: boolean }
    auth: { public: true }
`);
    const { warnings } = await serve({ manifest: plain, handlers: {} });

    expect(warnings('sensitive_quorum_unprotected_actions')).toEqual([]);
  });

  it('works with the reference manifest (exportTenantData)', async () => {
    const manifest = loadDomainManifest(fileURLToPath(new URL('../../../docs/examples/tenant-domain-manifest-v0.yaml', import.meta.url)));
    const lines: string[] = [];
    const app = createTectonServer({
      logger: {
        level: 'warn',
        stream: new Writable({
          write(chunk, _encoding, done) {
            lines.push(chunk.toString());
            done();
          },
        }),
      },
    });
    servers.push(app);
    registerActionRoutes(app, manifest, {}, { verifier: { verify: async () => ({ ...USER, permissions: ['tenant:export'] }) }, directUserCalls: true });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/tenant/export-tenant-data',
      headers: { authorization: 'Bearer x' },
      payload: { tenantId: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5a', format: 'csv' },
    });

    expect(response.statusCode).toBe(501);
    const startup = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((entry) => entry['event'] === 'sensitive_quorum_unprotected_actions');
    expect(startup).toEqual([expect.objectContaining({ domain: 'tenant', actions: ['exportTenantData'] })]);
  });
});

describe('the rest of the framework (AC 5)', () => {
  it('describes a sensitive.quorum action in OpenAPI exactly like the same action without sensitive (no 202)', async () => {
    const withSensitive = await buildOpenApiDocument(LEDGER);
    const without = await buildOpenApiDocument({
      ...LEDGER,
      actions: LEDGER.actions.map(({ sensitive: _sensitive, ...action }) => action),
    });
    const paths = withSensitive['paths'] as Record<string, Record<string, { responses: Record<string, unknown> }>>;

    expect(withSensitive).toEqual(without);
    expect(Object.keys(paths['/ledger/export-books']?.['post']?.responses ?? {})).not.toContain('202');
  });
});

describe('a configured KeyCustodyProvider (Boss decision, T4)', () => {
  const provider: KeyCustodyProvider = {
    requestAccess: async () => ({ status: 'approved' }),
    decisionOf: async () => undefined,
  };

  it('stops registerActionRoutes before any route, with or without sensitive actions', () => {
    const app = createTectonServer({ logger: false });
    servers.push(app);
    const post = vi.spyOn(app, 'post');

    expect(() => registerActionRoutes(app, LEDGER, {}, { verifier: ACCEPT, keyCustody: provider })).toThrow(KEY_CUSTODY_NOT_SUPPORTED);
    expect(post).not.toHaveBeenCalled();
  });

  it('stops startDomainServer before the verifier and the listen, even without sensitive actions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tecton-quorum-'));
    dirs.push(dir);
    const file = join(dir, 'tecton.yaml');
    writeFileSync(file, `manifestVersion: "0.1"
domain: ledger
version: 0.1.0
description: "Ledger."
actions:
  - name: closeYear
    description: "Closes the year."
    input: {}
    output: { ok: boolean }
    auth: { requires: [ledger:export] }
`);

    // A valid environment: in the wrong order the verifier would open Valkey and the service would
    // listen, and no error would come.
    const env = { TECTON_JWKS_URL: 'http://127.0.0.1:1/auth/.well-known/jwks.json', TECTON_ENV: 'development', TECTON_VALKEY_URL: 'redis://127.0.0.1:1' };
    await expect(startDomainServer({ manifestPath: file, port: 0, env, keyCustody: provider })).rejects.toThrow(KEY_CUSTODY_NOT_SUPPORTED);
  });

  it('treats keyCustody: null from JavaScript as none (review P7)', () => {
    const app = createTectonServer({ logger: false });
    servers.push(app);

    expect(() => registerActionRoutes(app, LEDGER, {}, { verifier: ACCEPT, keyCustody: null as unknown as KeyCustodyProvider })).not.toThrow();
  });

  it('starts a domain with sensitive.quorum actions and no provider through startDomainServer (AC 5)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tecton-quorum-'));
    dirs.push(dir);
    const file = join(dir, 'tecton.yaml');
    writeFileSync(file, `manifestVersion: "0.1"
domain: ledger
version: 0.1.0
description: "Ledger."
actions:
  - name: exportBooks
    description: "Exports the books."
    input: { year: string }
    output: { url: string }
    auth: { requires: [ledger:export] }
    sensitive: { quorum: true, description: "Every entry of the year." }
`);
    const app = await startDomainServer({
      manifestPath: file,
      port: 0,
      verifier: ACCEPT,
      directUserCalls: true,
      env: { TECTON_ENV: 'development' },
      handlers: { exportBooks: () => ({ url: 'https://files.example/books' }) },
    });
    servers.push(app);

    expect((await app.inject({ method: 'POST', url: '/ledger/export-books', payload: { year: '2026' } })).statusCode).toBe(200);
  });

  it('says why in English', () => {
    expect(KEY_CUSTODY_NOT_SUPPORTED).toBe('KeyCustodyProvider is not supported yet: sensitive.quorum is not enforced at the data level (FR-11); remove keyCustody');
  });
});

describe('types shared with @tecton/providers', () => {
  it('a verified token kind is a custody requester kind', () => {
    expectTypeOf<PrincipalKind>().toEqualTypeOf<CustodyRequesterKind>();
  });
});
