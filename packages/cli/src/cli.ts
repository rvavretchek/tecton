import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { generateDomainCommand } from './commands/generate-domain.js';
import { lintCommand, type OutputFormat } from './commands/lint.js';
import { newCommand } from './commands/new.js';
import type { CliIo } from './io.js';

function parseFormat(value: string): OutputFormat {
  if (value === 'text' || value === 'json') return value;
  throw new InvalidArgumentError(`unsupported format "${value}"; use text or json`);
}

function buildProgram(io: CliIo, setExitCode: (code: number) => void): Command {
  const program = new Command('tecton-admin')
    .description('Command-line tool of the Tecton framework.')
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.stdout.write(text), writeErr: (text) => io.stderr.write(text) });

  program
    .command('lint')
    .description('Validate every tecton.yaml in the workspace and resolve references between domains.')
    .argument('[paths...]', 'files or directories to lint (directories are searched for tecton.yaml)')
    .addOption(new Option('--format <format>', 'output format: text or json').default('text').argParser(parseFormat))
    .option('--cwd <dir>', 'base directory; paths are relative to it (default: current directory)')
    .action((paths: string[], options: { format: OutputFormat; cwd?: string }) => {
      setExitCode(lintCommand({ ...options, paths }, io));
    });

  program
    .command('new')
    .description('Create a Tecton workspace (pnpm + Turborepo) in a new directory.')
    .argument('<name>', 'workspace name in kebab-case; also the directory to create')
    .option('--framework <path>', 'link @tecton/* to a local checkout of the framework instead of the registry')
    .addHelpText('after', '\nExample:\n  $ tecton-admin new acme-platform\n')
    .action((name: string, options: { framework?: string }) => {
      setExitCode(newCommand(name, options, io));
    });

  const generate = program.command('generate').description('Generate code in the current Tecton workspace.');
  generate
    .command('domain')
    .description('Generate one or more domains in apps/domains, each with a valid tecton.yaml and a runnable service.')
    .argument('[names...]', 'domain names in kebab-case')
    .option('--from <file>', 'read domain names from a file, one per line (blank lines and # comments are ignored)')
    .addHelpText('after', '\nExamples:\n  $ tecton-admin generate domain finance inventory sales\n  $ tecton-admin generate domain --from domains.txt\n')
    .action((names: string[], options: { from?: string }) => {
      setExitCode(generateDomainCommand(names, options, io));
    });

  return program;
}

/** Runs tecton-admin with `args` (without node and script path); resolves to the exit code. */
export async function run(args: string[], io: CliIo): Promise<number> {
  let exitCode = 0;
  const program = buildProgram(io, (code) => {
    exitCode = code;
  });
  try {
    await program.parseAsync(args, { from: 'user' });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    throw error;
  }
}
