import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseDocument } from 'yaml';
import { formatPath } from '../errors.js';
import { BASE_DIRECTORY_CLASS, BUILTIN_DIRECTORY_CLASSES } from '../object-class.js';
import { AGENTS_FILE, checkAgentsDocument } from './agents-document.js';
import { createLocator, parseManifest, type Position } from '../parse.js';
import type { ManifestError, ManifestErrorCode, TectonManifest } from '../types.js';

export type LintSeverity = 'error' | 'warning';

export interface LintProblem extends ManifestError {
  /** Manifest the problem is in, relative to the lint directory, with `/` separators. */
  file: string;
  severity: LintSeverity;
}

export interface LintResult {
  /** Manifests linted (the targets; the rest of the workspace is only used to resolve references). */
  manifests: number;
  /** Errors and warnings, ordered by file, line and column. */
  problems: LintProblem[];
}

export interface LintOptions {
  /** Base directory: reported paths are relative to it and installed packages are looked up from it. */
  cwd: string;
  /**
   * What to lint, relative to `cwd`: directories are searched for tecton.yaml files, files are
   * linted whatever their name. Default: `cwd` itself. Every manifest under `cwd` is still read
   * to resolve references, so linting one domain does not report its siblings as missing.
   */
  paths?: string[];
}

const MANIFEST_FILE = 'tecton.yaml';
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', 'test-results']);
const SEARCHED = 'searched: workspace, dependency paths, installed packages';

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

/** Every directory under `root` with a package.json, skipping dependencies, build output and hidden directories. */
function findPackageDirectories(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIPPED_DIRECTORIES.has(entry.name)) walk(join(dir, entry.name));
      } else if (entry.name === 'package.json') {
        found.push(dir);
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

function manifestFileOf(path: string): string {
  return existsSync(path) && statSync(path).isDirectory() ? join(path, MANIFEST_FILE) : path;
}

/** Manifest files declared by an installed package through `"tecton": { "manifests": [...] }` (files or directories). */
function packageManifests(packageJsonFile: string): string[] {
  const tecton = readJson(packageJsonFile)?.['tecton'];
  const manifests = tecton && typeof tecton === 'object' ? (tecton as Record<string, unknown>)['manifests'] : undefined;
  if (!Array.isArray(manifests)) return [];
  return manifests
    .filter((path): path is string => typeof path === 'string')
    .map((path) => manifestFileOf(resolve(dirname(packageJsonFile), path)));
}

/** Best-effort `domain` of a manifest that failed validation, so references to it say why. */
function declaredDomain(source: string): string | undefined {
  // parseDocument + get: no alias expansion and no process warnings for odd keys (e.g. templates).
  const domain = parseDocument(source).get('domain');
  return typeof domain === 'string' ? domain : undefined;
}

/**
 * Lints manifests: per-file validation (Stories 1.2-1.5) plus cross-domain references,
 * resolved in order: (1) workspace manifests, (2) explicit `{ domain, path }` dependency
 * paths, (3) manifests exported by installed npm packages. A path the developer wrote by hand
 * wins over a package that happens to declare the same domain.
 */
export function lintWorkspace({ cwd, paths }: LintOptions): LintResult {
  const root = resolve(cwd);
  const problems: LintProblem[] = [];
  const display = (file: string) => relative(root, file).split(sep).join('/');
  const report = (file: string, source: string, segments: Array<string | number>, code: ManifestErrorCode, message: string, severity: LintSeverity = 'error') => {
    const position: Position | undefined = createLocator(source)(segments);
    problems.push({ file: display(file), severity, path: formatPath(segments), code, message, ...(position ?? {}) });
  };

  // Each file is read and parsed once, whatever the number of references to it; its problems
  // are reported only when it is a lint target (`report: true`) or a dependency of one.
  const cache = new Map<string, Loaded | undefined>();
  const reported = new Set<string>();
  /** Domains whose manifest exists but is invalid, so references to them say so. */
  const invalidDomains = new Map<string, string>();
  const loadFile = (file: string, origin: Origin, reportProblems: boolean): Loaded | undefined => {
    if (!cache.has(file)) {
      let source: string;
      try {
        source = readFileSync(file, 'utf8');
      } catch (error) {
        const reason = (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error));
        if (reportProblems) problems.push({ file: display(file), severity: 'error', path: '', code: 'unreadable-file', message: `cannot read the manifest (${reason})` });
        reported.add(file);
        cache.set(file, undefined);
        return undefined;
      }
      const result = parseManifest(source);
      if (result.ok) {
        cache.set(file, { file, source, manifest: result.manifest, origin });
      } else {
        cache.set(file, undefined);
        const domain = declaredDomain(source);
        if (domain !== undefined && !invalidDomains.has(domain)) invalidDomains.set(domain, display(file));
        if (reportProblems) {
          for (const error of result.errors) problems.push({ ...error, file: display(file), severity: 'error' });
          reported.add(file);
        }
      }
    }
    return cache.get(file);
  };

  // (1) Workspace: the lint targets, plus every other manifest under the root for resolution.
  const targets = paths && paths.length > 0 ? paths.map((path) => resolve(root, path)) : [root];
  const targetFiles: string[] = [];
  for (const target of targets) {
    if (!existsSync(target)) {
      problems.push({ file: display(target), severity: 'error', path: '', code: 'path-not-found', message: `path not found: ${display(target)}` });
      continue;
    }
    for (const file of statSync(target).isDirectory() ? findManifests(target) : [target]) {
      if (!targetFiles.includes(file)) targetFiles.push(file);
    }
  }
  const targetSet = new Set(targetFiles);
  const workspaceFiles = [...targetFiles, ...(existsSync(root) ? findManifests(root).filter((file) => !targetSet.has(file)) : [])];

  const workspace: Loaded[] = [];
  const domains = new Map<string, Loaded>();
  for (const file of workspaceFiles) {
    const isTarget = targetSet.has(file);
    const loaded = loadFile(file, 'workspace', isTarget);
    if (!loaded) continue;
    const existing = domains.get(loaded.manifest.domain);
    if (existing) {
      if (isTarget) {
        report(file, loaded.source, ['domain'], 'duplicate-name', `domain ${JSON.stringify(loaded.manifest.domain)} is already declared in ${display(existing.file)}`);
      }
      continue;
    }
    domains.set(loaded.manifest.domain, loaded);
    if (isTarget) workspace.push(loaded);
  }

  const index = (loaded: Loaded) => {
    if (!domains.has(loaded.manifest.domain)) domains.set(loaded.manifest.domain, loaded);
  };

  // (2) Explicit dependency paths of the linted manifests.
  for (const loaded of workspace) {
    loaded.manifest.dependencies.forEach((domain, position) => {
      const declared = loaded.manifest.dependencyPaths[domain];
      if (declared === undefined) return;
      const target = manifestFileOf(resolve(dirname(loaded.file), declared));
      if (!existsSync(target)) {
        report(loaded.file, loaded.source, ['dependencies', position], 'unresolved-reference', `dependencies[${position}] path ${JSON.stringify(declared)} for domain "${domain}" does not exist`);
        return;
      }
      const dependency = loadFile(target, 'path', !reported.has(target));
      if (!dependency) return;
      if (dependency.manifest.domain !== domain) {
        report(loaded.file, loaded.source, ['dependencies', position], 'unresolved-reference', `dependencies[${position}] path ${JSON.stringify(declared)} declares domain "${dependency.manifest.domain}", not "${domain}"`);
        return;
      }
      index(dependency);
    });
  }

  // (3) Installed packages declared by any package of the workspace: the root, each linted domain
  // and every other workspace package (e.g. apps/auth, which installs @tecton/auth).
  const seenPackages = new Set<string>();
  const searchDirs = [...new Set([root, ...workspace.map((loaded) => dirname(loaded.file)), ...(existsSync(root) ? findPackageDirectories(root) : [])])];
  for (const dir of searchDirs) {
    for (const name of dependencyNames(readJson(join(dir, 'package.json')))) {
      const packageJson = findPackageJson(name, dir);
      if (!packageJson || seenPackages.has(packageJson)) continue;
      seenPackages.add(packageJson);
      for (const file of packageManifests(packageJson)) {
        if (!existsSync(file)) continue;
        const loaded = loadFile(file, 'package', !reported.has(file));
        if (loaded) index(loaded);
      }
    }
  }

  // Directory classes: one declaring domain per class name.
  const classOwners = new Map<string, Loaded>();
  for (const loaded of domains.values()) {
    const name = loaded.manifest.objectClass?.name;
    if (name !== undefined && !classOwners.has(name)) classOwners.set(name, loaded);
  }
  const classes = new Set<string>([...BUILTIN_DIRECTORY_CLASSES, ...classOwners.keys()]);
  const notFound = (domain: string) => {
    const invalid = invalidDomains.get(domain);
    return invalid === undefined ? `which was not found (${SEARCHED})` : `whose manifest ${invalid} is invalid`;
  };

  // Cross-domain references of the linted manifests.
  for (const loaded of workspace) {
    const { manifest, file, source } = loaded;
    const objectClass = manifest.objectClass;
    if (objectClass) {
      const owner = classOwners.get(objectClass.name);
      if (owner && owner !== loaded) {
        report(file, source, ['objectClass', 'name'], 'duplicate-name', `objectClass.name "${objectClass.name}" is already declared by domain "${owner.manifest.domain}" (${display(owner.file)})`);
      }
      if (objectClass.extends !== BASE_DIRECTORY_CLASS && !classOwners.has(objectClass.extends)) {
        report(file, source, ['objectClass', 'extends'], 'unresolved-reference', `objectClass.extends references class "${objectClass.extends}", which no manifest declares (${SEARCHED})`);
      } else if (objectClass.extends === objectClass.name) {
        report(file, source, ['objectClass', 'extends'], 'unresolved-reference', `objectClass.extends cannot be the class itself ("${objectClass.name}")`);
      }
      for (const side of ['allowedParents', 'allowedChildren'] as const) {
        objectClass.containment[side].forEach((name, position) => {
          if (!classes.has(name))
            report(file, source, ['objectClass', 'containment', side, position], 'unresolved-reference', `objectClass.containment.${side}[${position}] references class "${name}", which no manifest declares (${SEARCHED})`);
        });
      }
    }
    manifest.events.consumes.forEach((reference, position) => {
      const [domain = '', event = ''] = reference.split('.');
      const origin = domains.get(domain);
      const segments = ['events', 'consumes', position];
      if (!origin) report(file, source, segments, 'unresolved-reference', `events.consumes[${position}] references domain "${domain}", ${notFound(domain)}`);
      else if (!origin.manifest.events.publishes.some((published) => published.name === event))
        report(file, source, segments, 'unresolved-reference', `events.consumes[${position}] references event "${event}" of domain "${domain}", which does not publish it`);
    });
    manifest.dependencies.forEach((domain, position) => {
      if (manifest.dependencyPaths[domain] !== undefined) return; // checked in (2)
      if (!domains.has(domain))
        report(file, source, ['dependencies', position], 'unresolved-reference', `dependencies[${position}] references domain "${domain}", ${notFound(domain)}`);
    });
  }

  // The verifiable domains section of AGENTS.md (Story 1.10): only meaningful for the whole workspace.
  if (!paths || paths.length === 0) {
    for (const divergence of checkAgentsDocument(root, workspace.map((loaded) => loaded.manifest))) {
      problems.push({
        file: AGENTS_FILE,
        severity: 'warning',
        path: '',
        code: 'agents-md-divergence',
        message: divergence.message,
        line: divergence.line,
        column: 1,
      });
    }
  }

  // Synchronous dependency cycles: a warning each (they may be intentional, e.g. auth <-> directory),
  // reported on the first linted manifest of the cycle.
  const linted = new Set(workspace);
  for (const cycle of findCycles(domains)) {
    const owner = cycle.map((domain) => domains.get(domain)).find((loaded): loaded is Loaded => loaded !== undefined && linted.has(loaded));
    if (!owner) continue;
    const at = cycle.indexOf(owner.manifest.domain);
    const fromOwner = [...cycle.slice(at), ...cycle.slice(0, at)];
    report(owner.file, owner.source, ['dependencies'], 'dependency-cycle', `dependency cycle: ${fromOwner.join(' -> ')} -> ${fromOwner[0]}`, 'warning');
  }

  problems.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0) || a.path.localeCompare(b.path));
  return { manifests: targetFiles.length, problems };
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
