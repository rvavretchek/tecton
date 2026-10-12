import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lintWorkspace } from './lint-workspace.js';

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tecton-agents-'));
  created.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const manifest = (domain: string, dependencies = '[]') =>
  `manifestVersion: "0.1"\ndomain: ${domain}\nversion: 0.1.0\ndescription: "The ${domain} domain."\ndependencies: ${dependencies}\n`;

const agents = (yaml: string) => `# AGENTS.md\n\nIntro.\n\n<!-- tecton:domains:start -->\n\`\`\`yaml\n${yaml}\`\`\`\n<!-- tecton:domains:end -->\n`;

const warnings = (cwd: string) => lintWorkspace({ cwd }).problems.filter((problem) => problem.code === 'agents-md-divergence');

describe('AGENTS.md domains section (Story 1.10, AC 7)', () => {
  it('Given a section matching the manifests, When linted, Then there is no warning', () => {
    const cwd = workspace({
      'AGENTS.md': agents('domains:\n  - name: leave\n    dependencies: [billing]\n  - name: billing\n    dependencies: []\n'),
      'apps/domains/leave/tecton.yaml': manifest('leave', '[billing]'),
      'apps/domains/billing/tecton.yaml': manifest('billing'),
    });

    expect(warnings(cwd)).toEqual([]);
  });

  it('Given a domain missing from the section, When linted, Then it warns naming the domain, without failing', () => {
    const cwd = workspace({ 'AGENTS.md': agents('domains: []\n'), 'apps/domains/finance/tecton.yaml': manifest('finance') });
    const { problems } = lintWorkspace({ cwd });

    expect(problems).toEqual([
      expect.objectContaining({
        file: 'AGENTS.md',
        line: 5,
        severity: 'warning',
        code: 'agents-md-divergence',
        message: expect.stringContaining('domain "finance" has a manifest but is not listed'),
      }),
    ]);
  });

  it('Given a listed domain without manifest, When linted, Then it warns', () => {
    const cwd = workspace({ 'AGENTS.md': agents('domains:\n  - name: ghost\n    dependencies: []\n'), 'a/tecton.yaml': manifest('alpha') });

    expect(warnings(cwd).map((warning) => warning.message)).toEqual([
      expect.stringContaining('domain "alpha" has a manifest but is not listed'),
      expect.stringContaining('domain "ghost" is listed but has no manifest'),
    ]);
  });

  it('Given different dependencies, When linted, Then it warns with both lists', () => {
    const cwd = workspace({
      'AGENTS.md': agents('domains:\n  - name: leave\n    dependencies: []\n'),
      'leave/tecton.yaml': manifest('leave', '[billing]'),
      'billing/tecton.yaml': manifest('billing'),
    });

    expect(warnings(cwd).map((warning) => warning.message)).toContainEqual(
      expect.stringContaining('dependencies of "leave" differ: AGENTS.md lists [] but the manifest declares [billing]'),
    );
  });

  it('Given invalid YAML in the section, When linted, Then it warns instead of failing', () => {
    const cwd = workspace({ 'AGENTS.md': agents('domains: [\n'), 'leave/tecton.yaml': manifest('leave') });

    expect(warnings(cwd)).toEqual([expect.objectContaining({ message: expect.stringContaining('not valid') })]);
  });

  it('Given an AGENTS.md without the markers, or no AGENTS.md, When linted, Then nothing is checked', () => {
    expect(warnings(workspace({ 'AGENTS.md': '# AGENTS\n', 'leave/tecton.yaml': manifest('leave') }))).toEqual([]);
    expect(warnings(workspace({ 'leave/tecton.yaml': manifest('leave') }))).toEqual([]);
  });
});
