// JSON Schema (draft-07) of tecton.yaml. Single source of truth for validation and for
// editors/AI agents (exported as `@tecton/manifest/schema.json`). Stories 1.3-1.5 replace
// the reserved `actions`, `events` and `objectClass` entries with full definitions.

export const SUPPORTED_MANIFEST_VERSIONS = ['0.1'] as const;
export type SupportedManifestVersion = (typeof SUPPORTED_MANIFEST_VERSIONS)[number];

/** kebab-case: lowercase letters and digits, single hyphens, starting with a letter. */
export const DOMAIN_NAME_PATTERN = '^[a-z][a-z0-9]*(-[a-z0-9]+)*$';
/** Domain names become DNS labels and TECTON_SERVICE_<DOMAIN>_URL variables. */
export const DOMAIN_NAME_MAX_LENGTH = 63;
/** Official SemVer 2.0.0 regular expression (semver.org). */
export const SEMVER_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$';

// Keep this module free of imports: scripts/emit-schema.mjs loads it directly with Node's
// type stripping, which does not resolve `.js` specifiers to `.ts` files.

/** camelCase field names in input/output maps. */
export const FIELD_NAME_PATTERN = '^[a-z][a-zA-Z0-9]*$';
/** camelCase action names (the route is derived from them in kebab-case). */
export const ACTION_NAME_PATTERN = '^[a-z][a-zA-Z0-9]*$';
/** PascalCase event names. */
export const EVENT_NAME_PATTERN = '^[A-Z][a-zA-Z0-9]*$';
/** Consumed event reference: <domain in kebab-case>.<EventName in PascalCase>. */
export const CONSUMED_EVENT_PATTERN = '^[a-z][a-z0-9]*(-[a-z0-9]+)*\\.[A-Z][a-zA-Z0-9]*$';
/** Permissions: two or more lowercase segments separated by ":" (tenant:create, auth:service:register). */
export const PERMISSION_PATTERN = '^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)+$';

const nonEmptyText = { type: 'string', pattern: '\\S' } as const;

const fieldMap = {
  type: 'object',
  description:
    'Map of field name (camelCase) to type: string, number, integer, boolean, uuid, date, datetime or enum[a,b]; append "?" for optional. Quote enum inside { }: "enum[a,b]".',
  propertyNames: { pattern: FIELD_NAME_PATTERN },
  additionalProperties: { type: 'string' },
} as const;

const emitRef = {
  type: 'object',
  additionalProperties: false,
  required: ['emit'],
  properties: { emit: { type: 'string', pattern: EVENT_NAME_PATTERN, description: 'Event (PascalCase) declared in events.publishes.' } },
} as const;

const actionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'input', 'output', 'auth'],
  properties: {
    name: { type: 'string', pattern: ACTION_NAME_PATTERN, description: 'Action name in camelCase, unique in the domain.' },
    description: { ...nonEmptyText, description: 'What the action does; shown in the generated OpenAPI.' },
    input: fieldMap,
    output: fieldMap,
    auth: {
      type: 'object',
      description: 'Explicit authorization: either "public: true" or a non-empty "requires" list of permissions.',
      additionalProperties: false,
      properties: {
        public: { type: 'boolean' },
        requires: { type: 'array', items: { type: 'string', pattern: PERMISSION_PATTERN }, uniqueItems: true },
      },
    },
    idempotent: {
      type: 'boolean',
      description: 'True when the action is idempotent by nature; lets the ServiceClient retry it. Default false.',
    },
    sensitive: {
      type: 'object',
      description: 'Marks a sensitive action. quorum: true requires Custodian approval when a KeyCustodyProvider is configured.',
      additionalProperties: false,
      required: ['quorum', 'description'],
      properties: { quorum: { type: 'boolean' }, description: nonEmptyText },
    },
    approval: {
      type: 'object',
      description: 'Simple business approval. Cannot be combined with sensitive.quorum.',
      additionalProperties: false,
      required: ['required'],
      properties: {
        required: { type: 'boolean' },
        approver: {
          type: 'object',
          additionalProperties: false,
          required: ['role'],
          properties: { role: nonEmptyText, scope: nonEmptyText },
        },
        onApprove: emitRef,
        onReject: emitRef,
      },
    },
  },
} as const;

const eventsSchema = {
  type: 'object',
  description:
    'Events published and consumed by the domain. Each published event gets the CloudEvents type com.tecton.<domain>.<event-name-in-kebab-case>.',
  additionalProperties: false,
  properties: {
    publishes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'schema'],
        properties: {
          name: { type: 'string', pattern: EVENT_NAME_PATTERN, description: 'Event name in PascalCase, unique in the domain.' },
          description: { ...nonEmptyText, description: 'What happened; shown in the generated AsyncAPI.' },
          schema: { ...fieldMap, description: `Event payload. ${fieldMap.description}` },
        },
      },
    },
    consumes: {
      type: 'array',
      description: 'Events from other domains, as <domain>.<EventName>.',
      items: { type: 'string', pattern: CONSUMED_EVENT_PATTERN },
      uniqueItems: true,
    },
  },
} as const;

const className = { type: 'string', pattern: EVENT_NAME_PATTERN } as const;
const classList = { type: 'array', items: className, uniqueItems: true } as const;

const objectClassSchema = {
  type: 'object',
  description:
    'Makes the domain a class in the Directory tree (containment + inheritable ACL). Only Directory classes declare it.',
  additionalProperties: false,
  required: ['name', 'containment'],
  properties: {
    name: { ...className, description: 'Class name in PascalCase, e.g. "Tenant".' },
    extends: { ...className, description: 'Base class. Default: DirectoryObject.' },
    attributes: {
      type: 'array',
      description: 'Attributes stored on each object and edited through the generated form.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type'],
        properties: {
          name: { type: 'string', pattern: FIELD_NAME_PATTERN, description: 'Attribute name in camelCase.' },
          type: {
            type: 'string',
            description: 'string, number, integer, boolean, uuid, date, datetime or enum (with values).',
          },
          required: { type: 'boolean', description: 'Default false.' },
          default: { description: 'Default value; must match the type.' },
          values: { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true, description: 'Allowed values of an enum.' },
          unique: { type: 'boolean', description: 'Unique across objects of the class (checked by the Directory).' },
          readOnly: { type: 'boolean', description: 'Shown but not editable through the generic attribute form.' },
        },
      },
    },
    containment: {
      type: 'object',
      additionalProperties: false,
      required: ['allowedParents'],
      properties: {
        allowedParents: { ...classList, minItems: 1, description: 'Classes that may contain objects of this class.' },
        allowedChildren: { ...classList, description: 'Classes this class may contain. Default: none.' },
      },
    },
    acl: {
      type: 'object',
      additionalProperties: false,
      properties: { inheritable: { type: 'boolean', description: 'Permissions flow to descendants. Default true.' } },
    },
  },
} as const;

const domainName = {
  type: 'string',
  pattern: DOMAIN_NAME_PATTERN,
  maxLength: DOMAIN_NAME_MAX_LENGTH,
} as const;

export const manifestJsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  // URN instead of a URL: no dependency on an owned domain (same choice as the RFC 9457 `type`).
  $id: 'urn:tecton:schema:tecton-manifest',
  title: 'Tecton domain manifest (tecton.yaml)',
  description:
    'Declares a Tecton domain: identity, typed actions, events, dependencies and, for Directory classes, an objectClass.',
  type: 'object',
  required: ['manifestVersion', 'domain', 'version', 'description'],
  additionalProperties: false,
  properties: {
    manifestVersion: {
      description: 'Version of the manifest format. Quote it: "0.1".',
      type: 'string',
      enum: [...SUPPORTED_MANIFEST_VERSIONS],
    },
    domain: {
      ...domainName,
      description: 'Domain name in kebab-case (up to 63 characters), e.g. "leave-requests".',
    },
    version: {
      description: 'Semantic version of the domain contract, e.g. "1.0.0".',
      type: 'string',
      pattern: SEMVER_PATTERN,
    },
    description: {
      description: 'What the domain does, in one or two sentences.',
      type: 'string',
      pattern: '\\S',
    },
    dependencies: {
      description:
        'Domains this domain calls synchronously through the generated ServiceClient: a domain name ("billing") or { domain, path } with a local path to its tecton.yaml. Remote URLs are not supported.',
      type: 'array',
      // Item shape is checked in code (dependencies.ts) for clear messages; a oneOf here would
      // report every failed branch.
      items: { description: 'A domain name, or { domain, path }.' },
    },
    actions: {
      description: 'Typed actions exposed by the domain. Each one becomes POST /<domain>/<action-in-kebab-case>.',
      type: 'array',
      items: actionSchema,
    },
    events: eventsSchema,
    objectClass: objectClassSchema,
  },
} as const;
