import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { TokenVerifier } from './auth/token-verifier.js';
import { loadDomainManifest, startDomainServer } from './domain-server.js';

const ACCEPT_ALL: TokenVerifier = {
  verify: async () => ({ kind: 'user', subject: 'test', permissions: ['finance:close'], tokenId: 'test', issuedAt: new Date(0), expiresAt: new Date(0) }),
};

const dirs: string[] = [];
const servers: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of servers.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function manifestFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tecton-domain-'));
  dirs.push(dir);
  const file = join(dir, 'tecton.yaml');
  writeFileSync(file, content);
  return file;
}

const FINANCE = `manifestVersion: "0.1"
domain: finance
version: 0.1.0
description: "Finance."
actions:
  - name: closeMonth
    description: "Closes the month."
    input: { month: string }
    output: { closed: boolean }
    auth: { requires: [finance:close] }
`;

describe('startDomainServer (walking skeleton)', () => {
  it('Given a manifest with actions, When started, Then every action route answers 501 until implemented', async () => {
    const app = await startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0, host: '127.0.0.1', verifier: ACCEPT_ALL, directUserCalls: true, env: { TECTON_ENV: 'development' } });
    servers.push(app);
    const response = await app.inject({ method: 'POST', url: '/finance/close-month', payload: { month: '2026-10' } });

    expect(response.statusCode).toBe(501);
    expect(app.server.listening).toBe(true);
  });

  it('Given handlers, When started, Then implemented actions answer normally', async () => {
    const app = await startDomainServer({
      manifestPath: manifestFile(FINANCE),
      port: 0,
      host: '127.0.0.1',
      handlers: { closeMonth: () => ({ closed: true }) },
      verifier: ACCEPT_ALL,
      directUserCalls: true,
      env: { TECTON_ENV: 'development' },
    });
    servers.push(app);
    const response = await app.inject({ method: 'POST', url: '/finance/close-month', payload: { month: '2026-10' } });

    expect(response.json()).toEqual({ closed: true });
  });
});

describe('startDomainServer token verification (Story 2.4)', () => {
  it('Given a protected action and no verifier, When TECTON_JWKS_URL is missing, Then startup fails naming it', async () => {
    await expect(startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0, env: {} })).rejects.toThrow(/^TECTON_JWKS_URL is not set/);
  });

  it('Given an http JWKS URL outside development mode, When started, Then startup fails', async () => {
    const env = { TECTON_JWKS_URL: 'http://127.0.0.1:3000/auth/.well-known/jwks.json' };

    await expect(startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0, env })).rejects.toThrow(/https outside development mode/);
  });

  it('Given the verifier from the environment, When called without a token, Then it is 401', async () => {
    const env = { TECTON_JWKS_URL: 'http://127.0.0.1:1/auth/.well-known/jwks.json', TECTON_ENV: 'development', TECTON_VALKEY_URL: 'redis://127.0.0.1:1' };
    const app = await startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0, env });
    servers.push(app);

    expect((await app.inject({ method: 'POST', url: '/finance/close-month', payload: { month: '2026-10' } })).statusCode).toBe(401);
  });

  it('Given a protected action, When TECTON_VALKEY_URL is missing, Then startup fails naming it (Story 2.5, AC 7)', async () => {
    const env = { TECTON_JWKS_URL: 'http://127.0.0.1:1/auth/.well-known/jwks.json', TECTON_ENV: 'development' };

    await expect(startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0, env })).rejects.toThrow(/^TECTON_VALKEY_URL is not set/);
  });

  it('Given only public actions, When started without any token configuration, Then it starts', async () => {
    const PUBLIC = FINANCE.replace('auth: { requires: [finance:close] }', 'auth: { public: true }');
    const app = await startDomainServer({ manifestPath: manifestFile(PUBLIC), port: 0, env: {} });
    servers.push(app);

    expect((await app.inject({ method: 'POST', url: '/finance/close-month', payload: { month: '2026-10' } })).statusCode).toBe(501);
  });
});

describe('startDomainServer revocation store (Story 2.5 review)', () => {
  it('logs connection problems of its revocation store, without the URL password (P3)', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const env = { TECTON_JWKS_URL: 'http://127.0.0.1:1/auth/.well-known/jwks.json', TECTON_ENV: 'development', TECTON_VALKEY_URL: 'redis://:s3cret@127.0.0.1:1' };
    const app = await startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0, env, logger: { level: 'warn', stream } });
    servers.push(app);

    const deadline = Date.now() + 10_000;
    while (!lines.join('').includes('revocation store connection error') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lines.join('')).toContain('revocation store connection error');
    expect(lines.join('')).not.toContain('s3cret');
  });

  it('closes everything it opened when startup fails after the verifier was built (P14)', async () => {
    const env = { TECTON_JWKS_URL: 'http://127.0.0.1:1/auth/.well-known/jwks.json', TECTON_ENV: 'development', TECTON_VALKEY_URL: 'redis://127.0.0.1:1' };
    const busy = await startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0, env });
    servers.push(busy);
    const address = busy.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    await expect(startDomainServer({ manifestPath: manifestFile(FINANCE), port, env })).rejects.toThrow(/EADDRINUSE/);
  });
});

describe('startDomainServer bind address (review D2)', () => {
  it('Given no host, When started, Then it listens on loopback only', async () => {
    const app = await startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0, verifier: ACCEPT_ALL, directUserCalls: true, env: { TECTON_ENV: 'development' } });
    servers.push(app);
    const address = app.server.address();

    expect(typeof address === 'object' && address?.address).toBe('127.0.0.1');
  });
});

describe('loadDomainManifest', () => {
  it('Given an invalid manifest, When loaded, Then it throws listing every problem with its line', () => {
    const file = manifestFile('manifestVersion: "0.1"\ndomain: Finance\nversion: "1.0"\ndescription: "x"\n');

    expect(() => loadDomainManifest(file)).toThrow(/invalid manifest .*tecton\.yaml[\s\S]*line 2: domain[\s\S]*line 3: version/);
  });
});

describe('user tokens alone (Story 2.7b, AD-7 amendment of 2026-10-24)', () => {
  async function started(options: { env: NodeJS.ProcessEnv; directUserCalls?: boolean }) {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const app = await startDomainServer({
      manifestPath: manifestFile(FINANCE),
      port: 0,
      verifier: ACCEPT_ALL,
      handlers: { closeMonth: () => ({ closed: true }) },
      logger: { level: 'warn', stream },
      ...options,
    });
    servers.push(app);
    const status = (await app.inject({ method: 'POST', url: '/finance/close-month', payload: { month: '2026-10' } })).statusCode;
    return { status, logs: lines.join('') };
  }

  it('refuses them outside development, without the warning', async () => {
    const { status, logs } = await started({ env: {} });

    expect(status).toBe(401);
    expect(logs).not.toContain('direct_user_calls_enabled');
  });

  it('accepts them with TECTON_ENV=development and warns at startup', async () => {
    const { status, logs } = await started({ env: { TECTON_ENV: 'development' } });

    expect(status).toBe(200);
    expect(logs).toContain('"event":"direct_user_calls_enabled"');
  });

  it('turns them off in development with directUserCalls: false', async () => {
    expect((await started({ env: { TECTON_ENV: 'development' }, directUserCalls: false })).status).toBe(401);
  });

  it('refuses to start with directUserCalls: true outside development (review P1)', async () => {
    await expect(started({ env: {}, directUserCalls: true })).rejects.toThrow(/directUserCalls is allowed only with TECTON_ENV=development/);
  });
});
