import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../cli.js';

const frameworkRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tecton-new-'));
  created.push(dir);
  return dir;
}

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

function absoluteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? absoluteFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function filesUnder(dir: string): string[] {
  return absoluteFiles(dir).map((file) => relative(dir, file).split(sep).join('/'));
}

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;

describe('tecton-admin new — workspace (AC 1, AC 2)', () => {
  it('creates a pnpm + Turborepo workspace with build/dev tasks, base tsconfig and an empty apps/domains', async () => {
    const cwd = tempDir();
    const result = await cli(['new', 'acme-platform'], cwd);
    const root = join(cwd, 'acme-platform');

    expect(result.code).toBe(0);
    expect(filesUnder(root).sort()).toEqual(
      [
        '.gitignore',
        '.node-version',
        'AGENTS.md',
        'CLAUDE.md',
        'README.md',
        'apps/domains/.gitkeep',
        'package.json',
        'pnpm-workspace.yaml',
        'tsconfig.base.json',
        'turbo.json',
      ].sort(),
    );
    expect(readJson(join(root, 'turbo.json'))['tasks']).toHaveProperty('build');
    expect(readJson(join(root, 'turbo.json'))['tasks']).toHaveProperty('dev');
    expect(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).toContain("'apps/domains/*'");
    expect(result.stdout).toContain('pnpm install');
  });

  it('declares @tecton/* as versioned dependencies and copies no framework source (AD-4)', async () => {
    const cwd = tempDir();
    await cli(['new', 'acme'], cwd);
    const root = join(cwd, 'acme');
    const pkg = readJson(join(root, 'package.json'));
    const cliVersion = (readJson(join(frameworkRoot, 'packages', 'cli', 'package.json')) as { version: string }).version;

    expect(pkg['name']).toBe('acme');
    expect(pkg['devDependencies']['@tecton/cli']).toBe(`^${cliVersion}`);
    expect(pkg['devDependencies']['turbo']).toMatch(/^\^2\./);
    expect(filesUnder(root).filter((file) => file.endsWith('.ts') || file.startsWith('packages/'))).toEqual([]);
    expect(filesUnder(root).join('\n')).not.toContain('{{');
  });
});

describe('tecton-admin new — local framework checkout (AC 3)', () => {
  it('links @tecton/* to the checkout with pnpm link:, never copying', async () => {
    const cwd = tempDir();
    const result = await cli(['new', 'acme', '--framework', frameworkRoot], cwd);
    const spec = readJson(join(cwd, 'acme', 'package.json'))['devDependencies']['@tecton/cli'] as string;

    expect(result.code).toBe(0);
    expect(spec).toMatch(/^link:/);
    expect(existsSync(join(cwd, 'acme', spec.slice('link:'.length), 'package.json'))).toBe(true);
    expect(existsSync(join(cwd, 'acme', 'packages'))).toBe(false);
  });

  it('rejects a path that is not a framework checkout', async () => {
    const cwd = tempDir();
    const result = await cli(['new', 'acme', '--framework', cwd], cwd);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('is not a Tecton framework checkout');
    expect(existsSync(join(cwd, 'acme'))).toBe(false);
  });
});

describe('tecton-admin new — guards (AC 4, AC 5)', () => {
  it('fails without writing anything when the target exists and is not empty', async () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, 'acme'));
    writeFileSync(join(cwd, 'acme', 'keep.txt'), 'mine');
    const result = await cli(['new', 'acme'], cwd);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('already exists and is not empty');
    expect(readdirSync(join(cwd, 'acme'))).toEqual(['keep.txt']);
  });

  it('accepts an existing empty directory', async () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, 'acme'));

    expect((await cli(['new', 'acme'], cwd)).code).toBe(0);
  });

  it.each(['Acme', 'acme_platform', '1acme', 'acme-'])('rejects "%s" and explains the expected format', async (name) => {
    const cwd = tempDir();
    const result = await cli(['new', name], cwd);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('use kebab-case');
    expect(readdirSync(cwd)).toEqual([]);
  });
});

describe('tecton-admin new — help (AC 6)', () => {
  it('prints help in English with an example', async () => {
    const result = await cli(['new', '--help'], tempDir());

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Create a Tecton workspace');
    expect(result.stdout).toContain('$ tecton-admin new acme-platform');
    expect(result.stdout).toMatch(/^[\x09\x0A\x0D\x20-\x7E]+$/);
  });
});

describe('tecton-admin new — documentation seeds (AC 7, AC 8, AC 9)', () => {
  it('creates English seeds of AGENTS.md and README.md that point to the guide, and a CLAUDE.md pointer', async () => {
    const cwd = tempDir();
    await cli(['new', 'acme'], cwd);
    const root = join(cwd, 'acme');
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    const readme = readFileSync(join(root, 'README.md'), 'utf8');

    for (const seed of [agents, readme]) {
      expect(seed).toContain('not been written yet');
      expect(seed).toContain('node_modules/@tecton/cli/docs/agents-guide.md');
      expect(seed).toMatch(/^[\x09\x0A\x0D\x20-\x7E]+$/);
    }
    expect(agents).toContain('<!-- tecton:domains:start -->');
    expect(readme).toContain('interview the developer');
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8').trim()).toBe(
      'See [AGENTS.md](AGENTS.md). It is the single source of instructions for AI agents in this workspace.',
    );
  });

  it('ships an English agents guide with the required sections', () => {
    const guide = readFileSync(join(frameworkRoot, 'packages', 'cli', 'docs', 'agents-guide.md'), 'utf8');

    expect(guide).toContain('<!-- tecton:domains:start -->');
    expect(guide).toContain("Never read or write another domain's database");
    expect(guide).toContain('Never edit the code of `@tecton/*` packages');
    expect(guide).toContain('Never turn off token verification');
    expect(guide).toContain('extended, never removed or');
    expect(guide).toContain('pull');
    expect(guide).toContain('written and maintained **by agents only**');
    expect(guide).toContain('language the developer chooses');
    expect(guide).toContain('preserve as much existing content as possible');
    expect(guide).toContain('No part of either file is locked against editing');
    expect(guide).toContain('interview the developer');
    expect(guide).toMatch(/^[\x09\x0A\x0D\x20-\x7E]+$/);
  });

  it('ships the templates and docs with the package', () => {
    const files = (readJson(join(frameworkRoot, 'packages', 'cli', 'package.json'))['files'] as string[]).sort();

    expect(files).toEqual(['dist', 'docs', 'templates']);
  });
});
