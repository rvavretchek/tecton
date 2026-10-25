import { formatPath, type TranslatedError } from './errors.js';
import { compileFields, type ObjectSchema } from './field-types.js';
import { toKebabCase } from './naming.js';
import type { ActionAuth, ManifestAction } from './types.js';

type RawObject = Record<string, unknown>;

function isObject(value: unknown): value is RawObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((item) => typeof item === 'string');
}

/**
 * Rules that JSON Schema cannot express with clear messages: auth shape, mutual exclusion,
 * unique names and short-type parsing. Defensive: runs even when the structure is invalid,
 * skipping whatever is not shaped as expected (Ajv already reported it).
 */
export function checkActions(actions: unknown): TranslatedError[] {
  if (!Array.isArray(actions)) return [];
  const errors: TranslatedError[] = [];
  // Keyed by kebab-case form: that is what the route is built from (exportCsv and exportCSV
  // would both become /<domain>/export-csv).
  const firstIndexByRoute = new Map<string, number>();

  actions.forEach((action, index) => {
    if (!isObject(action)) return;
    const base = ['actions', index] as const;

    if (typeof action['name'] === 'string') {
      const routeKey = toKebabCase(action['name']);
      const first = firstIndexByRoute.get(routeKey);
      if (first === undefined) {
        firstIndexByRoute.set(routeKey, index);
      } else {
        const segments = [...base, 'name'];
        const firstName = (actions[first] as RawObject)['name'];
        const message =
          firstName === action['name']
            ? `${formatPath(segments)} ${JSON.stringify(action['name'])} is already used by actions[${first}]`
            : `${formatPath(segments)} ${JSON.stringify(action['name'])} has the same route as ${JSON.stringify(firstName)} (actions[${first}]): both map to "${routeKey}"; rename one of them`;
        errors.push({ error: { path: formatPath(segments), code: 'duplicate-name', message }, locate: { segments } });
      }
    }

    const auth = action['auth'];
    // A mistyped `public` or `requires` is already reported by the schema; do not add a second error.
    const authShapeValid =
      isObject(auth) &&
      (!('public' in auth) || typeof auth['public'] === 'boolean') &&
      (!('requires' in auth) || Array.isArray(auth['requires']));
    if (isObject(auth) && authShapeValid) {
      const authPath = formatPath([...base, 'auth']);
      const isPublic = auth['public'] === true;
      const hasRequires = 'requires' in auth;
      const requires = Array.isArray(auth['requires']) ? auth['requires'] : [];
      let message: string | undefined;
      if (isPublic && hasRequires) message = `${authPath} cannot be public and require permissions at the same time`;
      else if (!isPublic && requires.length === 0)
        message = `${authPath} must declare either "public: true" or a non-empty "requires" list`;
      if (message) errors.push({ error: { path: authPath, code: 'invalid-auth', message }, locate: { segments: [...base, 'auth'] } });
    }

    const sensitive = action['sensitive'];
    // A quorum approves a request of someone: a public action has no one to approve.
    if (isObject(sensitive) && sensitive['quorum'] === true && isObject(auth) && auth['public'] === true) {
      const path = formatPath([...base]);
      errors.push({
        error: {
          path,
          code: 'mutually-exclusive',
          message: `${path} cannot be public and sensitive.quorum: quorum approval needs a verified caller`,
        },
        locate: { segments: [...base] },
      });
    }
    if (isObject(sensitive) && sensitive['quorum'] === true && 'approval' in action) {
      const path = formatPath([...base]);
      errors.push({
        error: {
          path,
          code: 'mutually-exclusive',
          message: `${path} cannot use sensitive.quorum and approval together; choose one approval primitive`,
        },
        locate: { segments: [...base] },
      });
    }

    for (const side of ['input', 'output'] as const) {
      const fields = action[side];
      if (!isStringMap(fields)) continue;
      const compiled = compileFields(fields);
      if (compiled.ok) continue;
      for (const { field, reason } of compiled.errors) {
        const segments = [...base, side, field];
        errors.push({
          error: { path: formatPath(segments), code: 'unknown-type', message: `${formatPath(segments)} has ${reason}` },
          locate: { segments },
        });
      }
    }
  });

  return errors;
}

/** Builds the typed actions of a manifest already known to be valid. */
export function buildActions(actions: unknown): ManifestAction[] {
  if (!Array.isArray(actions)) return [];
  return actions.map((raw: RawObject) => {
    const input = compileFields(raw['input'] as Record<string, string>);
    const output = compileFields(raw['output'] as Record<string, string>);
    if (!input.ok || !output.ok) throw new Error('buildActions called on an invalid action');
    const { idempotent, auth, ...rest } = raw;
    // Normalized to exactly one ActionAuth form: `{ public: false, requires }` becomes `{ requires }`.
    const rawAuth = auth as { public?: boolean; requires?: string[] };
    const normalizedAuth: ActionAuth = rawAuth.public === true ? { public: true } : { requires: rawAuth.requires ?? [] };
    return {
      ...(rest as Omit<ManifestAction, 'idempotent' | 'auth' | 'inputSchema' | 'outputSchema'>),
      auth: normalizedAuth,
      idempotent: idempotent === true,
      inputSchema: input.schema satisfies ObjectSchema,
      outputSchema: output.schema satisfies ObjectSchema,
    };
  });
}
