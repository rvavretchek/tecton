import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { DOMAIN_NAME_MAX_LENGTH, DOMAIN_NAME_PATTERN, SUPPORTED_MANIFEST_VERSIONS } from '@tecton/manifest';
import { writeDevServices } from '../dev-services.js';
import type { CliIo } from '../io.js';
import { renderTemplate } from '../templates.js';
import { findWorkspace } from '../workspace.js';

const NAME = new RegExp(DOMAIN_NAME_PATTERN);
const CURRENT_MANIFEST_VERSION = SUPPORTED_MANIFEST_VERSIONS[SUPPORTED_MANIFEST_VERSIONS.length - 1] ?? '0.1';

export interface GenerateDomainOptions {
  /** Text file with one domain name per line; blank lines and lines starting with # are ignored. */
  from?: string;
}

function namesFromFile(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** Runs `tecton-admin generate domain <names...>`; creates all domains or none. */
export function generateDomainCommand(names: string[], options: GenerateDomainOptions, io: CliIo): number {
  const workspace = findWorkspace(io.cwd);
  if (!workspace) {
    io.stderr.write('not inside a Tecton workspace; create one with `tecton-admin new <name>` and run this command inside it\n');
    return 1;
  }

  const requested = [...names];
  if (options.from !== undefined) {
    const file = resolve(io.cwd, options.from);
    if (!existsSync(file)) {
      io.stderr.write(`file not found: ${options.from}\n`);
      return 1;
    }
    requested.push(...namesFromFile(file));
  }
  if (requested.length === 0) {
    io.stderr.write('no domain names given; pass names or --from <file>\n');
    return 1;
  }

  const domainsDir = join(workspace.root, 'apps', 'domains');
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const name of requested) {
    if (!NAME.test(name) || name.length > DOMAIN_NAME_MAX_LENGTH) problems.push(`"${name}" is not kebab-case (e.g. "finance", "leave-requests")`);
    else if (seen.has(name)) problems.push(`"${name}" is listed more than once`);
    else if (existsSync(join(domainsDir, name))) problems.push(`"${name}" already exists in apps/domains`);
    seen.add(name);
  }
  if (problems.length > 0) {
    io.stderr.write(`no domain was created:\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`);
    return 1;
  }

  for (const domain of requested) {
    renderTemplate(
      'domain',
      join(domainsDir, domain),
      { domain, workspace: workspace.name, manifestVersion: CURRENT_MANIFEST_VERSION },
      workspace.dependency,
    );
  }
  // Each domain gets its own logical database in Dev Services (FR-30).
  writeDevServices(workspace.root);

  const created = requested.map((domain) => `  ${relative(io.cwd, join(domainsDir, domain)).split(sep).join('/') || '.'}`);
  io.stdout.write(
    [
      `Created ${requested.length} domain(s):`,
      ...created,
      '',
      'Agent: update the domains section of AGENTS.md (between <!-- tecton:domains:start --> and',
      '<!-- tecton:domains:end -->) with the new domains; `tecton-admin lint` warns while it diverges.',
      '',
    ].join('\n'),
  );
  return 0;
}
