import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DOMAIN_NAME_MAX_LENGTH, DOMAIN_NAME_PATTERN } from '@tecton/manifest';
import type { CliIo } from '../io.js';
import { linkSpec, renderTemplate, versionSpec, type DependencySpec } from '../templates.js';

const NAME = new RegExp(DOMAIN_NAME_PATTERN);

export interface NewCommandOptions {
  /** Path to a local checkout of the Tecton framework; @tecton/* become pnpm `link:` dependencies. */
  framework?: string;
}

function isEmptyDirectory(path: string): boolean {
  return statSync(path).isDirectory() && readdirSync(path).length === 0;
}

/** True when `path` is a checkout of the Tecton framework repository. */
export function isFrameworkCheckout(path: string): boolean {
  const cliManifest = join(path, 'packages', 'cli', 'package.json');
  return existsSync(cliManifest) && (JSON.parse(readFileSync(cliManifest, 'utf8')) as { name?: string }).name === '@tecton/cli';
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

  let dependency: DependencySpec = versionSpec();
  if (options.framework !== undefined) {
    const framework = resolve(io.cwd, options.framework);
    if (!isFrameworkCheckout(framework)) {
      io.stderr.write(`--framework ${options.framework} is not a Tecton framework checkout (packages/cli/package.json not found)\n`);
      return 1;
    }
    dependency = linkSpec(framework);
  }

  renderTemplate('workspace', target, { name }, dependency);

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
