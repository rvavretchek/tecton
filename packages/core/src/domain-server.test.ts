import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { TokenVerifier } from './auth/token-verifier.js';
import { loadDomainManifest, startDomainServer } from './domain-server.js';

const ACCEPT_ALL: TokenVerifier = {
  verify: async () => ({ subject: 'test', permissions: ['finance:close'], tokenId: 'test', issuedAt: new Date(0), expiresAt: new Date(0) }),
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
    const app = await startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0, host: '127.0.0.1', verifier: ACCEPT_ALL });
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
    const env = { TECTON_JWKS_URL: 'http://127.0.0.1:1/auth/.well-known/jwks.json', TECTON_ENV: 'development' };
    const app = await startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0, env });
    servers.push(app);

    expect((await app.inject({ method: 'POST', url: '/finance/close-month', payload: { month: '2026-10' } })).statusCode).toBe(401);
  });

  it('Given only public actions, When started without any token configuration, Then it starts', async () => {
    const PUBLIC = FINANCE.replace('auth: { requires: [finance:close] }', 'auth: { public: true }');
    const app = await startDomainServer({ manifestPath: manifestFile(PUBLIC), port: 0, env: {} });
    servers.push(app);

    expect((await app.inject({ method: 'POST', url: '/finance/close-month', payload: { month: '2026-10' } })).statusCode).toBe(501);
  });
});

describe('startDomainServer bind address (review D2)', () => {
  it('Given no host, When started, Then it listens on loopback only', async () => {
    const app = await startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0, verifier: ACCEPT_ALL });
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
