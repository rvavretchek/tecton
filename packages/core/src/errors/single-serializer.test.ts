import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SERIALIZER = ['core', 'src', 'errors', 'serializer.ts'].join('/');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

// AC 6: errors go through TectonError and a single serializer; nobody else builds error bodies.
describe('single error serializer', () => {
  it('only errors/serializer.ts installs an error handler or sets error status codes', () => {
    const offenders: string[] = [];
    for (const pkg of readdirSync(packagesDir)) {
      for (const file of sourceFiles(join(packagesDir, pkg, 'src'))) {
        const path = relative(packagesDir, file).split(sep).join('/');
        if (path === SERIALIZER) continue;
        const text = readFileSync(file, 'utf8');
        if (/setErrorHandler\(|setNotFoundHandler\(|reply\.(code|status)\(\s*[45]\d\d/.test(text)) offenders.push(path);
      }
    }

    expect(offenders).toEqual([]);
  });
});
