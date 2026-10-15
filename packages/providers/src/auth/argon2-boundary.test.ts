import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ADAPTER = ['providers', 'src', 'auth', 'argon2id-auth-provider.ts'].join('/');
const SOURCE = /\.(m|c)?[jt]sx?$/;
const TEST = /\.test\.(m|c)?[jt]sx?$/;

/**
 * Any use of Argon2 in source: the `argon2`/`argon2Sync` identifier (calls, `promisify(argon2)`,
 * `crypto.argon2`, `{ argon2 } from 'node:crypto'`, aliased imports) or an Argon2 library as a
 * module specifier (static import, side-effect import, require, dynamic import).
 */
export const ARGON2_USE = /\bargon2(Sync)?\b|['"](@node-rs\/argon2|argon2)['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : sourceFiles(path);
    return SOURCE.test(entry.name) && !TEST.test(entry.name) ? [path] : [];
  });
}

// AC 7 (AD-1): services depend on the AuthProvider port; only the reference adapter touches Argon2.
describe('Argon2 boundary', () => {
  it.each([
    'const f = promisify(argon2);',
    "import { argon2 } from 'node:crypto';",
    "import { argon2 as a } from 'node:crypto';",
    'const h = crypto.argon2Sync(alg, params);',
    "const lib = require('argon2');",
    "const lib = await import('@node-rs/argon2');",
    "import 'argon2';",
  ])('detects: %s', (line) => {
    expect(ARGON2_USE.test(line)).toBe(true);
  });

  it.each(['createArgon2idAuthProvider(options)', '// Argon2id with a Pepper', "type: 'argon2id'"])('ignores: %s', (line) => {
    expect(ARGON2_USE.test(line)).toBe(false);
  });

  it('only the Argon2id adapter uses Argon2 in any package source', () => {
    const offenders: string[] = [];
    for (const pkg of readdirSync(packagesDir)) {
      const srcDir = join(packagesDir, pkg, 'src');
      if (!existsSync(srcDir)) continue;
      for (const file of sourceFiles(srcDir)) {
        const path = relative(packagesDir, file).split(sep).join('/');
        if (path !== ADAPTER && ARGON2_USE.test(readFileSync(file, 'utf8'))) offenders.push(path);
      }
    }

    expect(offenders).toEqual([]);
  });
});
