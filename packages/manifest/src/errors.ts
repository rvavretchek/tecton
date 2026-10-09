import type { ErrorObject } from 'ajv';
import { SUPPORTED_MANIFEST_VERSIONS, manifestJsonSchema } from './schema.js';
import type { ManifestError, ManifestErrorCode } from './types.js';

/** Path segments as used by the YAML document (`['dependencies', 2]`). */
export type PathSegments = Array<string | number>;

/** `['dependencies', 2]` -> `dependencies[2]`. */
export function formatPath(segments: PathSegments): string {
  return segments.reduce<string>((path, segment) => {
    if (typeof segment === 'number') return `${path}[${segment}]`;
    return path === '' ? segment : `${path}.${segment}`;
  }, '');
}

/** Ajv instancePath (`/dependencies/2`) -> segments, with numeric array indices. */
function toSegments(instancePath: string): PathSegments {
  if (instancePath === '') return [];
  return instancePath
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

const KNOWN_TOP_LEVEL_KEYS = Object.keys(manifestJsonSchema.properties);

/** Levenshtein distance, small strings only. */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j] ?? 0;
      row[j] = Math.min(current + 1, (row[j - 1] ?? 0) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length] ?? 0;
}

function suggestKey(unknown: string): string | undefined {
  return KNOWN_TOP_LEVEL_KEYS.find((key) => editDistance(unknown, key) === 1);
}

const FORMAT_HINTS: Record<string, string> = {
  domain: 'must be kebab-case (lowercase letters, digits and single hyphens, up to 63 characters), e.g. "leave-requests"',
  version: 'must be a semantic version, e.g. "1.0.0"',
  description: 'must not be empty',
};

function typeMessage(path: string, field: string | number | undefined, expected: string): string {
  if (path === 'manifestVersion') return `manifestVersion must be a quoted string, e.g. "${SUPPORTED_MANIFEST_VERSIONS[0]}"`;
  if (path === 'version') return 'version must be a quoted semantic version string, e.g. "1.0.0"';
  if (typeof field === 'number') return `${path} must be a ${expected}`;
  return `${path} must be ${expected === 'array' ? 'a list' : `a ${expected}`}`;
}

function formatMessage(path: string, segments: PathSegments, value: unknown): string {
  const field = segments[0];
  const last = segments.at(-1);
  if (field === 'actions') {
    if (last === 'name' && segments.length === 3) return `${path} must be camelCase, e.g. "createTenant"`;
    if (segments.at(-2) === 'requires') return `${path} must have the form <resource>:<action>, e.g. "tenant:create"; got ${JSON.stringify(value)}`;
    if (last === 'emit') return `${path} must be an event name in PascalCase, e.g. "LeaveApproved"`;
    if (last === 'description' || last === 'role' || last === 'scope') return `${path} must not be empty`;
  }
  if (typeof field === 'string' && segments.length === 1 && FORMAT_HINTS[field]) return `${path} ${FORMAT_HINTS[field]}`;
  if (field === 'dependencies') return `${path} must be a domain name in kebab-case, e.g. "billing"; got ${JSON.stringify(value)}`;
  return `${path} has an invalid format`;
}

export interface TranslatedError {
  error: Omit<ManifestError, 'line' | 'column'>;
  /** Where to look up the source position. */
  locate: { segments: PathSegments; key?: boolean };
}

function valueAt(data: unknown, segments: PathSegments): unknown {
  return segments.reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') return undefined;
    return (current as Record<string | number, unknown>)[segment];
  }, data);
}

/** Converts Ajv errors into manifest errors (English, stable codes, dotted paths). */
export function translateAjvErrors(ajvErrors: readonly ErrorObject[], data: unknown): TranslatedError[] {
  const translated: TranslatedError[] = [];

  for (const ajvError of ajvErrors) {
    // Ajv reports a failed propertyNames twice: the inner keyword (with `propertyName`) and the
    // propertyNames summary. Keep only the summary.
    if (ajvError.propertyName !== undefined) continue;
    const segments = toSegments(ajvError.instancePath);
    const path = formatPath(segments);
    const push = (code: ManifestErrorCode, message: string, locate: TranslatedError['locate']) =>
      translated.push({ error: { path: locate.key ? formatPath(locate.segments) : path, code, message }, locate });

    switch (ajvError.keyword) {
      case 'required': {
        const missing = String(ajvError.params['missingProperty']);
        const missingPath = formatPath([...segments, missing]);
        const why = segments.at(-1) === 'sensitive' && missing === 'description' ? ': explain why this action is sensitive' : '';
        translated.push({
          error: { path: missingPath, code: 'required', message: `${missingPath} is required${why}` },
          locate: { segments },
        });
        break;
      }
      case 'propertyNames': {
        const name = String(ajvError.params['propertyName']);
        const keySegments = [...segments, name];
        const keyPath = formatPath(keySegments);
        translated.push({
          error: { path: keyPath, code: 'invalid-format', message: `${keyPath}: field names must be camelCase, e.g. "displayName"` },
          locate: { segments: keySegments, key: true },
        });
        break;
      }
      case 'additionalProperties': {
        const key = String(ajvError.params['additionalProperty']);
        const keySegments = [...segments, key];
        const suggestion = segments.length === 0 ? suggestKey(key) : undefined;
        const scope = segments.length === 0 ? 'top-level key' : 'key';
        const message = `unknown ${scope} "${key}"${suggestion ? `; did you mean "${suggestion}"?` : ''}`;
        push('unknown-key', message, { segments: keySegments, key: true });
        break;
      }
      case 'type':
        push('invalid-type', typeMessage(path, segments.at(-1), String(ajvError.params['type'])), { segments });
        break;
      case 'enum':
        if (path === 'manifestVersion') {
          const supported = SUPPORTED_MANIFEST_VERSIONS.map((version) => `"${version}"`).join(', ');
          push(
            'unsupported-manifest-version',
            `unsupported manifestVersion ${JSON.stringify(valueAt(data, segments))}; supported versions: ${supported}`,
            { segments },
          );
        } else {
          push('invalid-format', `${path} must be one of the allowed values`, { segments });
        }
        break;
      case 'pattern':
      case 'maxLength':
      case 'minLength':
        push('invalid-format', formatMessage(path, segments, valueAt(data, segments)), { segments });
        break;
      case 'uniqueItems': {
        // Report the later occurrence: the first one is the "original".
        const index = Math.max(Number(ajvError.params['i']), Number(ajvError.params['j']));
        const itemSegments = [...segments, index];
        const itemPath = formatPath(itemSegments);
        const value = JSON.stringify(valueAt(data, itemSegments));
        translated.push({
          error: { path: itemPath, code: 'duplicate-item', message: `${itemPath} ${value} is listed more than once` },
          locate: { segments: itemSegments },
        });
        break;
      }
      default:
        push('invalid-format', `${path || 'manifest'} is invalid (${ajvError.keyword})`, { segments });
    }
  }

  // A wrong type already explains the field; drop other errors reported for the same path.
  const typed = new Set(translated.filter((t) => t.error.code === 'invalid-type').map((t) => t.error.path));
  return translated.filter((t) => t.error.code === 'invalid-type' || !typed.has(t.error.path));
}
