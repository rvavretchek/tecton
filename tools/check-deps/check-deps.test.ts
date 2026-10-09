import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const depcruiseBin = join(repoRoot, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');
const config = join(repoRoot, '.dependency-cruiser.cjs');

function runCheckDeps(fixture: string) {
  const result = spawnSync(
    process.execPath,
    [depcruiseBin, 'packages', '--config', config, '--output-type', 'err-long'],
    { cwd: join(here, 'fixtures', fixture), encoding: 'utf8' },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('check:deps (AD-3 dependency direction)', () => {
  it('fails and reports file, import and AD-3 rule when @tecton/manifest imports @tecton/core', () => {
    const { status, output } = runCheckDeps('violation');

    expect(status).not.toBe(0);
    expect(output).toMatch(/packages[\\/]manifest[\\/]src[\\/]index\.ts/);
    expect(output).toMatch(/packages[\\/]core[\\/]src[\\/]index\.ts/);
    expect(output).toContain('ad-3-manifest-no-internal-deps');
    expect(output).toContain('AD-3');
  });

  it('passes when every import follows the AD-3 direction', () => {
    const { status, output } = runCheckDeps('valid');

    expect(output).not.toContain('ad-3-');
    expect(status).toBe(0);
  });
});
