// Public API of @tecton/manifest: parse and validate tecton.yaml, and its JSON Schema.
export { parseManifest } from './parse.js';
export {
  DOMAIN_NAME_MAX_LENGTH,
  DOMAIN_NAME_PATTERN,
  SEMVER_PATTERN,
  SUPPORTED_MANIFEST_VERSIONS,
  manifestJsonSchema,
  type SupportedManifestVersion,
} from './schema.js';
export type { ManifestError, ManifestErrorCode, ParseOptions, ParseResult, TectonManifest } from './types.js';
