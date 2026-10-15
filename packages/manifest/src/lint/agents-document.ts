import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { TectonManifest } from '../types.js';

export const AGENTS_FILE = 'AGENTS.md';
const START = '<!-- tecton:domains:start -->';
const END = '<!-- tecton:domains:end -->';

export interface AgentsDivergence {
  /** 1-based line of the start marker. */
  line: number;
  message: string;
}

interface ListedDomain {
  name: string;
  dependencies: string[];
}

const formatList = (items: readonly string[]) => `[${items.join(', ')}]`;

/** Reads the YAML block between the domains markers; undefined when there are no markers. */
function readSection(text: string): { line: number; yaml: string } | undefined {
  const start = text.indexOf(START);
  const end = text.indexOf(END, start + START.length);
  if (start === -1 || end === -1) return undefined;
  const line = text.slice(0, start).split('\n').length;
  const body = text
    .slice(start + START.length, end)
    .replace(/^\s*```ya?ml\s*$/m, '')
    .replace(/^\s*```\s*$/m, '');
  return { line, yaml: body };
}

function listedDomains(yaml: string): ListedDomain[] | undefined {
  try {
    const data = parse(yaml) as { domains?: unknown } | null;
    if (!data || !Array.isArray(data.domains)) return undefined;
    const domains: ListedDomain[] = [];
    for (const entry of data.domains) {
      if (!entry || typeof entry !== 'object' || typeof (entry as { name?: unknown }).name !== 'string') return undefined;
      const dependencies = (entry as { dependencies?: unknown }).dependencies ?? [];
      if (!Array.isArray(dependencies) || !dependencies.every((item) => typeof item === 'string')) return undefined;
      domains.push({ name: (entry as { name: string }).name, dependencies });
    }
    return domains;
  } catch {
    return undefined;
  }
}

/**
 * Compares the verifiable domains section of AGENTS.md (written by agents, see the agents guide
 * of @tecton/cli) with the workspace manifests. Divergences are warnings, never errors.
 */
export function checkAgentsDocument(root: string, manifests: readonly TectonManifest[]): AgentsDivergence[] {
  const file = join(root, AGENTS_FILE);
  if (!existsSync(file)) return [];
  const section = readSection(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
  if (!section) return [];

  const listed = listedDomains(section.yaml);
  if (!listed) {
    return [{ line: section.line, message: 'the AGENTS.md domains section is not valid: expected YAML "domains: [{ name, dependencies }]"' }];
  }

  const divergences: AgentsDivergence[] = [];
  const byName = new Map<string, ListedDomain>();
  for (const domain of listed) {
    if (byName.has(domain.name)) {
      divergences.push({ line: section.line, message: `domain "${domain.name}" is listed more than once in the AGENTS.md domains section` });
    } else {
      byName.set(domain.name, domain);
    }
  }
  const actual = new Map(manifests.map((manifest) => [manifest.domain, manifest]));

  for (const manifest of [...actual.values()].sort((a, b) => a.domain.localeCompare(b.domain))) {
    const entry = byName.get(manifest.domain);
    if (!entry) {
      divergences.push({ line: section.line, message: `domain "${manifest.domain}" has a manifest but is not listed in the AGENTS.md domains section` });
      continue;
    }
    const expected = [...manifest.dependencies].sort();
    const documented = [...entry.dependencies].sort();
    if (expected.join(',') !== documented.join(',')) {
      divergences.push({
        line: section.line,
        message: `dependencies of "${manifest.domain}" differ: AGENTS.md lists ${formatList(documented)} but the manifest declares ${formatList(expected)}`,
      });
    }
  }
  for (const entry of [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!actual.has(entry.name)) {
      divergences.push({ line: section.line, message: `domain "${entry.name}" is listed but has no manifest (AGENTS.md domains section)` });
    }
  }
  return divergences;
}
