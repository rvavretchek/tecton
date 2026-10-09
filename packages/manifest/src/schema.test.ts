import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { manifestJsonSchema, SUPPORTED_MANIFEST_VERSIONS } from './schema.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('manifestJsonSchema (AC 8)', () => {
  it('is a well-formed JSON Schema draft-07 document', () => {
    const ajv = new Ajv({ strict: true });

    expect(manifestJsonSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(ajv.validateSchema(manifestJsonSchema)).toBe(true);
    expect(() => ajv.compile(manifestJsonSchema)).not.toThrow();
  });

  it('documents every top-level key for editor autocomplete', () => {
    for (const [key, definition] of Object.entries(manifestJsonSchema.properties)) {
      expect(definition, key).toHaveProperty('description');
    }
  });

  it('accepts exactly the supported manifest versions', () => {
    expect(manifestJsonSchema.properties.manifestVersion.enum).toEqual([...SUPPORTED_MANIFEST_VERSIONS]);
  });

  it('is emitted as JSON identical to the exported object', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'tecton-schema-'));
    const outFile = join(outDir, 'tecton-manifest.schema.json');

    execFileSync(process.execPath, [join(packageRoot, 'scripts', 'emit-schema.mjs'), outFile], { cwd: packageRoot });

    const emitted = readFileSync(outFile, 'utf8');
    expect(JSON.parse(emitted)).toEqual(manifestJsonSchema);
    expect(emitted.endsWith('\n')).toBe(true);
  });
});
