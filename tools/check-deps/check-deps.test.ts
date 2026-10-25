import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const checkDeps = join(here, 'check-deps.mjs');

function runCheckDeps(fixture: string) {
  const result = spawnSync(process.execPath, [checkDeps, join(here, 'fixtures', fixture)], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// Each case spawns dependency-cruiser in a child process: ~2 s alone, slower when the suite runs
// in parallel, so these tests get their own timeout instead of Vitest's 5 s default.
describe('check:deps (AD-3 dependency direction)', { timeout: 30_000 }, () => {
  it('fails and reports file, import specifier and AD-3 rule when @tecton/manifest imports @tecton/core', () => {
    const { status, output } = runCheckDeps('violation');

    expect(status).toBe(1);
    expect(output).toContain(
      "ad-3-manifest-no-internal-deps: packages/manifest/src/index.ts imports '@tecton/core'",
    );
    expect(output).toContain('AD-3: @tecton/manifest must not depend on any other @tecton package');
  });

  it('passes when every import follows the AD-3 direction', () => {
    const { status, output } = runCheckDeps('valid');

    expect(output).not.toContain('error');
    expect(status).toBe(0);
  });

  it('checks each entry of a multi-package allow list, including hyphenated names', () => {
    const { status, output } = runCheckDeps('multiple-allowed');

    expect(status).toBe(1);
    expect(output).toContain("ad-3-service-client-allowed-deps: packages/service-client/src/index.ts imports '@tecton/core'");
    expect(output).not.toContain("imports '@tecton/providers'");
  });

  it('fails when a package without an AD-3 rule imports another package', () => {
    const { status, output } = runCheckDeps('unknown-package');

    expect(status).toBe(1);
    expect(output).toContain("ad-3-unknown-package: packages/billing/src/index.ts imports '@tecton/core'");
  });

  it('fails when production code imports a @tecton package missing from its package.json', () => {
    const { status, output } = runCheckDeps('undeclared');

    expect(status).toBe(1);
    expect(output).toContain("undeclared-workspace-dependency: packages/core/src/index.ts imports '@tecton/manifest'");
  });

  it('fails when @tecton/providers imports an HTTP framework or server (AD-1, FR-11), allowing other built-ins', () => {
    const { status, output } = runCheckDeps('providers-http');

    expect(status).toBe(1);
    // dependency-cruiser reports node:http as 'http'.
    for (const specifier of ['http', 'https', 'fastify', '@fastify/swagger']) {
      expect(output).toContain(`providers-no-http-framework: packages/providers/src/index.ts imports '${specifier}'`);
    }
    expect(output).not.toContain('clock.ts');
  });

  it('fails when production code imports the shared test support, but not when a test does', () => {
    const { status, output } = runCheckDeps('test-support');

    expect(status).toBe(1);
    expect(output).toContain("no-test-support-in-production: packages/core/src/index.ts imports '#test-support'");
    expect(output).not.toContain('index.test.ts');
  });
});
