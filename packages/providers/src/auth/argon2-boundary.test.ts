import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ADAPTER = ['providers', 'src', 'auth', 'argon2id-auth-provider.ts'].join('/');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

// AC 7 (AD-1): services depend on the AuthProvider port; only the reference adapter touches Argon2.
describe('Argon2 boundary', () => {
  it('only the Argon2id adapter calls Argon2 or imports an Argon2 library', () => {
    const offenders: string[] = [];
    for (const pkg of readdirSync(packagesDir)) {
      const srcDir = join(packagesDir, pkg, 'src');
      if (!existsSync(srcDir)) continue;
      for (const file of sourceFiles(srcDir)) {
        const path = relative(packagesDir, file).split(sep).join('/');
        if (path === ADAPTER) continue;
        const text = readFileSync(file, 'utf8');
        if (/\bargon2(Sync)?\s*\(|from\s+['"](@node-rs\/argon2|argon2)['"]/.test(text)) offenders.push(path);
      }
    }

    expect(offenders).toEqual([]);
  });
});
