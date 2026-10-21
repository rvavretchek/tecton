import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest } from '@tecton/manifest';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../cli.js';

const frameworkRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function cli(args: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = await run(args, {
    cwd,
    stdout: { write: (text: string) => void (stdout += text) },
    stderr: { write: (text: string) => void (stderr += text) },
  });
  return { code, stdout, stderr };
}

/** A fresh workspace created by `tecton-admin new` (optionally linked to this checkout). */
async function workspace(linked = false): Promise<string> {
  const parent = mkdtempSync(join(tmpdir(), 'tecton-gen-'));
  created.push(parent);
  const args = ['new', 'acme', ...(linked ? ['--framework', frameworkRoot] : [])];
  expect((await cli(args, parent)).code).toBe(0);
  return join(parent, 'acme');
}

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
const domains = (root: string) => readdirSync(join(root, 'apps', 'domains')).filter((entry) => !entry.startsWith('.')).sort();

describe('tecton-admin generate domain (AC 1)', () => {
  it('creates every domain with a valid tecton.yaml and package.json, and lint passes right away', async () => {
    const root = await workspace();
    const result = await cli(['generate', 'domain', 'finance', 'inventory', 'sales'], root);

    expect(result.code).toBe(0);
    expect(domains(root)).toEqual(['finance', 'inventory', 'sales']);

    const parsed = parseManifest(readFileSync(join(root, 'apps', 'domains', 'finance', 'tecton.yaml'), 'utf8'));
    expect(parsed.ok && parsed.manifest).toMatchObject({
      manifestVersion: '0.1',
      domain: 'finance',
      version: '0.1.0',
      actions: [],
      events: { publishes: [], consumes: [] },
      dependencies: [],
    });
    expect(readJson(join(root, 'apps', 'domains', 'finance', 'package.json'))['name']).toBe('@acme/finance');

    const lint = await cli(['lint'], root);
    expect(lint.code, lint.stdout).toBe(0);
  });

  it('declares @tecton/* the same way as the workspace: version, or link to the same checkout', async () => {
    const versioned = await workspace();
    await cli(['generate', 'domain', 'finance'], versioned);
    const versionedDeps = readJson(join(versioned, 'apps', 'domains', 'finance', 'package.json'))['dependencies'];
    expect(versionedDeps['@tecton/core']).toMatch(/^\^\d+\.\d+\.\d+$/);

    const linked = await workspace(true);
    await cli(['generate', 'domain', 'finance'], linked);
    const domainDir = join(linked, 'apps', 'domains', 'finance');
    const linkedDeps = readJson(join(domainDir, 'package.json'))['dependencies'];
    expect(linkedDeps['@tecton/core']).toMatch(/^link:/);
    expect(existsSync(join(domainDir, (linkedDeps['@tecton/core'] as string).slice('link:'.length), 'package.json'))).toBe(true);
  });

  it('works from a subdirectory of the workspace', async () => {
    const root = await workspace();

    expect((await cli(['generate', 'domain', 'finance'], join(root, 'apps', 'domains'))).code).toBe(0);
    expect(domains(root)).toEqual(['finance']);
  });
});

describe('tecton-admin generate domain --from (AC 2)', () => {
  it('reads one name per line, ignoring blank lines and # comments', async () => {
    const root = await workspace();
    writeFileSync(join(root, 'domains.txt'), '# core domains\nfinance\n\n  inventory  \n# later: sales\n');

    expect((await cli(['generate', 'domain', '--from', 'domains.txt'], root)).code).toBe(0);
    expect(domains(root)).toEqual(['finance', 'inventory']);
  });
});

describe('tecton-admin generate domain — all or nothing (AC 3)', () => {
  it('creates nothing and lists every bad name', async () => {
    const root = await workspace();
    await cli(['generate', 'domain', 'billing'], root);
    const result = await cli(['generate', 'domain', 'finance', 'Bad_Name', 'billing', 'finance'], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no domain was created');
    expect(result.stderr).toContain('"Bad_Name" is not kebab-case');
    expect(result.stderr).toContain('"billing" already exists');
    expect(result.stderr).toContain('"finance" is listed more than once');
    expect(domains(root)).toEqual(['billing']);
  });
});

describe('tecton-admin generate domain — outside a workspace (AC 4)', () => {
  it('fails pointing to tecton-admin new', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tecton-nows-'));
    created.push(dir);
    mkdirSync(join(dir, 'x'));
    const result = await cli(['generate', 'domain', 'finance'], join(dir, 'x'));

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('tecton-admin new');
    expect(existsSync(join(dir, 'x', 'apps'))).toBe(false);
  });
});

describe('tecton-admin generate domain — walking skeleton and reminder (AC 5, AC 6)', () => {
  it('generates a runnable service entry point and tsconfig', async () => {
    const root = await workspace();
    await cli(['generate', 'domain', 'finance'], root);
    const dir = join(root, 'apps', 'domains', 'finance');

    expect(readFileSync(join(dir, 'src', 'main.ts'), 'utf8')).toContain('startDomainServer');
    expect(readJson(join(dir, 'package.json'))['scripts']).toEqual({ build: 'tsc -p tsconfig.json', start: 'node --env-file-if-exists=../../../.env --env-file-if-exists=.env dist/main.js' });
    expect(readJson(join(dir, 'tsconfig.json'))['extends']).toBe('../../../tsconfig.base.json');
  });

  it('reminds the agent to update the AGENTS.md domains section', async () => {
    const root = await workspace();
    const result = await cli(['generate', 'domain', 'finance'], root);

    expect(result.stdout).toContain('update the domains section of AGENTS.md');
    expect(result.stdout).toContain('<!-- tecton:domains:start -->');
  });

  it('Given AGENTS.md not yet updated, When linted, Then a divergence warning appears (also in JSON) without failing (AC 7)', async () => {
    const root = await workspace();
    await cli(['generate', 'domain', 'finance'], root);

    const text = await cli(['lint'], root);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('AGENTS.md:');
    expect(text.stdout).toContain('agents-md-divergence');

    const json = JSON.parse((await cli(['lint', '--format', 'json'], root)).stdout) as { errors: number; problems: Array<Record<string, unknown>> };
    expect(json.errors).toBe(0);
    expect(json.problems).toEqual([
      expect.objectContaining({ file: 'AGENTS.md', severity: 'warning', code: 'agents-md-divergence', message: expect.stringContaining('"finance"') }),
    ]);
  });

  it('prints help in English with examples', async () => {
    const result = await cli(['generate', 'domain', '--help'], await workspace());

    expect(result.stdout).toContain('$ tecton-admin generate domain finance inventory sales');
    expect(result.stdout).toMatch(/^[\x09\x0A\x0D\x20-\x7E]+$/);
  });
});

describe('tecton-admin generate domain — code review fixes', () => {
  it('pins @tecton/* to the version range the workspace uses for @tecton/cli, not the running CLI', async () => {
    const root = await workspace();
    const pkgFile = join(root, 'package.json');
    const pkg = readJson(pkgFile);
    pkg['devDependencies']['@tecton/cli'] = '~7.3.0';
    writeFileSync(pkgFile, JSON.stringify(pkg));

    expect((await cli(['generate', 'domain', 'finance'], root)).code).toBe(0);
    expect(readJson(join(root, 'apps', 'domains', 'finance', 'package.json'))['dependencies']['@tecton/core']).toBe('~7.3.0');
  });

  it('uses a scoped workspace name as a valid package scope and Compose project name', async () => {
    const root = await workspace();
    const pkgFile = join(root, 'package.json');
    writeFileSync(pkgFile, JSON.stringify({ ...readJson(pkgFile), name: '@Acme/Platform' }));

    expect((await cli(['generate', 'domain', 'finance'], root)).code).toBe(0);
    expect(readJson(join(root, 'apps', 'domains', 'finance', 'package.json'))['name']).toBe('@acme-platform/finance');
    expect(readFileSync(join(root, 'docker-compose.dev.yml'), 'utf8')).toContain('name: acme-platform-dev');
  });

  it.each(['postgres', 'mysql', 'sys', 'information-schema', 'tecton'])('refuses "%s", a reserved database name', async (name) => {
    const root = await workspace();
    const result = await cli(['generate', 'domain', 'finance', name], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('reserved database name');
    expect(domains(root)).toEqual([]);
  });

  it('reads a --from file saved with a UTF-8 byte order mark', async () => {
    const root = await workspace();
    writeFileSync(join(root, 'domains.txt'), `${String.fromCodePoint(0xfeff)}finance\nsales\n`);

    expect((await cli(['generate', 'domain', '--from', 'domains.txt'], root)).code).toBe(0);
    expect(domains(root)).toEqual(['finance', 'sales']);
  });

  it('fails cleanly when --from points to a directory', async () => {
    const root = await workspace();
    mkdirSync(join(root, 'names'));
    const result = await cli(['generate', 'domain', '--from', 'names'], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('is not a file');
  });

  it('reports a malformed package.json in one line, without a stack trace', async () => {
    const root = await workspace();
    writeFileSync(join(root, 'package.json'), '{ "name": "acme", ');
    const result = await cli(['generate', 'domain', 'finance'], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^error: cannot read .*package\.json/);
    expect(result.stderr).not.toContain('    at ');
  });

  it('rejects an unknown Dev Services engine in package.json instead of falling back to postgres', async () => {
    const root = await workspace();
    const pkgFile = join(root, 'package.json');
    writeFileSync(pkgFile, JSON.stringify({ ...readJson(pkgFile), tecton: { devServices: { database: 'oracle' } } }));
    const result = await cli(['generate', 'domain', 'finance'], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('"oracle"');
    expect(domains(root)).toEqual([]);
  });

  it('rejects a domain folder whose manifest declares another domain', async () => {
    const root = await workspace();
    expect((await cli(['generate', 'domain', 'finance'], root)).code).toBe(0);
    const manifest = join(root, 'apps', 'domains', 'finance', 'tecton.yaml');
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('domain: finance', 'domain: billing'));
    const result = await cli(['generate', 'domain', 'sales'], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('declares domain "billing"');
    expect(domains(root)).toEqual(['finance']);
  });
});

describe('tecton-admin generate domain — ready-made services (Story 2.2b)', () => {
  it('refuses "auth", which the framework already provides as apps/auth', async () => {
    const root = await workspace();
    const result = await cli(['generate', 'domain', 'auth'], root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ready-made service');
    expect(domains(root)).toEqual([]);
  });
});
