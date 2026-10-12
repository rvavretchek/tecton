import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from './cli.js';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tecton-cli-'));
  created.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
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

const manifest = (domain: string, extra = '') =>
  `manifestVersion: "0.1"\ndomain: ${domain}\nversion: 1.0.0\ndescription: "The ${domain} domain."\n${extra}`;

describe('tecton-admin lint', () => {
  it('Given valid manifests, When linted, Then it exits 0 and prints a summary', async () => {
    const result = await cli(['lint'], workspace({ 'leave/tecton.yaml': manifest('leave') }));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('0 errors, 0 warnings in 1 manifest');
  });

  it('Given an error, When linted, Then it exits 1 and prints file, line, column, code, path and message', async () => {
    const result = await cli(['lint'], workspace({ 'leave/tecton.yaml': manifest('Leave') }));

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^leave\/tecton\.yaml:2:9 {2}error {2}invalid-format {2}domain {2}domain must be kebab-case/m);
    expect(result.stdout).toContain('1 error, 0 warnings in 1 manifest');
  });

  it('Given only warnings, When linted, Then it exits 0', async () => {
    const cwd = workspace({
      'auth/tecton.yaml': manifest('auth', 'dependencies: [directory]\n'),
      'directory/tecton.yaml': manifest('directory', 'dependencies: [auth]\n'),
    });
    const result = await cli(['lint'], cwd);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('warning  dependency-cycle');
  });

  it('Given --format json, When linted, Then the output is structured JSON for agents', async () => {
    const result = await cli(['lint', '--format', 'json'], workspace({ 'leave/tecton.yaml': manifest('Leave') }));
    const report = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.code).toBe(1);
    expect(report).toEqual({
      manifests: 1,
      errors: 1,
      warnings: 0,
      problems: [expect.objectContaining({ file: 'leave/tecton.yaml', line: 2, column: 9, path: 'domain', code: 'invalid-format', severity: 'error' })],
    });
  });

  it('Given --cwd, When linted, Then it lints that directory', async () => {
    const outer = workspace({ 'inner/leave/tecton.yaml': manifest('leave') });
    const result = await cli(['lint', '--cwd', 'inner'], outer);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('in 1 manifest');
  });

  it('Given explicit paths, When linted, Then files of any name and directories are linted together', async () => {
    const cwd = workspace({
      'examples/tenant-domain-manifest-v0.yaml': manifest('tenant', 'dependencies: [user]\n'),
      'stubs/user/tecton.yaml': manifest('user'),
      'other/tecton.yaml': manifest('Ignored'),
    });
    const result = await cli(['lint', 'examples/tenant-domain-manifest-v0.yaml', 'stubs'], cwd);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('in 2 manifests');
  });

  it('Given a path that does not exist, When linted, Then it fails naming the path', async () => {
    const result = await cli(['lint', 'missing'], workspace({ 'leave/tecton.yaml': manifest('leave') }));

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('path not found: missing');
  });

  it('Given no manifest, When linted, Then it fails with a clear message', async () => {
    const cwd = workspace({ 'README.md': '# nothing' });
    const result = await cli(['lint'], cwd);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no tecton.yaml found under');
  });

  it('Given an unsupported --format, When run, Then it fails without linting', async () => {
    const result = await cli(['lint', '--format', 'xml'], workspace({ 'leave/tecton.yaml': manifest('leave') }));

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('xml');
  });

  it('prints help text in English', async () => {
    const result = await cli(['lint', '--help'], workspace({}));

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Validate every tecton.yaml');
    expect(result.stdout).toMatch(/^[\x09\x0A\x0D\x20-\x7E]+$/);
  });
});
