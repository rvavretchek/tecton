import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { linkSpec, versionSpec, type DependencySpec } from './templates.js';

export interface TectonWorkspace {
  root: string;
  /** Workspace package name (scope of generated domain packages). */
  name: string;
  /** How generated packages depend on @tecton/*, following the workspace root. */
  dependency: DependencySpec;
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
      const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const cliSpec = pkg.devDependencies?.['@tecton/cli'] ?? pkg.dependencies?.['@tecton/cli'];
      if (cliSpec !== undefined) {
        // link:<path>/packages/cli -> the framework checkout is two levels above that path.
        const dependency = cliSpec.startsWith('link:')
          ? linkSpec(resolve(dir, cliSpec.slice('link:'.length), '..', '..'))
          : versionSpec();
        return { root: dir, name: pkg.name ?? 'workspace', dependency };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
