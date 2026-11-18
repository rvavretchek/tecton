import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { TokenVerifier } from './auth/token-verifier.js';
import { startDomainServer } from './domain-server.js';
import { createTectonServer, LOG_REDACTION } from './server.js';

// Epic 2 integration review: one log policy for every service.

const dirs: string[] = [];
const servers: Array<ReturnType<typeof createTectonServer>> = [];

afterEach(async () => {
  for (const app of servers.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { stream, logs: () => lines.join('') };
}

class DriverError extends Error {
  override readonly name = 'DriverError';
  readonly code = 'P1001';
}

describe('unexpected errors in the log', () => {
  it('log the full error by default (domains)', async () => {
    const { stream, logs } = capture();
    const app = createTectonServer({ logger: { level: 'error', stream } });
    servers.push(app);
    app.get('/boom', async () => Promise.reject(new DriverError('postgresql://user:db-secret-123@db/auth unreachable')));

    expect((await app.inject({ method: 'GET', url: '/boom' })).statusCode).toBe(500);
    expect(logs()).toContain('db-secret-123');
  });

  it('log only the name and the code with safeErrorLogs (the Auth service)', async () => {
    const { stream, logs } = capture();
    const app = createTectonServer({ logger: { level: 'error', stream }, safeErrorLogs: true });
    servers.push(app);
    app.get('/boom', async () => Promise.reject(new DriverError('postgresql://user:db-secret-123@db/auth unreachable')));

    expect((await app.inject({ method: 'GET', url: '/boom' })).statusCode).toBe(500);
    expect(logs()).toContain('"err":{"type":"DriverError","code":"P1001"}');
    expect(logs()).not.toContain('db-secret-123');
  });
});

describe('redaction of both credentials of a call', () => {
  it('lists Authorization, Tecton-On-Behalf-Of, cookies and set-cookie', () => {
    expect(LOG_REDACTION).toEqual(['req.headers.authorization', 'req.headers.cookie', 'req.headers["tecton-on-behalf-of"]', 'res.headers["set-cookie"]']);
  });

  it('is applied by startDomainServer to a logger object without its own redact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tecton-logging-'));
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
    auth: { requires: [ledger:close] }
`);
    const { stream, logs } = capture();
    const verifier: TokenVerifier = {
      verify: async () => ({ kind: 'service', subject: 'service:billing', permissions: ['call:ledger', 'ledger:close'], tokenId: 't', issuedAt: new Date(0), expiresAt: new Date(0) }),
    };
    const app = await startDomainServer({
      manifestPath: file,
      port: 0,
      verifier,
      env: {},
      handlers: { closeYear: () => ({ ok: true }) },
      // A logger that logs every request header: the redaction list must still hide the tokens.
      logger: { level: 'info', stream, serializers: { req: (request: { headers: unknown }) => ({ headers: request.headers }) } },
    });
    servers.push(app);

    await app.inject({ method: 'POST', url: '/ledger/close-year', headers: { authorization: 'Bearer service-token-value', 'tecton-on-behalf-of': 'user-token-value' }, payload: {} });

    expect(logs()).toContain('[Redacted]');
    expect(logs()).not.toContain('service-token-value');
    expect(logs()).not.toContain('user-token-value');
  });
});
