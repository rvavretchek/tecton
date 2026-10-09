import { Ajv } from 'ajv';
import { formatPath, type TranslatedError } from './errors.js';
import { parseFieldType, PRIMITIVE_TYPES, type FieldSchema } from './field-types.js';
import type { AttributeSchema, AttributesSchema, ManifestObjectClass, ObjectClassAttribute } from './types.js';

/**
 * JSON Schema extension marking an attribute unique across objects of a class. The Directory
 * enforces it (AD-2). A strict Ajv must register it before compiling an attributes schema:
 * `ajv.addKeyword(TECTON_UNIQUE_KEYWORD)`.
 */
export const TECTON_UNIQUE_KEYWORD = 'x-tecton-unique' as const;

const ATTRIBUTE_TYPES = [...PRIMITIVE_TYPES, 'enum'] as const;

// Only used to check that a declared `default` matches its type; formats are not enforced here.
const defaultChecker = new Ajv({ validateFormats: false, strict: false });

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
  if (!isObject(objectClass) || !Array.isArray(objectClass['attributes'])) return [];
  const errors: TranslatedError[] = [];
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
    if (field && 'default' in attribute && !defaultChecker.validate(field, attribute['default'])) {
      const expected = 'enum' in field ? `one of ${field.enum.map((value) => JSON.stringify(value)).join(', ')}` : `a ${type}`;
      add([...base, 'default'], 'invalid-default', `must be ${expected}; got ${JSON.stringify(attribute['default'])}`);
    }
  });

  return errors;
}

/** Builds the typed objectClass (with defaults) of a manifest already known to be valid. */
export function buildObjectClass(objectClass: unknown): ManifestObjectClass | undefined {
  if (!isObject(objectClass)) return undefined;
  const attributes = (objectClass['attributes'] as ObjectClassAttribute[] | undefined) ?? [];
  const containment = objectClass['containment'] as { allowedParents: string[]; allowedChildren?: string[] };
  const acl = objectClass['acl'] as { inheritable?: boolean } | undefined;
  return {
    name: objectClass['name'] as string,
    extends: (objectClass['extends'] as string | undefined) ?? 'DirectoryObject',
    attributes,
    containment: { allowedParents: containment.allowedParents, allowedChildren: containment.allowedChildren ?? [] },
    acl: { inheritable: acl?.inheritable ?? true },
    attributesSchema: compileAttributes(attributes),
  };
}
