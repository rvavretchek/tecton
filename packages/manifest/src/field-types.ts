// Short type system used by action input/output (and, from Story 1.4, event schemas).
// Each field is `name: type`, where type is a primitive or `enum[a,b]`, optionally
// suffixed with `?` for an optional field. Fields are required unless marked optional,
// which is what makes additive contract evolution possible (FR-29).

export { FIELD_NAME_PATTERN } from './schema.js';

export const PRIMITIVE_TYPES = ['string', 'number', 'integer', 'boolean', 'uuid', 'date', 'datetime'] as const;
export type PrimitiveType = (typeof PRIMITIVE_TYPES)[number];

export const VALID_TYPES_HINT = `${PRIMITIVE_TYPES.join(', ')}, enum[a,b] (append "?" for optional)`;

export type FieldSchema =
  | { type: 'string' | 'number' | 'integer' | 'boolean' }
  | { type: 'string'; format: 'uuid' | 'date' | 'date-time' }
  | { type: 'string'; enum: string[] };

export interface ObjectSchema {
  type: 'object';
  properties: Record<string, FieldSchema>;
  required?: string[];
  additionalProperties: false;
}

export type FieldTypeResult = { ok: true; optional: boolean; schema: FieldSchema } | { ok: false; reason: string };

const PRIMITIVE_SCHEMAS: Record<PrimitiveType, FieldSchema> = {
  string: { type: 'string' },
  number: { type: 'number' },
  integer: { type: 'integer' },
  boolean: { type: 'boolean' },
  uuid: { type: 'string', format: 'uuid' },
  date: { type: 'string', format: 'date' },
  // ISO 8601 date-time; the framework always emits UTC (Consistency Conventions).
  datetime: { type: 'string', format: 'date-time' },
};

const ENUM_VALUE = /^[a-zA-Z0-9_-]+$/;

function parseEnum(body: string): FieldTypeResult {
  const values = body.split(',').map((value) => value.trim());
  if (values.length === 1 && values[0] === '') return { ok: false, reason: 'enum needs at least one value, e.g. enum[a,b]' };
  const seen = new Set<string>();
  for (const value of values) {
    if (!ENUM_VALUE.test(value)) return { ok: false, reason: `enum has an invalid value ${JSON.stringify(value)} (letters, digits, "-" and "_" only)` };
    if (seen.has(value)) return { ok: false, reason: `enum has a repeated value ${JSON.stringify(value)}` };
    seen.add(value);
  }
  return { ok: true, optional: false, schema: { type: 'string', enum: values } };
}

export function parseFieldType(text: string): FieldTypeResult {
  const optional = text.endsWith('?');
  const base = optional ? text.slice(0, -1) : text;
  const unknown: FieldTypeResult = { ok: false, reason: `unknown type ${JSON.stringify(text)}; valid types: ${VALID_TYPES_HINT}` };

  if ((PRIMITIVE_TYPES as readonly string[]).includes(base)) {
    return { ok: true, optional, schema: { ...PRIMITIVE_SCHEMAS[base as PrimitiveType] } };
  }
  const enumMatch = /^enum\[(.*)\]$/.exec(base);
  if (enumMatch) {
    const parsed = parseEnum(enumMatch[1] ?? '');
    return parsed.ok ? { ...parsed, optional } : parsed;
  }
  return unknown;
}

export interface FieldError {
  field: string;
  reason: string;
}

export type CompileFieldsResult = { ok: true; schema: ObjectSchema } | { ok: false; errors: FieldError[] };

/** Compiles a `{ field: type }` map into a closed JSON Schema draft-07 object. */
export function compileFields(fields: Record<string, string>): CompileFieldsResult {
  const properties: Record<string, FieldSchema> = {};
  const required: string[] = [];
  const errors: FieldError[] = [];

  for (const [field, text] of Object.entries(fields)) {
    const parsed = parseFieldType(text);
    if (!parsed.ok) {
      errors.push({ field, reason: parsed.reason });
      continue;
    }
    properties[field] = parsed.schema;
    if (!parsed.optional) required.push(field);
  }

  if (errors.length > 0) return { ok: false, errors };
  const schema: ObjectSchema = { type: 'object', properties, additionalProperties: false };
  if (required.length > 0) schema.required = required;
  return { ok: true, schema };
}
