import { formatPath, type TranslatedError } from './errors.js';
import { parseFieldType, PRIMITIVE_TYPES, type FieldSchema } from './field-types.js';
import type { AttributeSchema, AttributesSchema, ManifestObjectClass, ObjectClassAttribute } from './types.js';

/**
 * JSON Schema extension marking an attribute unique across objects of a class. The Directory
 * enforces it (AD-2). A strict Ajv must register it before compiling an attributes schema:
 * `ajv.addKeyword(TECTON_UNIQUE_KEYWORD)`.
 */
export const TECTON_UNIQUE_KEYWORD = 'x-tecton-unique' as const;

/**
 * Classes the framework provides without a manifest. `Root` is the top of the Directory tree:
 * it has no parent, so it cannot satisfy the `allowedParents` rule of a declared objectClass.
 */
export const BUILTIN_DIRECTORY_CLASSES = ['Root'] as const;

/** Base class of every Directory class (the default of `extends`); cannot be declared either. */
export const BASE_DIRECTORY_CLASS = 'DirectoryObject' as const;

/** Class names a manifest cannot declare. */
const RESERVED_CLASS_NAMES: readonly string[] = [...BUILTIN_DIRECTORY_CLASSES, BASE_DIRECTORY_CLASS];

const ATTRIBUTE_TYPES = [...PRIMITIVE_TYPES, 'enum'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

/** A real calendar date: 2026-02-30 matches the pattern but not the calendar. */
function isCalendarDate(text: string): boolean {
  const date = new Date(`${text.slice(0, 10)}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text.slice(0, 10);
}

/**
 * Whether a declared `default` fits its field schema, formats included. Checked by hand rather
 * than with Ajv: compiling one schema per attribute would grow Ajv's cache for the life of the
 * process, and YAML numbers like .inf/.nan must be rejected (JSON cannot carry them).
 */
function defaultFits(field: FieldSchema, value: unknown): boolean {
  if ('enum' in field) return typeof value === 'string' && field.enum.includes(value);
  switch (field.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      if (typeof value !== 'string') return false;
      if (!('format' in field)) return true;
      if (field.format === 'uuid') return UUID.test(value);
      if (field.format === 'date') return DATE.test(value) && isCalendarDate(value);
      return DATE_TIME.test(value) && isCalendarDate(value) && !Number.isNaN(Date.parse(value));
  }
}

type RawObject = Record<string, unknown>;

function isObject(value: unknown): value is RawObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Field schema of one attribute, or undefined when its type is unknown or incomplete. */
function attributeFieldSchema(attribute: RawObject): FieldSchema | undefined {
  const type = attribute['type'];
  if (type === 'enum') {
    const values = attribute['values'];
    return Array.isArray(values) && values.length > 0 ? { type: 'string', enum: values as string[] } : undefined;
  }
  if (typeof type !== 'string' || !(PRIMITIVE_TYPES as readonly string[]).includes(type)) return undefined;
  const parsed = parseFieldType(type);
  return parsed.ok ? parsed.schema : undefined;
}

/** Compiles `objectClass.attributes` into a closed JSON Schema draft-07 object. */
export function compileAttributes(attributes: readonly ObjectClassAttribute[]): AttributesSchema {
  const properties: Record<string, AttributeSchema> = {};
  const required: string[] = [];
  for (const attribute of attributes) {
    const field = attributeFieldSchema(attribute as unknown as RawObject);
    if (!field) throw new Error(`compileAttributes called with an invalid attribute "${attribute.name}"`);
    const schema: AttributeSchema = { ...field };
    if ('default' in attribute) schema.default = attribute.default;
    if (attribute.readOnly) schema.readOnly = true;
    if (attribute.unique) schema[TECTON_UNIQUE_KEYWORD] = true;
    properties[attribute.name] = schema;
    if (attribute.required) required.push(attribute.name);
  }
  const result: AttributesSchema = { type: 'object', properties, additionalProperties: false };
  if (required.length > 0) result.required = required;
  return result;
}

/** Rules beyond JSON Schema for objectClass attributes. Defensive, like the other checks. */
export function checkObjectClass(objectClass: unknown): TranslatedError[] {
  if (!isObject(objectClass)) return [];
  const errors: TranslatedError[] = [];
  if (typeof objectClass['name'] === 'string' && RESERVED_CLASS_NAMES.includes(objectClass['name'])) {
    const segments = ['objectClass', 'name'];
    errors.push({
      error: {
        path: 'objectClass.name',
        code: 'reserved-name',
        message: `objectClass.name ${JSON.stringify(objectClass['name'])} is a built-in Directory class and cannot be declared`,
      },
      locate: { segments },
    });
  }
  if (!Array.isArray(objectClass['attributes'])) return errors;
  const firstIndexByName = new Map<string, number>();
  const add = (segments: Array<string | number>, code: TranslatedError['error']['code'], message: string) =>
    errors.push({ error: { path: formatPath(segments), code, message: `${formatPath(segments)} ${message}` }, locate: { segments } });

  objectClass['attributes'].forEach((attribute, index) => {
    if (!isObject(attribute)) return;
    const base = ['objectClass', 'attributes', index];

    if (typeof attribute['name'] === 'string') {
      const first = firstIndexByName.get(attribute['name']);
      if (first === undefined) firstIndexByName.set(attribute['name'], index);
      else add([...base, 'name'], 'duplicate-name', `${JSON.stringify(attribute['name'])} is already used by objectClass.attributes[${first}]`);
    }

    const type = attribute['type'];
    if (typeof type !== 'string') return;
    if (!(ATTRIBUTE_TYPES as readonly string[]).includes(type)) {
      add([...base, 'type'], 'unknown-type', `has unknown type ${JSON.stringify(type)}; valid types: ${ATTRIBUTE_TYPES.join(', ')} (enum needs values)`);
      return;
    }
    if (type === 'enum' && !('values' in attribute)) add([...base, 'values'], 'required', 'is required when type is enum');
    if (type !== 'enum' && 'values' in attribute) add([...base, 'values'], 'invalid-attribute', 'is only allowed with type: enum');

    const field = attributeFieldSchema(attribute);
    if (field && 'default' in attribute && !defaultFits(field, attribute['default'])) {
      const expected = 'enum' in field ? `one of ${field.enum.map((value) => JSON.stringify(value)).join(', ')}` : `a valid ${type}`;
      add([...base, 'default'], 'invalid-default', `must be ${expected}; got ${JSON.stringify(attribute['default'])}`);
    }
  });

  return errors;
}

/** Builds the typed objectClass (with defaults) of a manifest already known to be valid. */
export function buildObjectClass(objectClass: unknown): ManifestObjectClass | undefined {
  if (!isObject(objectClass)) return undefined;
  // `required` defaults to false, as documented in the schema.
  const attributes = ((objectClass['attributes'] as ObjectClassAttribute[] | undefined) ?? []).map((attribute) => ({
    ...attribute,
    required: attribute.required === true,
  }));
  const containment = objectClass['containment'] as { allowedParents: string[]; allowedChildren?: string[] };
  const acl = objectClass['acl'] as { inheritable?: boolean } | undefined;
  return {
    name: objectClass['name'] as string,
    extends: (objectClass['extends'] as string | undefined) ?? BASE_DIRECTORY_CLASS,
    attributes,
    containment: { allowedParents: containment.allowedParents, allowedChildren: containment.allowedChildren ?? [] },
    acl: { inheritable: acl?.inheritable ?? true },
    attributesSchema: compileAttributes(attributes),
  };
}
