import type { FieldSchema, ObjectSchema } from './field-types.js';
import type { SupportedManifestVersion } from './schema.js';

/** One compiled attribute: the field schema plus Directory metadata. */
export type AttributeSchema = FieldSchema & { default?: unknown; readOnly?: true; 'x-tecton-unique'?: true };

export interface AttributesSchema {
  type: 'object';
  properties: Record<string, AttributeSchema>;
  required?: string[];
  additionalProperties: false;
}

export interface ObjectClassAttribute {
  name: string;
  type: string;
  required?: boolean;
  default?: unknown;
  values?: string[];
  unique?: boolean;
  readOnly?: boolean;
}

export interface ManifestObjectClass {
  name: string;
  /** Default: DirectoryObject. */
  extends: string;
  attributes: ObjectClassAttribute[];
  containment: { allowedParents: string[]; allowedChildren: string[] };
  /** Default: inheritable true. */
  acl: { inheritable: boolean };
  /** `attributes` compiled to JSON Schema draft-07 (closed object, with x-tecton-unique). */
  attributesSchema: AttributesSchema;
}

export interface ManifestEvent {
  /** PascalCase, unique in the domain. */
  name: string;
  description?: string;
  /** Payload fields with their short types, as written in the manifest. */
  schema: Record<string, string>;
  /** CloudEvents `type`: com.tecton.<domain>.<event-name-in-kebab-case>. */
  type: string;
  /** `schema` compiled to JSON Schema draft-07 (closed object). */
  payloadSchema: ObjectSchema;
}

export interface ManifestEvents {
  publishes: ManifestEvent[];
  /** References to other domains' events, as <domain>.<EventName>; resolved by the lint. */
  consumes: string[];
}

/** Authorization of an action: exactly one of the two forms. */
export type ActionAuth = { public: true } | { requires: string[] };

export interface ManifestAction {
  /** camelCase, unique in the domain. */
  name: string;
  description: string;
  /** Declared short types, as written in the manifest. */
  input: Record<string, string>;
  output: Record<string, string>;
  auth: ActionAuth;
  /** Default false. */
  idempotent: boolean;
  sensitive?: { quorum: boolean; description: string };
  approval?: {
    required: boolean;
    approver?: { role: string; scope?: string };
    onApprove?: { emit: string };
    onReject?: { emit: string };
  };
  /** `input` compiled to JSON Schema draft-07 (closed object). */
  inputSchema: ObjectSchema;
  /** `output` compiled to JSON Schema draft-07 (closed object). */
  outputSchema: ObjectSchema;
}

/** A parsed and validated `tecton.yaml`. */
export interface TectonManifest {
  manifestVersion: SupportedManifestVersion;
  /** Domain name in kebab-case; also used for routes, events and service URLs. */
  domain: string;
  /** Semantic version of the domain contract. */
  version: string;
  description: string;
  /** Domains this one calls synchronously. Defaults to an empty list. */
  dependencies: string[];
  /** Typed actions. Defaults to an empty list. */
  actions: ManifestAction[];
  /** Published and consumed events. Defaults to empty lists. */
  events: ManifestEvents;
  /** Present only for domains that are classes in the Directory tree. */
  objectClass?: ManifestObjectClass;
  /** True when the domain declares an objectClass. */
  participatesInDirectory: boolean;
}

/**
 * Stable error codes. Part of the public contract (PRD §8): later stories add codes,
 * none is ever renamed.
 */
export type ManifestErrorCode =
  | 'yaml-syntax'
  | 'invalid-root'
  | 'required'
  | 'invalid-type'
  | 'invalid-format'
  | 'unsupported-manifest-version'
  | 'unknown-key'
  | 'duplicate-item'
  | 'unknown-type'
  | 'invalid-auth'
  | 'mutually-exclusive'
  | 'duplicate-name'
  | 'unknown-event'
  | 'invalid-attribute'
  | 'invalid-default';

export interface ManifestError {
  /** Dotted path to the offending field, e.g. `domain` or `dependencies[2]`; empty for whole-file errors. */
  path: string;
  code: ManifestErrorCode;
  /** Short, actionable English message. */
  message: string;
  /** 1-based line in the source, when known. */
  line?: number;
  /** 1-based column in the source, when known. */
  column?: number;
}

export type ParseResult = { ok: true; manifest: TectonManifest } | { ok: false; errors: ManifestError[] };

export interface ParseOptions {
  /** Used only to label errors; the parser never reads files. */
  fileName?: string;
}
