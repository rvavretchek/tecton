import { formatPath, type TranslatedError } from './errors.js';
import { compileFields } from './field-types.js';
import type { ManifestEvent, ManifestEvents } from './types.js';

type RawObject = Record<string, unknown>;

function isObject(value: unknown): value is RawObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((item) => typeof item === 'string');
}

/** PascalCase -> kebab-case; runs of capitals count as one word (`ExportCSVReady` -> `export-csv-ready`). */
function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * CloudEvents `type` of a published event: `com.tecton.<domain>.<event-name-in-kebab-case>`.
 * The event name is kept whole (no domain prefix is stripped), so two different events of a
 * domain can never map to the same type: ('tenant', 'TenantCreated') -> 'com.tecton.tenant.tenant-created'.
 */
export function cloudEventType(domain: string, eventName: string): string {
  return `com.tecton.${domain}.${toKebabCase(eventName)}`;
}

function publishedNames(events: unknown): Set<string> {
  const names = new Set<string>();
  if (!isObject(events) || !Array.isArray(events['publishes'])) return names;
  for (const event of events['publishes']) {
    if (isObject(event) && typeof event['name'] === 'string') names.add(event['name']);
  }
  return names;
}

/**
 * Rules beyond JSON Schema: unique event names, payload short types and approval `emit`
 * references. Defensive, like the action checks: skips anything not shaped as expected.
 */
export function checkEvents(events: unknown, actions: unknown): TranslatedError[] {
  const errors: TranslatedError[] = [];

  if (isObject(events) && Array.isArray(events['publishes'])) {
    const firstIndexByName = new Map<string, number>();
    events['publishes'].forEach((event, index) => {
      if (!isObject(event)) return;
      const base = ['events', 'publishes', index] as const;
      if (typeof event['name'] === 'string') {
        const first = firstIndexByName.get(event['name']);
        if (first === undefined) firstIndexByName.set(event['name'], index);
        else {
          const segments = [...base, 'name'];
          errors.push({
            error: {
              path: formatPath(segments),
              code: 'duplicate-name',
              message: `${formatPath(segments)} ${JSON.stringify(event['name'])} is already used by events.publishes[${first}]`,
            },
            locate: { segments },
          });
        }
      }
      if (isStringMap(event['schema'])) {
        const compiled = compileFields(event['schema']);
        if (!compiled.ok) {
          for (const { field, reason } of compiled.errors) {
            const segments = [...base, 'schema', field];
            errors.push({
              error: { path: formatPath(segments), code: 'unknown-type', message: `${formatPath(segments)} has ${reason}` },
              locate: { segments },
            });
          }
        }
      }
    });
  }

  if (Array.isArray(actions)) {
    const published = publishedNames(events);
    actions.forEach((action, index) => {
      if (!isObject(action) || !isObject(action['approval'])) return;
      for (const side of ['onApprove', 'onReject'] as const) {
        const target = action['approval'][side];
        if (!isObject(target) || typeof target['emit'] !== 'string' || published.has(target['emit'])) continue;
        const segments = ['actions', index, 'approval', side, 'emit'];
        errors.push({
          error: {
            path: formatPath(segments),
            code: 'unknown-event',
            message: `${formatPath(segments)} refers to event ${JSON.stringify(target['emit'])}, which is not in events.publishes`,
          },
          locate: { segments },
        });
      }
    });
  }

  return errors;
}

/** Builds the typed events of a manifest already known to be valid. */
export function buildEvents(domain: string, events: unknown): ManifestEvents {
  const raw = isObject(events) ? events : {};
  const publishes = Array.isArray(raw['publishes']) ? (raw['publishes'] as RawObject[]) : [];
  return {
    publishes: publishes.map((event): ManifestEvent => {
      const compiled = compileFields(event['schema'] as Record<string, string>);
      if (!compiled.ok) throw new Error('buildEvents called on an invalid event');
      const name = event['name'] as string;
      return {
        name,
        ...(typeof event['description'] === 'string' ? { description: event['description'] } : {}),
        schema: event['schema'] as Record<string, string>,
        type: cloudEventType(domain, name),
        payloadSchema: compiled.schema,
      };
    }),
    consumes: Array.isArray(raw['consumes']) ? (raw['consumes'] as string[]) : [],
  };
}
