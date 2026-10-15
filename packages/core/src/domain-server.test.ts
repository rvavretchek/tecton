import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDomainManifest, startDomainServer } from './domain-server.js';

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
    const app = await startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0, host: '127.0.0.1' });
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
    });
    servers.push(app);
    const response = await app.inject({ method: 'POST', url: '/finance/close-month', payload: { month: '2026-10' } });

    expect(response.json()).toEqual({ closed: true });
  });
});

describe('startDomainServer bind address (review D2)', () => {
  it('Given no host, When started, Then it listens on loopback only', async () => {
    const app = await startDomainServer({ manifestPath: manifestFile(FINANCE), port: 0 });
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
