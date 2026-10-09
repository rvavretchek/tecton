// Public API of @tecton/manifest: parse and validate tecton.yaml, and its JSON Schema.
export { cloudEventType } from './events.js';
export { compileAttributes, TECTON_UNIQUE_KEYWORD } from './object-class.js';
export { parseManifest } from './parse.js';
export {
  compileFields,
  parseFieldType,
  PRIMITIVE_TYPES,
  type CompileFieldsResult,
  type FieldError,
  type FieldSchema,
  type FieldTypeResult,
  type ObjectSchema,
  type PrimitiveType,
} from './field-types.js';
export {
  ACTION_NAME_PATTERN,
  CONSUMED_EVENT_PATTERN,
  DOMAIN_NAME_MAX_LENGTH,
  DOMAIN_NAME_PATTERN,
  EVENT_NAME_PATTERN,
  PERMISSION_PATTERN,
  SEMVER_PATTERN,
  SUPPORTED_MANIFEST_VERSIONS,
  manifestJsonSchema,
  type SupportedManifestVersion,
} from './schema.js';
export type {
  ActionAuth,
  AttributeSchema,
  AttributesSchema,
  ManifestObjectClass,
  ObjectClassAttribute,
  ManifestAction,
  ManifestError,
  ManifestEvent,
  ManifestEvents,
  ManifestErrorCode,
  ParseOptions,
  ParseResult,
  TectonManifest,
} from './types.js';
