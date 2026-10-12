// Generates the AsyncAPI document of every example manifest and validates it with the official
// @asyncapi/parser. Exits non-zero on any parser error. Runs after `pnpm build` (uses dist/).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from '@asyncapi/parser';
import { buildAsyncApiDocument, parseManifest } from '../../packages/manifest/dist/index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const examplesDir = join(repoRoot, 'docs', 'examples');

function yamlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return yamlFiles(path);
    return entry.name.endsWith('.yaml') ? [path] : [];
  });
}

const parser = new Parser();
let failures = 0;

for (const file of yamlFiles(examplesDir).sort()) {
  const label = relative(repoRoot, file).split('\\').join('/');
  const result = parseManifest(readFileSync(file, 'utf8'));
  if (!result.ok) {
    failures += 1;
    console.error(`FAIL ${label}: invalid manifest (run pnpm lint:examples)`);
    continue;
  }
  const { diagnostics } = await parser.parse(buildAsyncApiDocument(result.manifest));
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 0);
  if (errors.length > 0) {
    failures += 1;
    console.error(`FAIL ${label}`);
    for (const error of errors) console.error(`  ${error.code}: ${error.message} at ${error.path.join('.')}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

if (failures > 0) {
  console.error(`${failures} AsyncAPI document(s) failed validation`);
  process.exitCode = 1;
}
