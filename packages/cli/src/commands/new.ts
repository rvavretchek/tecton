import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMAIN_NAME_MAX_LENGTH, DOMAIN_NAME_PATTERN } from '@tecton/manifest';
import type { CliIo } from '../io.js';

/** Root of the installed @tecton/cli package (works from src/ in tests and from dist/). */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE_DIR = join(packageRoot, 'templates', 'workspace');
const NAME = new RegExp(DOMAIN_NAME_PATTERN);

/** Templates are shipped without leading dots (npm drops .gitignore on publish). */
const RENAMED: Record<string, string> = { _gitignore: '.gitignore', '_node-version': '.node-version', _gitkeep: '.gitkeep' };

export interface NewCommandOptions {
  /** Path to a local checkout of the Tecton framework; @tecton/* become pnpm `link:` dependencies. */
  framework?: string;
}

function cliVersion(): string {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

function templateFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? templateFiles(path) : [path];
  });
}

function isEmptyDirectory(path: string): boolean {
  return statSync(path).isDirectory() && readdirSync(path).length === 0;
}

/** Runs `tecton-admin new <name>`; returns the process exit code. */
export function newCommand(name: string, options: NewCommandOptions, io: CliIo): number {
  if (!NAME.test(name) || name.length > DOMAIN_NAME_MAX_LENGTH) {
    io.stderr.write(
      `invalid project name "${name}": use kebab-case (lowercase letters, digits and single hyphens, starting with a letter), e.g. "acme-platform"\n`,
    );
    return 1;
  }

  const target = resolve(io.cwd, name);
  if (existsSync(target) && !isEmptyDirectory(target)) {
    io.stderr.write(`${target} already exists and is not empty; nothing was written\n`);
    return 1;
  }

  let dependency: (pkg: string) => string;
  if (options.framework !== undefined) {
    const framework = resolve(io.cwd, options.framework);
    const cliManifest = join(framework, 'packages', 'cli', 'package.json');
    const isFramework = existsSync(cliManifest) && (JSON.parse(readFileSync(cliManifest, 'utf8')) as { name?: string }).name === '@tecton/cli';
    if (!isFramework) {
      io.stderr.write(`--framework ${options.framework} is not a Tecton framework checkout (packages/cli/package.json not found)\n`);
      return 1;
    }
    // AD-4: link to the checkout, never copy framework code into the workspace.
    dependency = (pkg) => `link:${relative(target, join(framework, 'packages', pkg)).split(sep).join('/')}`;
  } else {
    const version = `^${cliVersion()}`;
    dependency = () => version;
  }

  for (const source of templateFiles(TEMPLATE_DIR)) {
    const parts = relative(TEMPLATE_DIR, source).split(sep).map((part) => RENAMED[part] ?? part);
    const destination = join(target, ...parts);
    const content = readFileSync(source, 'utf8')
      .replaceAll('{{name}}', name)
      .replace(/\{\{tecton:([a-z-]+)\}\}/g, (_match, pkg: string) => dependency(pkg));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }

  io.stdout.write(
    [
      `Created Tecton workspace "${name}" in ${target}`,
      '',
      'Next steps:',
      `  cd ${name}`,
      '  pnpm install',
      '  pnpm exec tecton-admin generate domain <name>',
      '',
      'AGENTS.md and README.md are seeds: ask your AI agent to write them (see AGENTS.md).',
      '',
    ].join('\n'),
  );
  return 0;
}
