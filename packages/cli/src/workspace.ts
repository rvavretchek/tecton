import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fixedSpec, linkSpec, type DependencySpec } from './templates.js';

/** UTF-8 byte order mark that some Windows editors write; written by code point to keep the source ASCII. */
const BYTE_ORDER_MARK = new RegExp(`^${String.fromCodePoint(0xfeff)}`);

export interface TectonWorkspace {
  root: string;
  /**
   * Workspace name, safe as an npm scope and a Docker Compose project name: the root package
   * name without `@`, with `/` and any other invalid character turned into `-`.
   */
  name: string;
  /** How generated packages depend on @tecton/*, following the workspace root. */
  dependency: DependencySpec;
}

/** An error with a message meant for the user; the CLI prints it without a stack trace. */
export class CliError extends Error {
  override readonly name = 'CliError';
}

/** Reads a JSON file, turning a syntax error into a CliError that names the file. */
export function readJsonFile<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(BYTE_ORDER_MARK, '')) as T;
  } catch (error) {
    throw new CliError(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** `@acme/Platform` -> `acme-platform`; valid as npm scope and Compose project name. */
export function safeWorkspaceName(packageName: string | undefined): string {
  const name = (packageName ?? '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|-+$/g, '');
  return name === '' ? 'workspace' : name;
}

/**
 * Finds the Tecton workspace containing `cwd`: the nearest directory with a package.json that
 * depends on @tecton/cli and an apps/domains folder (created by `tecton-admin new`).
 */
export function findWorkspace(cwd: string): TectonWorkspace | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const packageJson = join(dir, 'package.json');
    if (existsSync(packageJson) && existsSync(join(dir, 'apps', 'domains'))) {
      const pkg = readJsonFile<{
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      }>(packageJson);
      const cliSpec = pkg.devDependencies?.['@tecton/cli'] ?? pkg.dependencies?.['@tecton/cli'];
      if (cliSpec !== undefined) {
        // link:<path>/packages/cli -> the framework checkout is two levels above that path.
        // Otherwise generated packages follow the version the workspace pinned, not the running CLI.
        const dependency = cliSpec.startsWith('link:')
          ? linkSpec(resolve(dir, cliSpec.slice('link:'.length), '..', '..'))
          : fixedSpec(cliSpec);
        return { root: dir, name: safeWorkspaceName(pkg.name), dependency };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
