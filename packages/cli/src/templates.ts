import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root of the installed @tecton/cli package (works from src/ in tests and from dist/). */
export const CLI_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Templates are shipped without leading dots (npm drops .gitignore on publish). */
const RENAMED: Record<string, string> = { _gitignore: '.gitignore', '_node-version': '.node-version', _gitkeep: '.gitkeep' };

/** Resolves the dependency spec of a @tecton package (`^x.y.z` or `link:...`) for a target directory. */
export type DependencySpec = (pkg: string, targetDir: string) => string;

function templateFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? templateFiles(path) : [path];
  });
}

export function cliVersion(): string {
  return (JSON.parse(readFileSync(join(CLI_PACKAGE_ROOT, 'package.json'), 'utf8')) as { version: string }).version;
}

/** Spec that points @tecton/* to the published version of the running CLI. */
export function versionSpec(): DependencySpec {
  const version = `^${cliVersion()}`;
  return () => version;
}

/** Spec that pins every @tecton/* package to `spec` (the one the workspace uses for @tecton/cli). */
export function fixedSpec(spec: string): DependencySpec {
  return () => spec;
}

/** Spec that links @tecton/* to a local framework checkout (AD-4: link, never copy). */
export function linkSpec(frameworkRoot: string): DependencySpec {
  return (pkg, targetDir) => `link:${relative(targetDir, join(frameworkRoot, 'packages', pkg)).split(sep).join('/')}`;
}

/**
 * Copies a template directory into `target`, replacing `{{key}}` with `variables[key]` and
 * `{{tecton:<pkg>}}` with the dependency spec of that package.
 */
export function renderTemplate(template: string, target: string, variables: Record<string, string>, dependency: DependencySpec): string[] {
  const templateDir = join(CLI_PACKAGE_ROOT, 'templates', template);
  const written: string[] = [];
  for (const source of templateFiles(templateDir)) {
    const parts = relative(templateDir, source).split(sep).map((part) => RENAMED[part] ?? part);
    const destination = join(target, ...parts);
    const content = readFileSync(source, 'utf8')
      .replace(/\{\{tecton:([a-z-]+)\}\}/g, (_match, pkg: string) => dependency(pkg, target))
      .replace(/\{\{([a-zA-Z]+)\}\}/g, (match, key: string) => variables[key] ?? match);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
    written.push(destination);
  }
  return written;
}
