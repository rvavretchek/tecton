import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lintWorkspace, type LintProblem } from '@tecton/manifest';
import { plural, type CliIo } from '../io.js';

export type OutputFormat = 'text' | 'json';

export interface LintCommandOptions {
  format: OutputFormat;
  cwd?: string;
  /** Files or directories to lint; default: the working directory. */
  paths?: string[];
}

function formatProblem(problem: LintProblem): string {
  const location = problem.line === undefined ? problem.file : `${problem.file}:${problem.line}:${problem.column ?? 1}`;
  return [location, problem.severity, problem.code, problem.path || '-', problem.message].join('  ');
}

/** Reports a failure that stops the lint; in JSON mode stdout still carries a JSON document. */
function fatal(message: string, options: LintCommandOptions, io: CliIo): number {
  if (options.format === 'json') {
    io.stdout.write(`${JSON.stringify({ manifests: 0, errors: 1, warnings: 0, problems: [], fatal: message }, null, 2)}\n`);
  } else {
    io.stderr.write(`${message}\n`);
  }
  return 1;
}

/** Runs `tecton-admin lint`; returns the process exit code (1 when there is any error). */
export function lintCommand(options: LintCommandOptions, io: CliIo): number {
  const dir = resolve(io.cwd, options.cwd ?? '.');
  const paths = options.paths ?? [];
  for (const path of paths) {
    if (!existsSync(resolve(dir, path))) return fatal(`path not found: ${path}`, options, io);
  }
  const { manifests, problems } = lintWorkspace({ cwd: dir, paths });

  if (manifests === 0) {
    // A workspace fresh from `tecton-admin new` has no domains yet: nothing to lint is not an error.
    if (paths.length === 0 && existsSync(join(dir, 'apps', 'domains'))) {
      if (options.format === 'json') {
        io.stdout.write(`${JSON.stringify({ manifests: 0, errors: 0, warnings: 0, problems: [] }, null, 2)}\n`);
      } else {
        io.stdout.write('no domains yet; create one with `tecton-admin generate domain <name>`\n');
      }
      return 0;
    }
    return fatal(`no tecton.yaml found under ${paths.length > 0 ? paths.join(', ') : dir}`, options, io);
  }

  const errors = problems.filter((problem) => problem.severity === 'error').length;
  const warnings = problems.length - errors;

  if (options.format === 'json') {
    io.stdout.write(`${JSON.stringify({ manifests, errors, warnings, problems }, null, 2)}\n`);
  } else {
    for (const problem of problems) io.stdout.write(`${formatProblem(problem)}\n`);
    io.stdout.write(`${plural(errors, 'error')}, ${plural(warnings, 'warning')} in ${plural(manifests, 'manifest')}\n`);
  }
  return errors > 0 ? 1 : 0;
}
