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
      description: 'Domains this domain calls synchronously through the generated ServiceClient.',
      type: 'array',
      items: domainName,
      uniqueItems: true,
    },
    actions: {
      description: 'Typed actions exposed by the domain.',
    },
    events: {
      description: 'Events published and consumed by the domain.',
    },
    objectClass: {
      description: 'Directory object class; only for domains that live in the Directory tree.',
    },
  },
} as const;
