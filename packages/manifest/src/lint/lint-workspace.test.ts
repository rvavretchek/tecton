import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lintWorkspace, type LintProblem } from './lint-workspace.js';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Writes a throwaway workspace: keys are relative paths, values are file contents. */
function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tecton-lint-'));
  created.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function manifest(domain: string, extra = ''): string {
  return `manifestVersion: "0.1"\ndomain: ${domain}\nversion: 1.0.0\ndescription: "The ${domain} domain."\n${extra}`;
}

const classManifest = (domain: string, name: string, parents: string, children = '[]') =>
  manifest(domain, `objectClass:\n  name: ${name}\n  containment: { allowedParents: ${parents}, allowedChildren: ${children} }\n`);

const errors = (problems: LintProblem[]) => problems.filter((problem) => problem.severity === 'error');
const warnings = (problems: LintProblem[]) => problems.filter((problem) => problem.severity === 'warning');

describe('lintWorkspace — manifests of the workspace (AC 1)', () => {
  it('Given valid manifests, When linted, Then there are no problems and every manifest is counted', () => {
    const cwd = workspace({
      'apps/domains/leave/tecton.yaml': manifest('leave'),
      'apps/domains/billing/tecton.yaml': manifest('billing'),
      'node_modules/ignored/tecton.yaml': 'not: [valid',
      'apps/domains/leave/dist/tecton.yaml': 'not: [valid',
    });

    expect(lintWorkspace({ cwd })).toEqual({ manifests: 2, problems: [] });
  });

  it('Given an invalid manifest, When linted, Then its errors carry the file, and other manifests are still linted', () => {
    const cwd = workspace({
      'a/tecton.yaml': manifest('alpha').replace('version: 1.0.0', 'version: "1.0"'),
      'b/tecton.yaml': manifest('Beta'),
    });
    const { problems } = lintWorkspace({ cwd });

    expect(problems).toEqual([
      expect.objectContaining({ file: 'a/tecton.yaml', path: 'version', code: 'invalid-format', severity: 'error', line: 3 }),
      expect.objectContaining({ file: 'b/tecton.yaml', path: 'domain', code: 'invalid-format', severity: 'error', line: 2 }),
    ]);
  });

  it('Given two manifests with the same domain, When linted, Then the second is a duplicate', () => {
    const cwd = workspace({ 'a/tecton.yaml': manifest('leave'), 'b/tecton.yaml': manifest('leave') });

    expect(errors(lintWorkspace({ cwd }).problems)).toEqual([
      expect.objectContaining({ file: 'b/tecton.yaml', path: 'domain', code: 'duplicate-name' }),
    ]);
  });

  it('Given no manifest under the directory, When linted, Then it reports zero manifests', () => {
    expect(lintWorkspace({ cwd: workspace({ 'README.md': '# empty' }) })).toEqual({ manifests: 0, problems: [] });
  });
});

describe('lintWorkspace — class references (AC 4, AC 5)', () => {
  it('Given classes declared in the workspace and the built-in Root, When linted, Then they resolve', () => {
    const cwd = workspace({
      'tenant/tecton.yaml': classManifest('tenant', 'Tenant', '[Root]', '[Group]'),
      'group/tecton.yaml': classManifest('group', 'Group', '[Tenant]'),
    });

    expect(lintWorkspace({ cwd }).problems).toEqual([]);
  });

  it('Given a class no source declares, When linted, Then it fails naming the class', () => {
    const cwd = workspace({ 'tenant/tecton.yaml': classManifest('tenant', 'Tenant', '[Root]', '[Planet]') });
    const [problem] = lintWorkspace({ cwd }).problems;

    expect(problem).toMatchObject({
      file: 'tenant/tecton.yaml',
      path: 'objectClass.containment.allowedChildren[0]',
      code: 'unresolved-reference',
      severity: 'error',
      line: 7,
    });
    expect(problem?.message).toContain('"Planet"');
  });

  it('Given a class exported by an installed npm package, When linted, Then it resolves (fixture package)', () => {
    const cwd = workspace({
      'package.json': JSON.stringify({ name: 'app', private: true, dependencies: { '@fixture/directory-classes': '1.0.0' } }),
      'node_modules/@fixture/directory-classes/package.json': JSON.stringify({
        name: '@fixture/directory-classes',
        version: '1.0.0',
        tecton: { manifests: ['./user/tecton.yaml'] },
      }),
      'node_modules/@fixture/directory-classes/user/tecton.yaml': classManifest('user', 'User', '[Tenant]'),
      'tenant/tecton.yaml': classManifest('tenant', 'Tenant', '[Root]', '[User]'),
    });

    expect(lintWorkspace({ cwd })).toEqual({ manifests: 1, problems: [] });
  });

  it('Given a package dependency declared by a domain package.json, When linted, Then it is searched from that domain', () => {
    const cwd = workspace({
      'apps/domains/tenant/package.json': JSON.stringify({ name: 'tenant', dependencies: { 'classes-pkg': '1.0.0' } }),
      'apps/domains/tenant/node_modules/classes-pkg/package.json': JSON.stringify({ name: 'classes-pkg', tecton: { manifests: ['./tecton.yaml'] } }),
      'apps/domains/tenant/node_modules/classes-pkg/tecton.yaml': classManifest('group', 'Group', '[Tenant]'),
      'apps/domains/tenant/tecton.yaml': classManifest('tenant', 'Tenant', '[Root]', '[Group]'),
    });

    expect(lintWorkspace({ cwd }).problems).toEqual([]);
  });

  it('Given a class reachable only through an explicit dependency path, When linted, Then it resolves', () => {
    const cwd = workspace({
      'app/tenant/tecton.yaml': classManifest('tenant', 'Tenant', '[Root]', '[User]').replace(
        'objectClass:',
        'dependencies: [{ domain: user, path: ../../shared/user }]\nobjectClass:',
      ),
      'shared/user/tecton.yaml': classManifest('user', 'User', '[Tenant]'),
    });

    expect(lintWorkspace({ cwd: join(cwd, 'app') }).problems).toEqual([]);
  });

  it('Given the same domain in the workspace and in a package, When resolved, Then the workspace manifest wins', () => {
    const cwd = workspace({
      'package.json': JSON.stringify({ dependencies: { 'old-billing': '1.0.0' } }),
      'node_modules/old-billing/package.json': JSON.stringify({ name: 'old-billing', tecton: { manifests: ['./tecton.yaml'] } }),
      'node_modules/old-billing/tecton.yaml': manifest('billing', 'events:\n  publishes: []\n'),
      'billing/tecton.yaml': manifest('billing', 'events:\n  publishes:\n    - { name: InvoicePaid, schema: {} }\n'),
      'leave/tecton.yaml': manifest('leave', 'events:\n  consumes: [billing.InvoicePaid]\n'),
    });

    expect(lintWorkspace({ cwd }).problems).toEqual([]);
  });
});

describe('lintWorkspace — consumed events (AC 6)', () => {
  it('Given a consumed event the origin does not publish, When linted, Then it fails naming domain and event', () => {
    const cwd = workspace({
      'directory/tecton.yaml': manifest('directory', 'events:\n  publishes:\n    - { name: UserCreated, schema: {} }\n'),
      'leave/tecton.yaml': manifest('leave', 'events:\n  consumes: [directory.UserDeleted]\n'),
    });
    const [problem] = lintWorkspace({ cwd }).problems;

    expect(problem).toMatchObject({ file: 'leave/tecton.yaml', path: 'events.consumes[0]', code: 'unresolved-reference' });
    expect(problem?.message).toContain('"UserDeleted"');
    expect(problem?.message).toContain('"directory"');
  });

  it('Given a consumed event of an unknown domain, When linted, Then it fails naming the domain', () => {
    const cwd = workspace({ 'leave/tecton.yaml': manifest('leave', 'events:\n  consumes: [billing.InvoicePaid]\n') });
    const [problem] = lintWorkspace({ cwd }).problems;

    expect(problem).toMatchObject({ path: 'events.consumes[0]', code: 'unresolved-reference' });
    expect(problem?.message).toContain('"billing"');
  });
});

describe('lintWorkspace — dependencies (AC 4, AC 7, AC 8)', () => {
  it('Given a dependency on a domain nobody declares, When linted, Then it fails', () => {
    const cwd = workspace({ 'leave/tecton.yaml': manifest('leave', 'dependencies: [billing]\n') });

    expect(lintWorkspace({ cwd }).problems).toEqual([
      expect.objectContaining({ path: 'dependencies[0]', code: 'unresolved-reference', severity: 'error' }),
    ]);
  });

  it('Given an explicit path that does not exist, When linted, Then it fails', () => {
    const cwd = workspace({ 'leave/tecton.yaml': manifest('leave', 'dependencies: [{ domain: billing, path: ../nowhere }]\n') });
    const [problem] = lintWorkspace({ cwd }).problems;

    expect(problem).toMatchObject({ path: 'dependencies[0]', code: 'unresolved-reference' });
    expect(problem?.message).toContain('../nowhere');
  });

  it('Given an explicit path to a manifest of another domain, When linted, Then it fails', () => {
    const cwd = workspace({
      'leave/tecton.yaml': manifest('leave', 'dependencies: [{ domain: billing, path: ../payments/tecton.yaml }]\n'),
      'payments/tecton.yaml': manifest('payments'),
    });

    expect(lintWorkspace({ cwd }).problems).toEqual([
      expect.objectContaining({ file: 'leave/tecton.yaml', path: 'dependencies[0]', code: 'unresolved-reference' }),
    ]);
  });

  it('Given a remote URL dependency, When linted, Then it fails with the MVP message', () => {
    const cwd = workspace({ 'leave/tecton.yaml': manifest('leave', 'dependencies: ["https://example.com/billing.yaml"]\n') });
    const [problem] = lintWorkspace({ cwd }).problems;

    expect(problem).toMatchObject({ code: 'unsupported-dependency', severity: 'error' });
    expect(problem?.message).toContain('not supported in the MVP');
  });

  it('Given auth and directory depending on each other, When linted, Then a warning names the cycle and nothing fails', () => {
    const cwd = workspace({
      'auth/tecton.yaml': manifest('auth', 'dependencies: [directory]\n'),
      'directory/tecton.yaml': manifest('directory', 'dependencies: [auth]\n'),
    });
    const { problems } = lintWorkspace({ cwd });

    expect(errors(problems)).toEqual([]);
    expect(warnings(problems)).toEqual([
      expect.objectContaining({ code: 'dependency-cycle', severity: 'warning', message: expect.stringContaining('auth -> directory -> auth') }),
    ]);
  });

  it('Given a three-domain cycle, When linted, Then exactly one warning names it', () => {
    const cwd = workspace({
      'a/tecton.yaml': manifest('alpha', 'dependencies: [beta]\n'),
      'b/tecton.yaml': manifest('beta', 'dependencies: [gamma]\n'),
      'c/tecton.yaml': manifest('gamma', 'dependencies: [alpha]\n'),
    });

    expect(warnings(lintWorkspace({ cwd }).problems)).toEqual([
      expect.objectContaining({ message: expect.stringContaining('alpha -> beta -> gamma -> alpha') }),
    ]);
  });
});
