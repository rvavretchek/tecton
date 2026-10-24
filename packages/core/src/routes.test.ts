import { parseManifest, type TectonManifest } from '@tecton/manifest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenVerifier } from './auth/token-verifier.js';
import { actionRoutePath, registerActionRoutes } from './routes.js';
import { createTectonServer } from './server.js';

function manifestOf(source: string): TectonManifest {
  const result = parseManifest(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.manifest;
}

const TENANT = manifestOf(`manifestVersion: "0.1"
domain: tenant
version: 1.2.0
description: "Tenants."
actions:
  - name: createTenant
    description: "Creates a tenant."
    input: { displayName: string, slug: string, ownerId: uuid }
    output: { id: uuid }
    auth: { requires: [tenant:create] }
  - name: archiveTenant
    description: "Archives a tenant."
    input: { id: uuid }
    output: {}
    auth: { requires: [tenant:archive] }
`);

const VALID_INPUT = { displayName: 'Acme', slug: 'acme', ownerId: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f' };

const servers: Array<ReturnType<typeof createTectonServer>> = [];
afterEach(async () => {
  for (const app of servers.splice(0)) await app.close();
});

/** Accepts every request as a caller with every tenant permission: these tests are not about tokens. */
const ACCEPT_ALL: TokenVerifier = {
  verify: async () => ({
    kind: 'user',
    subject: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f',
    permissions: ['tenant:create', 'tenant:archive'],
    tokenId: 'test',
    issuedAt: new Date(0),
    expiresAt: new Date(0),
  }),
};

async function serve(handlers: Parameters<typeof registerActionRoutes>[2] = {}) {
  const app = createTectonServer();
  servers.push(app);
  registerActionRoutes(app, TENANT, handlers, { verifier: ACCEPT_ALL, directUserCalls: true });
  await app.ready();
  return app;
}

describe('actionRoutePath', () => {
  it.each([
    ['tenant', 'createTenant', '/tenant/create-tenant'],
    ['leave-requests', 'approve', '/leave-requests/approve'],
    ['billing', 'exportCSVReport', '/billing/export-csv-report'],
  ])('(%s, %s) -> %s', (domain, action, path) => {
    expect(actionRoutePath(domain, action)).toBe(path);
  });
});

describe('registerActionRoutes (AC 1)', () => {
  it('Given a manifest, When routes are registered, Then each action is a POST /<domain>/<action-in-kebab-case>', async () => {
    const app = await serve();
    const routes = app.printRoutes({ commonPrefix: false });

    expect(routes).toContain('/tenant/create-tenant (POST)');
    expect(routes).toContain('/tenant/archive-tenant (POST)');
  });

  it('Given an implemented handler, When called with a valid body, Then it returns 200 with only the output fields', async () => {
    const app = await serve({
      createTenant: async (input) => ({ id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f', echoed: input, internal: 'secret' }),
    });
    const response = await app.inject({ method: 'POST', url: '/tenant/create-tenant', payload: VALID_INPUT });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f' });
  });

  it('Given a handler, When called, Then it receives the validated input', async () => {
    const handler = vi.fn(async () => ({ id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f' }));
    const app = await serve({ createTenant: handler });

    await app.inject({ method: 'POST', url: '/tenant/create-tenant', payload: VALID_INPUT });

    expect(handler).toHaveBeenCalledWith(VALID_INPUT, expect.objectContaining({ action: 'createTenant' }));
  });

  it('Given a handler, When it sets a header through the context reply, Then the header goes out with the output (Story 2.3)', async () => {
    const app = await serve({
      createTenant: async (_input, context) => {
        context.reply.header('x-handler', 'set');
        return { id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f' };
      },
    });
    const response = await app.inject({ method: 'POST', url: '/tenant/create-tenant', payload: VALID_INPUT });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-handler']).toBe('set');
    expect(response.json()).toEqual({ id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f' });
  });
});

describe('actions without input (Story 2.3 review P4)', () => {
  const PING = manifestOf(`manifestVersion: "0.1"
domain: ping
version: 1.0.0
description: "Ping."
actions:
  - name: ping
    description: "Answers."
    input: {}
    output: { ok: boolean }
    auth: { public: true }
  - name: echo
    description: "Echoes."
    input: { value: string }
    output: { ok: boolean }
    auth: { public: true }
`);

  async function ping() {
    const app = createTectonServer();
    servers.push(app);
    registerActionRoutes(app, PING, { ping: async () => ({ ok: true }), echo: async () => ({ ok: true }) });
    await app.ready();
    return app;
  }

  it('Given an action with input {}, When called with no body and no content-type, Then the handler runs with {}', async () => {
    const app = await ping();
    const response = await app.inject({ method: 'POST', url: '/ping/ping' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('Given an action with input {}, When called with {} or with a field, Then {} is 200 and the field is 400', async () => {
    const app = await ping();

    expect((await app.inject({ method: 'POST', url: '/ping/ping', payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/ping/ping', payload: { extra: 1 } })).statusCode).toBe(400);
  });

  it('Given an action with input fields, When called with no body, Then it is still 400', async () => {
    const app = await ping();

    expect((await app.inject({ method: 'POST', url: '/ping/echo' })).statusCode).toBe(400);
  });
});

describe('input validation (AC 2)', () => {
  it.each([
    ['a missing field', { displayName: 'Acme', ownerId: VALID_INPUT.ownerId }],
    ['a wrong type', { ...VALID_INPUT, slug: 42 }],
    ['an unknown field', { ...VALID_INPUT, plan: 'gold' }],
    ['an invalid uuid', { ...VALID_INPUT, ownerId: 'not-a-uuid' }],
  ])('Given a body with %s, When called, Then it is 400 before the handler runs', async (_label, payload) => {
    const handler = vi.fn();
    const app = await serve({ createTenant: handler });
    const response = await app.inject({ method: 'POST', url: '/tenant/create-tenant', payload });

    expect(response.statusCode).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      status: 400,
      slug: 'validation-failed',
      i18nKey: 'tecton.error.validationFailed',
      message: expect.any(String),
      details: expect.any(Array),
    });
  });
});

describe('not implemented (AC 3)', () => {
  it('Given no handler, When called with a valid body, Then it is 501', async () => {
    const app = await serve();
    const response = await app.inject({ method: 'POST', url: '/tenant/archive-tenant', payload: { id: VALID_INPUT.ownerId } });

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      status: 501,
      slug: 'not-implemented',
      i18nKey: 'tecton.error.notImplemented',
      message: 'action "archiveTenant" of domain "tenant" is not implemented yet',
    });
  });
});

describe('unexpected errors (AC 6)', () => {
  it('Given a handler that throws a plain error, When called, Then it is 500 without leaking the exception', async () => {
    const app = await serve({
      createTenant: async () => {
        throw new Error('connection to db-internal.local:5432 refused');
      },
    });
    const response = await app.inject({ method: 'POST', url: '/tenant/create-tenant', payload: VALID_INPUT });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      status: 500,
      slug: 'internal-error',
      i18nKey: 'tecton.error.internal',
      message: 'internal error',
    });
    expect(response.body).not.toContain('db-internal');
  });
});

describe('requests Fastify rejects before validation (review P2)', () => {
  it.each([
    ['malformed JSON', { payload: '{"displayName":', headers: { 'content-type': 'application/json' } }, 400, 'malformed-request'],
    ['an empty JSON body', { payload: '', headers: { 'content-type': 'application/json' } }, 400, 'malformed-request'],
    ['an unsupported content type', { payload: 'x', headers: { 'content-type': 'application/x-tecton' } }, 415, 'unsupported-media-type'],
  ] as const)('Given %s, When called, Then it is %i, not 500', async (_label, request, status, slug) => {
    const handler = vi.fn();
    const app = await serve({ createTenant: handler });
    const response = await app.inject({ method: 'POST', url: '/tenant/create-tenant', ...request });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ status, slug });
    expect(handler).not.toHaveBeenCalled();
  });

  it('Given a body over the size limit, When called, Then it is 413', async () => {
    const app = createTectonServer();
    servers.push(app);
    registerActionRoutes(app, TENANT, {}, { verifier: ACCEPT_ALL, directUserCalls: true });
    await app.ready();
    const response = await app.inject({
      method: 'POST',
      url: '/tenant/create-tenant',
      payload: { ...VALID_INPUT, displayName: 'x'.repeat(1_100_000) },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ status: 413, slug: 'payload-too-large' });
  });
});

describe('handler lookup (review P3, P32)', () => {
  const PROTO = manifestOf(`manifestVersion: "0.1"
domain: proto
version: 0.1.0
description: "Action names that exist on Object.prototype."
actions:
  - name: constructor
    description: "Named like an inherited member."
    input: { value: string }
    output: { value: string }
    auth: { public: true }
`);

  it('Given an action named like an Object.prototype member and no handler, When called, Then it is 501', async () => {
    const app = createTectonServer();
    servers.push(app);
    registerActionRoutes(app, PROTO, {});
    await app.ready();
    const response = await app.inject({ method: 'POST', url: '/proto/constructor', payload: { value: 'echo' } });

    expect(response.statusCode).toBe(501);
  });

  it('Given a handler key that matches no action, When registering, Then it throws naming the key', () => {
    const app = createTectonServer();
    servers.push(app);

    expect(() => registerActionRoutes(app, TENANT, { createTenat: () => ({}) })).toThrow(/createTenat/);
  });
});
