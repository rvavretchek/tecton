import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../cli.js';

// Slow (network + install): runs with `pnpm test:generation`, in the nightly workflow.
const frameworkRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const cwd = mkdtempSync(join(tmpdir(), 'tecton-generation-'));

afterAll(() => rmSync(cwd, { recursive: true, force: true }));

/** Runs a fixed pnpm command (no user input; the shell is needed for pnpm.cmd on Windows). */
function pnpm(args: string[], dir: string) {
  const result = spawnSync(`pnpm ${args.join(' ')}`, { cwd: dir, encoding: 'utf8', shell: true, timeout: 600_000 });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

describe('tecton-admin new — generated workspace installs and builds (AC 1, AC 3)', () => {
  it('Given a workspace linked to this checkout, When pnpm install and turbo run build run, Then both succeed', async () => {
    const io = { cwd, stdout: { write: () => undefined }, stderr: { write: () => undefined } };
    expect(await run(['new', 'acme-platform', '--framework', frameworkRoot], io)).toBe(0);
    const workspace = join(cwd, 'acme-platform');

    const install = pnpm(['install'], workspace);
    expect(install.status, install.output).toBe(0);

    const build = pnpm(['exec', 'turbo', 'run', 'build'], workspace);
    expect(build.status, build.output).toBe(0);
  }, 900_000);
});

describe('tecton-admin generate domain — walking skeleton runs (Story 1.10, AC 5)', () => {
  it('Given a generated domain with one action, When built and started, Then the action answers 501', async () => {
    const io = { cwd, stdout: { write: () => undefined }, stderr: { write: () => undefined } };
    expect(await run(['new', 'skeleton', '--framework', frameworkRoot], io)).toBe(0);
    const workspace = join(cwd, 'skeleton');
    expect(await run(['generate', 'domain', 'finance'], { ...io, cwd: workspace })).toBe(0);

    const domainDir = join(workspace, 'apps', 'domains', 'finance');
    const manifestFile = join(domainDir, 'tecton.yaml');
    writeFileSync(
      manifestFile,
      readFileSync(manifestFile, 'utf8').replace(
        'actions: []',
        'actions:\n  - name: closeMonth\n    description: "Closes the month."\n    input: { month: string }\n    output: { closed: boolean }\n    auth: { requires: [finance:close] }',
      ),
    );

    // The domain depends on the Auth service: the lint resolves it through apps/auth's @tecton/auth.
    writeFileSync(manifestFile, readFileSync(manifestFile, 'utf8').replace('dependencies: []', 'dependencies: [auth]'));

    const install = pnpm(['install'], workspace);
    expect(install.status, install.output).toBe(0);
    const build = pnpm(['exec', 'turbo', 'run', 'build'], workspace);
    expect(build.status, build.output).toBe(0);
    let lintOutput = '';
    const lintIo = { cwd: workspace, stdout: { write: (text: string) => void (lintOutput += text) }, stderr: { write: (text: string) => void (lintOutput += text) } };
    expect(await run(['lint'], lintIo), lintOutput).toBe(0);

    // apps/auth starts from the workspace .env, as its start script does (review P5 of 2.2b).
    // The database is never reached: the JWKS needs none, and Prisma connects lazily.
    const authPort = await freePort();
    const signingKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    writeFileSync(
      join(workspace, '.env'),
      [
        'TECTON_AUTH_DATABASE_URL=postgresql://tecton:tecton@127.0.0.1:1/auth',
        'TECTON_AUTH_PEPPER=generation-test-pepper-with-32-bytes!',
        `TECTON_AUTH_SIGNING_KEY="${signingKey.trimEnd().split('\n').join('\\n')}"`,
        `PORT=${authPort}`,
        '',
      ].join('\n'),
    );
    const authDir = join(workspace, 'apps', 'auth');
    const authScripts = JSON.parse(readFileSync(join(authDir, 'package.json'), 'utf8')) as { scripts: { start: string } };
    expect(authScripts.scripts.start).toBe('node --env-file-if-exists=../../.env dist/main.js');
    const authService = spawn(process.execPath, ['--env-file-if-exists=../../.env', 'dist/main.js'], { cwd: authDir, env: { ...process.env } });
    try {
      const jwks = await waitForGet(`http://127.0.0.1:${authPort}/auth/.well-known/jwks.json`);
      expect(jwks.status).toBe(200);
      expect(((await jwks.json()) as { keys: unknown[] }).keys).toHaveLength(1);
    } finally {
      authService.kill();
    }

    const port = await freePort();
    // Same command as the package "start" script, run directly so the test can stop it reliably.
    const service = spawn(process.execPath, ['dist/main.js'], { cwd: domainDir, env: { ...process.env, PORT: String(port) } });
    try {
      const response = await waitForResponse(`http://127.0.0.1:${port}/finance/close-month`, { month: '2026-10' });
      expect(response.status).toBe(501);
    } finally {
      service.kill();
    }
  }, 900_000);
});

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/** POSTs until the service answers (it takes a moment to start); fails after 30 s. */
async function waitForResponse(url: string, body: unknown): Promise<Response> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
}

async function waitForGet(url: string): Promise<Response> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await fetch(url);
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
}

describe('@tecton/auth packed for publishing (Story 2.2b, deferred W3 of 2.2a)', () => {
  it('ships the compiled generated clients, the Prisma schemas and migrations, and the manifest, but no source', () => {
    // The file list pnpm would publish (same rules as the real tarball), without extracting it.
    const result = spawnSync('pnpm pack --dry-run --json', {
      cwd: join(frameworkRoot, 'packages', 'auth'),
      encoding: 'utf8',
      shell: true,
      timeout: 300_000,
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    const start = result.stdout.indexOf('{');
    expect(start, `no JSON in the pnpm pack output: ${result.stdout}`).toBeGreaterThanOrEqual(0);
    const json = result.stdout.slice(start);
    const files = (JSON.parse(json) as { files: Array<{ path: string }> }).files.map((file) => file.path);

    for (const expected of [
      'dist/index.js',
      'dist/generated/postgresql/client.js',
      'dist/generated/mysql/client.js',
      'prisma/postgresql/schema.prisma',
      'prisma/postgresql/prisma.config.ts',
      'prisma/postgresql/migrations/0001_init/migration.sql',
      'prisma/mysql/migrations/0001_init/migration.sql',
      'prisma/mysql/schema.prisma',
      'prisma/mysql/prisma.config.ts',
      'tecton.yaml',
      'README.md',
    ]) {
      expect(files, expected).toContain(expected);
    }
    expect(files.filter((file) => file.startsWith('src/') || file.endsWith('.tsbuildinfo') || file.endsWith('.map'))).toEqual([]);
  }, 300_000);
});
