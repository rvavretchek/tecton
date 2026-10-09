// Writes the tecton.yaml JSON Schema for editors and AI agents.
// Usage: node scripts/emit-schema.mjs [outFile]   (default: dist/tecton-manifest.schema.json)
// Imports the TypeScript source directly (Node 24 strips types), so it runs with or without a build.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = resolve(process.argv[2] ?? resolve(packageRoot, 'dist', 'tecton-manifest.schema.json'));

const { manifestJsonSchema } = await import(new URL('../src/schema.ts', import.meta.url).href);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(manifestJsonSchema, null, 2)}\n`);
