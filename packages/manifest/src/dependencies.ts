import { formatPath, type TranslatedError } from './errors.js';
import { DOMAIN_NAME_MAX_LENGTH, DOMAIN_NAME_PATTERN } from './schema.js';

const DOMAIN_NAME = new RegExp(DOMAIN_NAME_PATTERN);
const REMOTE_HINT =
  'remote manifests are not supported in the MVP; declare the domain name or a local path: { domain: billing, path: ../billing/tecton.yaml }';

type RawObject = Record<string, unknown>;

function isObject(value: unknown): value is RawObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDomainName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= DOMAIN_NAME_MAX_LENGTH && DOMAIN_NAME.test(value);
}

function looksRemote(value: unknown): boolean {
  return typeof value === 'string' && value.includes('://');
}

/** Domain name of a dependency entry, when it can be determined. */
function domainOf(entry: unknown): string | undefined {
  if (isDomainName(entry)) return entry;
  if (isObject(entry) && isDomainName(entry['domain'])) return entry['domain'];
  return undefined;
}

/**
 * Checks each `dependencies` entry: a kebab-case domain name, or `{ domain, path }` with a
 * local path. Remote URLs are rejected with an explicit message.
 */
export function checkDependencies(dependencies: unknown): TranslatedError[] {
  if (!Array.isArray(dependencies)) return [];
  const errors: TranslatedError[] = [];
  const seen = new Set<string>();
  const add = (segments: Array<string | number>, code: TranslatedError['error']['code'], message: string, key = false) =>
    errors.push({ error: { path: formatPath(segments), code, message }, locate: { segments, ...(key ? { key } : {}) } });

  dependencies.forEach((entry, index) => {
    const segments = ['dependencies', index];
    const path = formatPath(segments);

    if (typeof entry === 'string') {
      if (looksRemote(entry)) return add(segments, 'unsupported-dependency', `${path}: ${REMOTE_HINT}`);
      if (!isDomainName(entry))
        return add(segments, 'invalid-format', `${path} must be a domain name in kebab-case, e.g. "billing"; got ${JSON.stringify(entry)}`);
    } else if (isObject(entry)) {
      if ('url' in entry || looksRemote(entry['path'])) return add(segments, 'unsupported-dependency', `${path}: ${REMOTE_HINT}`);
      for (const key of Object.keys(entry)) {
        if (key !== 'domain' && key !== 'path') add([...segments, key], 'unknown-key', `unknown key "${key}"`, true);
      }
      if (!('domain' in entry)) add(segments, 'required', `${path}.domain is required`);
      else if (!isDomainName(entry['domain']))
        add([...segments, 'domain'], 'invalid-format', `${path}.domain must be a domain name in kebab-case, e.g. "billing"`);
      if (!('path' in entry)) add(segments, 'required', `${path}.path is required`);
      else if (typeof entry['path'] !== 'string' || entry['path'].trim() === '')
        add([...segments, 'path'], 'invalid-format', `${path}.path must be a relative path to a tecton.yaml or its directory`);
    } else {
      return add(segments, 'invalid-type', `${path} must be a domain name or { domain, path }`);
    }

    const domain = domainOf(entry);
    if (domain === undefined) return;
    if (seen.has(domain)) add(segments, 'duplicate-item', `${path} ${JSON.stringify(domain)} is listed more than once`);
    seen.add(domain);
  });

  return errors;
}

/** Domain names and explicit paths of a manifest already known to be valid. */
export function buildDependencies(dependencies: unknown): { names: string[]; paths: Record<string, string> } {
  const names: string[] = [];
  const paths: Record<string, string> = {};
  if (!Array.isArray(dependencies)) return { names, paths };
  for (const entry of dependencies) {
    if (typeof entry === 'string') names.push(entry);
    else if (isObject(entry)) {
      names.push(entry['domain'] as string);
      paths[entry['domain'] as string] = entry['path'] as string;
    }
  }
  return { names, paths };
}
