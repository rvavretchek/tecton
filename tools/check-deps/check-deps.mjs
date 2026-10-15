#!/usr/bin/env node
// pnpm check:deps - enforces AD-3 (see .dependency-cruiser.cjs) and reports each violation
// with the import specifier as written in the source (e.g. '@tecton/core'), plus one check
// dependency-cruiser cannot express: every @tecton/* import from production code must be
// declared in that package's package.json.
//
// Usage: node tools/check-deps/check-deps.mjs [workspace-dir]   (default: current directory)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workspace = resolve(process.argv[2] ?? process.cwd());

/** The depcruise binary, found through the package's public entry point and its "bin" field. */
function depcruiseBin() {
  let dir = dirname(fileURLToPath(import.meta.resolve('dependency-cruiser')));
  while (!existsSync(join(dir, 'package.json')) || readJson(join(dir, 'package.json')).name !== 'dependency-cruiser') {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate the dependency-cruiser package');
    dir = parent;
  }
  return join(dir, readJson(join(dir, 'package.json')).bin.depcruise);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const run = spawnSync(
  process.execPath,
  [depcruiseBin(), 'packages', '--config', join(repoRoot, '.dependency-cruiser.cjs'), '--output-type', 'json'],
  { cwd: workspace, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
if (run.status !== 0 && !run.stdout) {
  process.stderr.write(run.stderr || `dependency-cruiser exited with ${run.status}\n`);
  process.exit(2);
}

const result = JSON.parse(run.stdout);
const comments = new Map(result.summary.ruleSetUsed.forbidden.map((rule) => [rule.name, rule.comment]));
const problems = result.summary.violations
  .filter((violation) => violation.rule.severity === 'error')
  .map((violation) => ({
    rule: violation.rule.name,
    from: violation.from,
    specifier: violation.unresolvedTo ?? violation.to,
    to: violation.to,
    comment: comments.get(violation.rule.name) ?? '',
  }));

// Undeclared workspace dependencies: the tsconfig paths alias resolves @tecton/* from source,
// so an import missing from package.json works here and breaks once the package is published.
const manifests = new Map();
function declaredDependencies(pkg) {
  if (!manifests.has(pkg)) {
    const path = join(workspace, 'packages', pkg, 'package.json');
    const json = existsSync(path) ? readJson(path) : {};
    manifests.set(pkg, new Set(Object.keys({ ...json.dependencies, ...json.peerDependencies })));
  }
  return manifests.get(pkg);
}
for (const module of result.modules) {
  const from = /^packages\/([^/]+)\/src\/(.+)$/.exec(module.source);
  if (!from || /\.test\.ts$/.test(from[2])) continue;
  for (const dependency of module.dependencies) {
    const target = /^@tecton\/([a-z0-9-]+)$/.exec(dependency.module);
    if (!target || target[1] === from[1] || declaredDependencies(from[1]).has(dependency.module)) continue;
    problems.push({
      rule: 'undeclared-workspace-dependency',
      from: module.source,
      specifier: dependency.module,
      to: dependency.resolved,
      comment: `@tecton/${from[1]} imports ${dependency.module} without declaring it in packages/${from[1]}/package.json`,
    });
  }
}

for (const problem of problems) {
  console.error(`error ${problem.rule}: ${problem.from} imports '${problem.specifier}' (${problem.to})`);
  if (problem.comment) console.error(`  ${problem.comment}`);
}
console.error(
  problems.length === 0
    ? `check:deps: no violations (${result.summary.totalCruised} modules)`
    : `check:deps: ${problems.length} violation(s)`,
);
process.exit(problems.length === 0 ? 0 : 1);
