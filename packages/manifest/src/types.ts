import type { SupportedManifestVersion } from './schema.js';

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
  /** Reserved; validated from Story 1.3 on. */
  actions?: unknown;
  /** Reserved; validated from Story 1.4 on. */
  events?: unknown;
  /** Reserved; validated from Story 1.5 on. */
  objectClass?: unknown;
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
  | 'duplicate-item';

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
