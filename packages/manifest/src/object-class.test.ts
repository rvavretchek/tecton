import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { TECTON_UNIQUE_KEYWORD } from './object-class.js';
import { parseManifest } from './parse.js';
import type { ManifestError, ParseResult } from './types.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const HEADER = `manifestVersion: "0.1"
domain: tenant
version: 1.0.0
description: "Tenants."
`;

const TENANT_CLASS = `objectClass:
  name: Tenant
  attributes:
    - { name: displayName, type: string, required: true }
    - { name: slug, type: string, required: true, unique: true }
    - { name: status, type: enum, values: [active, suspended, archived], default: active, readOnly: true }
  containment:
    allowedParents: [Root]
    allowedChildren: [User, Group]
`;

function errorsOf(result: ParseResult): ManifestError[] {
  if (result.ok) throw new Error('expected errors, got a valid manifest');
  return result.errors;
}

const withClass = (objectClassYaml: string) => `${HEADER}${objectClassYaml}`;
const withAttribute = (attribute: string) =>
  withClass(`objectClass:\n  name: Tenant\n  attributes:\n    - ${attribute}\n  containment: { allowedParents: [Root] }\n`);

describe('objectClass optional (AC 1)', () => {
  it('Given no objectClass, When parsed, Then the domain does not participate in the Directory', () => {
    const result = parseManifest(HEADER);

    expect(result.ok && result.manifest.participatesInDirectory).toBe(false);
    expect(result.ok && result.manifest.objectClass).toBeUndefined();
  });

  it('Given an objectClass, When parsed, Then the domain participates in the Directory', () => {
    const result = parseManifest(withClass(TENANT_CLASS));

    expect(result.ok && result.manifest.participatesInDirectory).toBe(true);
  });
});

describe('containment (AC 2, AC 5)', () => {
  it.each([
    ['without containment', 'objectClass:\n  name: Tenant\n', 'objectClass.containment', 'required'],
    ['without allowedParents', 'objectClass:\n  name: Tenant\n  containment: { allowedChildren: [User] }\n', 'objectClass.containment.allowedParents', 'required'],
    ['with an empty allowedParents', 'objectClass:\n  name: Tenant\n  containment: { allowedParents: [] }\n', 'objectClass.containment.allowedParents', 'invalid-format'],
  ])('Given an objectClass %s, When validated, Then it fails', (_label, yaml, path, code) => {
    expect(errorsOf(parseManifest(withClass(yaml)))).toEqual([expect.objectContaining({ path, code })]);
  });

  it.each([
    ['allowedParents: [root]', 'objectClass.containment.allowedParents[0]'],
    ['allowedParents: [Root], allowedChildren: [user-group]', 'objectClass.containment.allowedChildren[0]'],
  ])('Given %s, When validated, Then only the PascalCase syntax is checked and it fails', (containment, path) => {
    const errors = errorsOf(parseManifest(withClass(`objectClass:\n  name: Tenant\n  containment: { ${containment} }\n`)));

    expect(errors).toEqual([expect.objectContaining({ path, code: 'invalid-format' })]);
  });

  it('Given parents and children not declared anywhere, When validated, Then they are accepted (resolution is the lint job)', () => {
    const result = parseManifest(withClass('objectClass:\n  name: Tenant\n  containment: { allowedParents: [Planet], allowedChildren: [Moon] }\n'));

    expect(result.ok && result.manifest.objectClass?.containment).toEqual({ allowedParents: ['Planet'], allowedChildren: ['Moon'] });
  });
});

describe('attributes compiled to JSON Schema (AC 3)', () => {
  it('Given short attributes, When compiled, Then they become draft-07 with x-tecton-unique, readOnly and defaults', () => {
    const result = parseManifest(withClass(TENANT_CLASS));

    expect(result.ok && result.manifest.objectClass?.attributesSchema).toEqual({
      type: 'object',
      properties: {
        displayName: { type: 'string' },
        slug: { type: 'string', 'x-tecton-unique': true },
        status: { type: 'string', enum: ['active', 'suspended', 'archived'], default: 'active', readOnly: true },
      },
      required: ['displayName', 'slug'],
      additionalProperties: false,
    });
  });

  it('produces a schema a strict Ajv accepts once the extension keyword is registered', () => {
    const result = parseManifest(withClass(TENANT_CLASS));
    const ajv = new Ajv({ strict: true });
    ajv.addKeyword(TECTON_UNIQUE_KEYWORD);
    const validate = ajv.compile(result.ok ? result.manifest.objectClass!.attributesSchema : {});

    expect(validate({ displayName: 'Acme', slug: 'acme', status: 'active' })).toBe(true);
    expect(validate({ displayName: 'Acme' })).toBe(false);
  });

  it.each([
    ['uuid', { type: 'string', format: 'uuid' }],
    ['datetime', { type: 'string', format: 'date-time' }],
    ['integer', { type: 'integer' }],
  ])('Given type %s, When compiled, Then it maps like the action short types', (type, schema) => {
    const result = parseManifest(withAttribute(`{ name: value, type: ${type} }`));

    expect(result.ok && result.manifest.objectClass?.attributesSchema.properties['value']).toEqual(schema);
  });

  it.each([
    ['{ name: display_name, type: string }', 'objectClass.attributes[0].name', 'invalid-format'],
    ['{ name: value, type: text }', 'objectClass.attributes[0].type', 'unknown-type'],
    ['{ name: status, type: enum }', 'objectClass.attributes[0].values', 'required'],
    ['{ name: label, type: string, values: [a, b] }', 'objectClass.attributes[0].values', 'invalid-attribute'],
    ['{ name: label, type: string, default: 5 }', 'objectClass.attributes[0].default', 'invalid-default'],
    ['{ name: status, type: enum, values: [a, b], default: c }', 'objectClass.attributes[0].default', 'invalid-default'],
    ['{ name: status, type: enum, values: [a, a] }', 'objectClass.attributes[0].values[1]', 'duplicate-item'],
    ['{ name: label, type: string, hidden: true }', 'objectClass.attributes[0].hidden', 'unknown-key'],
  ])('Given attribute %s, When validated, Then it fails at %s with %s', (attribute, path, code) => {
    expect(errorsOf(parseManifest(withAttribute(attribute)))).toEqual([expect.objectContaining({ path, code })]);
  });

  it('Given a valid boolean default, When validated, Then it passes', () => {
    expect(parseManifest(withAttribute('{ name: active, type: boolean, default: true }')).ok).toBe(true);
  });

  it('Given two attributes with the same name, When validated, Then the second is a duplicate', () => {
    const source = withClass(
      'objectClass:\n  name: Tenant\n  attributes:\n    - { name: slug, type: string }\n    - { name: slug, type: string }\n  containment: { allowedParents: [Root] }\n',
    );

    expect(errorsOf(parseManifest(source))).toEqual([
      expect.objectContaining({ path: 'objectClass.attributes[1].name', code: 'duplicate-name' }),
    ]);
  });
});

describe('defaults (AC 4)', () => {
  it('Given no extends and no acl, When parsed, Then extends is DirectoryObject and acl.inheritable is true', () => {
    const result = parseManifest(withClass('objectClass:\n  name: Group\n  containment: { allowedParents: [Tenant] }\n'));

    expect(result.ok && result.manifest.objectClass).toMatchObject({
      name: 'Group',
      extends: 'DirectoryObject',
      acl: { inheritable: true },
      attributes: [],
      containment: { allowedParents: ['Tenant'], allowedChildren: [] },
    });
  });

  it('Given explicit extends and acl.inheritable false, When parsed, Then they are kept', () => {
    const result = parseManifest(
      withClass('objectClass:\n  name: Group\n  extends: Container\n  acl: { inheritable: false }\n  containment: { allowedParents: [Tenant] }\n'),
    );

    expect(result.ok && result.manifest.objectClass).toMatchObject({ extends: 'Container', acl: { inheritable: false } });
  });

  it('Given an objectClass name not in PascalCase, When validated, Then it fails', () => {
    expect(errorsOf(parseManifest(withClass('objectClass:\n  name: tenant\n  containment: { allowedParents: [Root] }\n')))).toEqual([
      expect.objectContaining({ path: 'objectClass.name', code: 'invalid-format' }),
    ]);
  });
});

describe('reference example (AC 6)', () => {
  it('Given tenant-domain-manifest-v0.yaml, When validated, Then it passes and compiles the Tenant attributes', () => {
    const result = parseManifest(readFileSync(join(repoRoot, 'docs', 'examples', 'tenant-domain-manifest-v0.yaml'), 'utf8'));

    expect(result.ok).toBe(true);
    expect(result.ok && result.manifest.objectClass?.attributesSchema.properties['slug']).toEqual({
      type: 'string',
      'x-tecton-unique': true,
    });
  });
});
