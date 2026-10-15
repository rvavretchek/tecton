import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lintWorkspace, type LintProblem } from './lint-workspace.js';

// Regression tests for the Epic 1 code review (2026-10-13), one block per finding.

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tecton-lint-review-'));
  created.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const manifest = (domain: string, extra = '') =>
  `manifestVersion: "0.1"\ndomain: ${domain}\nversion: 1.0.0\ndescription: "The ${domain} domain."\n${extra}`;
const classManifest = (domain: string, name: string, extra = '') =>
  manifest(domain, `objectClass:\n  name: ${name}\n${extra}  containment: { allowedParents: [Root] }\n`);
const errors = (problems: LintProblem[]) => problems.filter((problem) => problem.severity === 'error');

describe('dependency cycles (P6)', () => {
  it('Given a cycle whose smallest domain comes from a package, When linted, Then the warning lands on the workspace member', () => {
    const cwd = workspace({
      'package.json': JSON.stringify({ dependencies: { 'audit-pkg': '1.0.0' } }),
      'node_modules/audit-pkg/package.json': JSON.stringify({ name: 'audit-pkg', tecton: { manifests: ['./tecton.yaml'] } }),
      'node_modules/audit-pkg/tecton.yaml': manifest('audit', 'dependencies: [billing]\n'),
      'billing/tecton.yaml': manifest('billing', 'dependencies: [audit]\n'),
    });
    const { problems } = lintWorkspace({ cwd });

    expect(problems).toEqual([
      expect.objectContaining({ file: 'billing/tecton.yaml', code: 'dependency-cycle', message: 'dependency cycle: billing -> audit -> billing' }),
    ]);
  });
});

describe('package manifests (P7)', () => {
  it('Given a package manifest entry that is a directory, When linted, Then its tecton.yaml is used', () => {
    const cwd = workspace({
      'package.json': JSON.stringify({ dependencies: { 'users-pkg': '1.0.0' } }),
      'node_modules/users-pkg/package.json': JSON.stringify({ name: 'users-pkg', tecton: { manifests: ['./user'] } }),
      'node_modules/users-pkg/user/tecton.yaml': manifest('user'),
      'leave/tecton.yaml': manifest('leave', 'dependencies: [user]\n'),
    });

    expect(lintWorkspace({ cwd }).problems).toEqual([]);
  });
});

describe('linting a subset (P8, P13)', () => {
  const files = {
    'apps/domains/leave/tecton.yaml': manifest('leave', 'dependencies: [user]\n'),
    'apps/domains/user/tecton.yaml': manifest('user'),
    'AGENTS.md': '<!-- tecton:domains:start -->\n```yaml\ndomains:\n  - { name: leave, dependencies: [user] }\n  - { name: user, dependencies: [] }\n```\n<!-- tecton:domains:end -->\n',
  };

  it('Given one domain as the path, When linted, Then its siblings resolve and AGENTS.md is not compared', () => {
    const result = lintWorkspace({ cwd: workspace(files), paths: ['apps/domains/leave'] });

    expect(result).toEqual({ manifests: 1, problems: [] });
  });

  it('Given a path that does not exist, When linted through the library, Then it is an error', () => {
    const { problems } = lintWorkspace({ cwd: workspace(files), paths: ['apps/domains/missing'] });

    expect(problems).toEqual([expect.objectContaining({ code: 'path-not-found', file: 'apps/domains/missing' })]);
  });
});

describe('invalid manifests (P15, P16)', () => {
  it('Given an invalid manifest referenced by two explicit paths, When linted, Then its errors appear once', () => {
    const cwd = workspace({
      'app/leave/tecton.yaml': manifest('leave', 'dependencies: [{ domain: billing, path: ../../shared/billing }]\n'),
      'app/payroll/tecton.yaml': manifest('payroll', 'dependencies: [{ domain: billing, path: ../../shared/billing }]\n'),
      'shared/billing/tecton.yaml': manifest('billing', 'version: oops\n').replace('version: 1.0.0\n', ''),
    });
    const { problems } = lintWorkspace({ cwd: join(cwd, 'app') });

    expect(problems.filter((problem) => problem.file.endsWith('shared/billing/tecton.yaml'))).toHaveLength(1);
  });

  it('Given a reference to a domain whose manifest is invalid, When linted, Then the message says it is invalid', () => {
    const cwd = workspace({
      'billing/tecton.yaml': manifest('billing').replace('version: 1.0.0', 'version: one'),
      'leave/tecton.yaml': manifest('leave', 'dependencies: [billing]\n'),
    });
    const leave = lintWorkspace({ cwd }).problems.filter((problem) => problem.file === 'leave/tecton.yaml');

    expect(leave).toEqual([expect.objectContaining({ message: expect.stringContaining('billing/tecton.yaml is invalid') })]);
  });
});

describe('Directory classes across domains (P20)', () => {
  it('Given extends of a class nobody declares, When linted, Then it is unresolved', () => {
    const cwd = workspace({ 'tenant/tecton.yaml': classManifest('tenant', 'Tenant', '  extends: Organization\n') });

    expect(errors(lintWorkspace({ cwd }).problems)).toEqual([
      expect.objectContaining({ path: 'objectClass.extends', code: 'unresolved-reference', message: expect.stringContaining('Organization') }),
    ]);
  });

  it('Given extends of a class another domain declares, When linted, Then it resolves', () => {
    const cwd = workspace({
      'org/tecton.yaml': classManifest('org', 'Organization'),
      'tenant/tecton.yaml': classManifest('tenant', 'Tenant', '  extends: Organization\n'),
    });

    expect(lintWorkspace({ cwd }).problems).toEqual([]);
  });

  it('Given the same class name in two domains, When linted, Then the second is a duplicate', () => {
    const cwd = workspace({
      'a/tecton.yaml': classManifest('a', 'Team'),
      'b/tecton.yaml': classManifest('b', 'Team'),
    });

    expect(errors(lintWorkspace({ cwd }).problems)).toEqual([
      expect.objectContaining({ file: 'b/tecton.yaml', path: 'objectClass.name', code: 'duplicate-name' }),
    ]);
  });
});

describe('AGENTS.md (P21)', () => {
  it('Given a domain listed twice, When linted, Then a warning says so', () => {
    const cwd = workspace({
      'leave/tecton.yaml': manifest('leave'),
      'AGENTS.md': '<!-- tecton:domains:start -->\n```yaml\ndomains:\n  - { name: leave, dependencies: [] }\n  - { name: leave, dependencies: [] }\n```\n<!-- tecton:domains:end -->\n',
    });

    expect(lintWorkspace({ cwd }).problems).toEqual([
      expect.objectContaining({ code: 'agents-md-divergence', message: expect.stringContaining('listed more than once') }),
    ]);
  });
});

describe('precedence (D3)', () => {
  it('Given an explicit path and a package declaring the same domain, When linted, Then the explicit path wins', () => {
    const cwd = workspace({
      'app/package.json': JSON.stringify({ dependencies: { 'old-billing': '1.0.0' } }),
      'app/node_modules/old-billing/package.json': JSON.stringify({ name: 'old-billing', tecton: { manifests: ['./tecton.yaml'] } }),
      'app/node_modules/old-billing/tecton.yaml': manifest('billing', 'events:\n  publishes: []\n'),
      'shared/billing/tecton.yaml': manifest('billing', 'events:\n  publishes:\n    - { name: InvoicePaid, schema: {} }\n'),
      'app/leave/tecton.yaml': manifest(
        'leave',
        'dependencies: [{ domain: billing, path: ../../shared/billing }]\nevents:\n  consumes: [billing.InvoicePaid]\n',
      ),
    });

    expect(lintWorkspace({ cwd: join(cwd, 'app') }).problems).toEqual([]);
  });
});
