import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
