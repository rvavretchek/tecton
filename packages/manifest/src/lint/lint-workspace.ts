import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { formatPath } from '../errors.js';
import { BUILTIN_DIRECTORY_CLASSES } from '../object-class.js';
import { createLocator, parseManifest, type Position } from '../parse.js';
import type { ManifestError, ManifestErrorCode, TectonManifest } from '../types.js';

export type LintSeverity = 'error' | 'warning';

export interface LintProblem extends ManifestError {
  /** Manifest the problem is in, relative to the lint directory, with `/` separators. */
  file: string;
  severity: LintSeverity;
}

export interface LintResult {
  /** Workspace manifests found and checked. */
  manifests: number;
  /** Errors and warnings, ordered by file, line and column. */
  problems: LintProblem[];
}

export interface LintOptions {
  /** Base directory: reported paths are relative to it and installed packages are looked up from it. */
  cwd: string;
  /**
   * What to lint, relative to `cwd`: directories are searched for tecton.yaml files, files are
   * linted whatever their name. Default: `cwd` itself.
   */
  paths?: string[];
}

const MANIFEST_FILE = 'tecton.yaml';
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', 'test-results']);
const SEARCHED = 'searched: workspace, installed packages, dependency paths';

type Origin = 'workspace' | 'package' | 'path';

interface Loaded {
  file: string;
  source: string;
  manifest: TectonManifest;
  origin: Origin;
}

/** Every tecton.yaml under `root`, skipping dependencies, build output and hidden directories. */
export function findManifests(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.name === MANIFEST_FILE) {
        found.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return found;
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Finds `node_modules/<name>/package.json` walking up from `fromDir` (Node's lookup order). */
function findPackageJson(name: string, fromDir: string): string | undefined {
  let dir = resolve(fromDir);
  for (;;) {
    const candidate = join(dir, 'node_modules', ...name.split('/'), 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function dependencyNames(packageJson: Record<string, unknown> | undefined): string[] {
  if (!packageJson) return [];
  const names = new Set<string>();
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = packageJson[field];
    if (deps && typeof deps === 'object') for (const name of Object.keys(deps)) names.add(name);
  }
  return [...names].sort();
}

/** Manifest files declared by an installed package through `"tecton": { "manifests": [...] }`. */
function packageManifests(packageJsonFile: string): string[] {
  const tecton = readJson(packageJsonFile)?.['tecton'];
  const manifests = tecton && typeof tecton === 'object' ? (tecton as Record<string, unknown>)['manifests'] : undefined;
  if (!Array.isArray(manifests)) return [];
  return manifests.filter((path): path is string => typeof path === 'string').map((path) => resolve(dirname(packageJsonFile), path));
}

function manifestFileOf(path: string): string {
  return existsSync(path) && statSync(path).isDirectory() ? join(path, MANIFEST_FILE) : path;
}

/**
 * Lints every manifest of a workspace: per-file validation (Stories 1.2-1.5) plus
 * cross-domain references, resolved in order: (1) workspace manifests, (2) manifests
 * exported by installed npm packages, (3) explicit `{ domain, path }` dependency paths.
 */
export function lintWorkspace({ cwd, paths }: LintOptions): LintResult {
  const root = resolve(cwd);
  const problems: LintProblem[] = [];
  const display = (file: string) => relative(root, file).split(sep).join('/');
  const report = (file: string, source: string, segments: Array<string | number>, code: ManifestErrorCode, message: string, severity: LintSeverity = 'error') => {
    const position: Position | undefined = createLocator(source)(segments);
    problems.push({ file: display(file), severity, path: formatPath(segments), code, message, ...(position ?? {}) });
  };

  const loadFile = (file: string, origin: Origin): Loaded | undefined => {
    const source = readFileSync(file, 'utf8');
    const result = parseManifest(source);
    if (!result.ok) {
      for (const error of result.errors) problems.push({ ...error, file: display(file), severity: 'error' });
      return undefined;
    }
    return { file, source, manifest: result.manifest, origin };
  };

  // (1) Workspace.
  const targets = paths && paths.length > 0 ? paths.map((path) => resolve(root, path)) : [root];
  const workspaceFiles = [
    ...new Set(
      targets.flatMap((target) => {
        if (!existsSync(target)) return [];
        return statSync(target).isDirectory() ? findManifests(target) : [target];
      }),
    ),
  ];
  const workspace: Loaded[] = [];
  const domains = new Map<string, Loaded>();
  for (const file of workspaceFiles) {
    const loaded = loadFile(file, 'workspace');
    if (!loaded) continue;
    const existing = domains.get(loaded.manifest.domain);
    if (existing) {
      report(file, loaded.source, ['domain'], 'duplicate-name', `domain ${JSON.stringify(loaded.manifest.domain)} is already declared in ${display(existing.file)}`);
      continue;
    }
    domains.set(loaded.manifest.domain, loaded);
    workspace.push(loaded);
  }

  const index = (loaded: Loaded) => {
    if (!domains.has(loaded.manifest.domain)) domains.set(loaded.manifest.domain, loaded);
  };

  // (2) Installed packages declared by the workspace root and by each domain package.
  const seenPackages = new Set<string>();
  const searchDirs = [root, ...workspace.map((loaded) => dirname(loaded.file))];
  for (const dir of searchDirs) {
    for (const name of dependencyNames(readJson(join(dir, 'package.json')))) {
      const packageJson = findPackageJson(name, dir);
      if (!packageJson || seenPackages.has(packageJson)) continue;
      seenPackages.add(packageJson);
      for (const file of packageManifests(packageJson)) {
        if (!existsSync(file)) continue;
        const loaded = loadFile(file, 'package');
        if (loaded) index(loaded);
      }
    }
  }

  // (3) Explicit dependency paths.
  for (const loaded of workspace) {
    loaded.manifest.dependencies.forEach((domain, position) => {
      const declared = loaded.manifest.dependencyPaths[domain];
      if (declared === undefined) return;
      const target = manifestFileOf(resolve(dirname(loaded.file), declared));
      if (!existsSync(target)) {
        report(loaded.file, loaded.source, ['dependencies', position], 'unresolved-reference', `dependencies[${position}] path ${JSON.stringify(declared)} for domain "${domain}" does not exist`);
        return;
      }
      const dependency = loadFile(target, 'path');
      if (!dependency) return;
      if (dependency.manifest.domain !== domain) {
        report(loaded.file, loaded.source, ['dependencies', position], 'unresolved-reference', `dependencies[${position}] path ${JSON.stringify(declared)} declares domain "${dependency.manifest.domain}", not "${domain}"`);
        return;
      }
      index(dependency);
    });
  }

  const classes = new Set<string>(BUILTIN_DIRECTORY_CLASSES);
  for (const loaded of domains.values()) if (loaded.manifest.objectClass) classes.add(loaded.manifest.objectClass.name);

  // Cross-domain references of workspace manifests.
  for (const loaded of workspace) {
    const { manifest, file, source } = loaded;
    const containment = manifest.objectClass?.containment;
    for (const side of ['allowedParents', 'allowedChildren'] as const) {
      containment?.[side].forEach((name, position) => {
        if (!classes.has(name))
          report(file, source, ['objectClass', 'containment', side, position], 'unresolved-reference', `objectClass.containment.${side}[${position}] references class "${name}", which no manifest declares (${SEARCHED})`);
      });
    }
    manifest.events.consumes.forEach((reference, position) => {
      const [domain = '', event = ''] = reference.split('.');
      const origin = domains.get(domain);
      const segments = ['events', 'consumes', position];
      if (!origin) report(file, source, segments, 'unresolved-reference', `events.consumes[${position}] references domain "${domain}", which was not found (${SEARCHED})`);
      else if (!origin.manifest.events.publishes.some((published) => published.name === event))
        report(file, source, segments, 'unresolved-reference', `events.consumes[${position}] references event "${event}" of domain "${domain}", which does not publish it`);
    });
    manifest.dependencies.forEach((domain, position) => {
      if (manifest.dependencyPaths[domain] !== undefined) return; // checked in (3)
      if (!domains.has(domain))
        report(file, source, ['dependencies', position], 'unresolved-reference', `dependencies[${position}] references domain "${domain}", which was not found (${SEARCHED})`);
    });
  }

  // Synchronous dependency cycles: a warning each (they may be intentional, e.g. auth <-> directory).
  for (const cycle of findCycles(domains)) {
    const owner = domains.get(cycle[0] ?? '');
    if (!owner || owner.origin !== 'workspace') continue;
    report(owner.file, owner.source, ['dependencies'], 'dependency-cycle', `dependency cycle: ${cycle.join(' -> ')} -> ${cycle[0]}`, 'warning');
  }

  problems.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0) || a.path.localeCompare(b.path));
  return { manifests: workspaceFiles.length, problems };
}

/** Elementary cycles of the dependency graph, each rotated to start at its smallest domain. */
function findCycles(domains: Map<string, Loaded>): string[][] {
  const cycles = new Map<string, string[]>();
  const visit = (start: string, current: string, path: string[]) => {
    for (const next of domains.get(current)?.manifest.dependencies ?? []) {
      if (!domains.has(next)) continue;
      if (next === start) {
        const smallest = path.reduce((min, domain) => (domain < min ? domain : min));
        const at = path.indexOf(smallest);
        const rotated = [...path.slice(at), ...path.slice(0, at)];
        cycles.set(rotated.join('>'), rotated);
      } else if (!path.includes(next) && next > start) {
        visit(start, next, [...path, next]);
      }
    }
  };
  for (const domain of [...domains.keys()].sort()) visit(domain, domain, [domain]);
  return [...cycles.values()];
}
