import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { buildAsyncApiDocument } from './asyncapi.js';
import { parseManifest } from './parse.js';
import { manifestJsonSchema } from './schema.js';
import type { ManifestError, ParseResult, TectonManifest } from './types.js';

// Regression tests for the Epic 1 code review (2026-10-13), one block per finding.

const HEADER = `manifestVersion: "0.1"
domain: tenant
version: 1.0.0
description: "Tenants."
`;

function errorsOf(result: ParseResult): ManifestError[] {
  if (result.ok) throw new Error(`expected errors, got a valid manifest: ${JSON.stringify(result.manifest)}`);
  return result.errors;
}

function manifestOf(source: string): TectonManifest {
  const result = parseManifest(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.manifest;
}

const action = (name: string, auth = 'auth: { public: true }') =>
  `  - name: ${name}\n    description: "Does ${name}."\n    input: {}\n    output: {}\n    ${auth}\n`;
const withActions = (...actions: string[]) => `${HEADER}actions:\n${actions.join('')}`;
const withAttribute = (attribute: string) =>
  `${HEADER}objectClass:\n  name: Tenant\n  attributes:\n    - ${attribute}\n  containment: { allowedParents: [Root] }\n`;

describe('YAML aliases (P5)', () => {
  it('Given nested aliases that would explode, When parsed, Then it returns yaml-syntax instead of throwing', () => {
    const letters = 'abcdefgh';
    const lines = ['a: &a [x, x, x, x, x, x, x, x, x, x]'];
    for (let i = 1; i < letters.length; i += 1) {
      lines.push(`${letters[i]}: &${letters[i]} [${Array(10).fill(`*${letters[i - 1]}`).join(', ')}]`);
    }

    let result: ParseResult | undefined;
    expect(() => {
      result = parseManifest(`${HEADER}${lines.join('\n')}\n`);
    }).not.toThrow();
    expect(result && errorsOf(result)).toMatchObject([{ code: 'yaml-syntax', path: '' }]);
  });
});

describe('error messages (P14, P23)', () => {
  it('Given a domain both too long and malformed, When parsed, Then it is reported once', () => {
    const errors = errorsOf(parseManifest(HEADER.replace('domain: tenant', `domain: ${'Bad_'.repeat(20)}`)));

    expect(errors.filter((error) => error.path === 'domain')).toHaveLength(1);
  });

  it('Given requires that is not a list, When parsed, Then only the type error is reported', () => {
    const errors = errorsOf(parseManifest(withActions(action('createTenant', 'auth: { requires: tenant:create }'))));

    expect(errors).toEqual([expect.objectContaining({ path: 'actions[0].auth.requires', code: 'invalid-type' })]);
  });

  it('Given a field of the wrong type, When parsed, Then the message uses the right article', () => {
    const errors = errorsOf(parseManifest(`${HEADER}events: [oops]\n`));

    expect(errors).toContainEqual(expect.objectContaining({ path: 'events', message: 'events must be an object' }));
  });
});

describe('name collisions (P4a, P4b)', () => {
  it('Given two actions mapping to the same route, When parsed, Then the second is a duplicate naming the route', () => {
    const errors = errorsOf(parseManifest(withActions(action('exportCsv'), action('exportCSV'))));

    expect(errors).toEqual([
      expect.objectContaining({ path: 'actions[1].name', code: 'duplicate-name', message: expect.stringContaining('"export-csv"') }),
    ]);
  });

  it('Given two events with the same CloudEvents type, When parsed, Then the second is a duplicate', () => {
    const errors = errorsOf(
      parseManifest(`${HEADER}events:\n  publishes:\n    - { name: ExportCSVReady, schema: {} }\n    - { name: ExportCsvReady, schema: {} }\n`),
    );

    expect(errors).toEqual([
      expect.objectContaining({ path: 'events.publishes[1].name', code: 'duplicate-name', message: expect.stringContaining('CloudEvents type') }),
    ]);
  });
});

describe('auth normalization (P24a)', () => {
  it('Given public: false with requires, When parsed, Then auth has only the requires form', () => {
    const result = parseManifest(withActions(action('createTenant', 'auth: { public: false, requires: [tenant:create] }')));

    expect(result.ok && result.manifest.actions[0]?.auth).toEqual({ requires: ['tenant:create'] });
  });
});

describe('objectClass attributes (P9, P17, P18, P20, P24b)', () => {
  it.each([
    ['a malformed uuid', '{ name: ownerId, type: uuid, default: not-a-uuid }'],
    ['an impossible date', '{ name: since, type: date, default: "2026-02-30" }'],
    ['a malformed datetime', '{ name: at, type: datetime, default: "yesterday" }'],
    ['an infinite number', '{ name: limit, type: number, default: .inf }'],
    ['NaN', '{ name: limit, type: number, default: .nan }'],
  ])('Given a default with %s, When parsed, Then it is invalid-default', (_label, attribute) => {
    expect(errorsOf(parseManifest(withAttribute(attribute)))).toEqual([expect.objectContaining({ code: 'invalid-default' })]);
  });

  it('Given valid formatted defaults, When parsed, Then they are accepted', () => {
    for (const attribute of [
      '{ name: at, type: datetime, default: "2026-10-15T12:00:00Z" }',
      '{ name: since, type: date, default: "2024-02-29" }',
      '{ name: ownerId, type: uuid, default: 0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f }',
    ]) {
      expect(parseManifest(withAttribute(attribute)).ok, attribute).toBe(true);
    }
  });

  it('Given enum values that are empty or have spaces, When parsed, Then each bad value is reported', () => {
    const errors = errorsOf(parseManifest(withAttribute('{ name: status, type: enum, values: ["", "two words"] }')));

    expect(errors.map((error) => error.path)).toEqual(['objectClass.attributes[0].values[0]', 'objectClass.attributes[0].values[1]']);
  });

  it('Given DirectoryObject as the class name, When parsed, Then it is reserved', () => {
    const errors = errorsOf(parseManifest(`${HEADER}objectClass:\n  name: DirectoryObject\n  containment: { allowedParents: [Root] }\n`));

    expect(errors).toEqual([expect.objectContaining({ path: 'objectClass.name', code: 'reserved-name' })]);
  });

  it('Given an attribute without required, When parsed, Then required defaults to false', () => {
    const result = parseManifest(withAttribute('{ name: nickname, type: string }'));

    expect(result.ok && result.manifest.objectClass?.attributes[0]?.required).toBe(false);
  });

  it('Given many manifests with defaults, When parsed, Then each parse gives the same answer (no shared validator state)', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(parseManifest(withAttribute(`{ name: limit${i}, type: integer, default: ${i} }`)).ok).toBe(true);
    }
  });
});

describe('dependencies (P19)', () => {
  it('Given a domain depending on itself, When parsed, Then it fails', () => {
    const errors = errorsOf(parseManifest(`${HEADER}dependencies: [tenant]\n`));

    expect(errors).toEqual([expect.objectContaining({ path: 'dependencies[0]', message: expect.stringContaining('itself') })]);
  });

  it.each(['/srv/billing', 'C:/billing', 'C:\\billing', '\\\\server\\billing'])('Given the absolute path %s, When parsed, Then it fails', (path) => {
    const errors = errorsOf(parseManifest(`${HEADER}dependencies:\n  - { domain: billing, path: ${JSON.stringify(path)} }\n`));

    expect(errors).toEqual([expect.objectContaining({ path: 'dependencies[0].path', code: 'invalid-format' })]);
  });
});

describe('exported JSON Schema field types (P12)', () => {
  const validate = new Ajv({ strict: true, allErrors: true }).compile(manifestJsonSchema);
  const manifestWith = (type: string) => ({
    manifestVersion: '0.1',
    domain: 'tenant',
    version: '1.0.0',
    description: 'Tenants.',
    actions: [{ name: 'createTenant', description: 'Creates.', input: { slug: type }, output: {}, auth: { public: true } }],
  });

  it.each(['string', 'uuid?', 'datetime', 'enum[a,b]', 'enum[ active , archived ]?'])('accepts %s', (type) => {
    expect(validate(manifestWith(type))).toBe(true);
  });

  it.each(['strng', 'String', 'enum[]', 'enum[a b]', 'string??'])('rejects %s', (type) => {
    expect(validate(manifestWith(type))).toBe(false);
  });

  it('Given an unknown type, When parsed, Then the parser still gives its specific unknown-type message', () => {
    const errors = errorsOf(parseManifest(`${HEADER}actions:\n  - name: a\n    description: "A."\n    input: { slug: strng }\n    output: {}\n    auth: { public: true }\n`));

    expect(errors).toEqual([expect.objectContaining({ path: 'actions[0].input.slug', code: 'unknown-type' })]);
  });
});

describe('AsyncAPI receive operations (P11)', () => {
  it('Given consumed events whose domain and name concatenate the same way, When built, Then both operations exist', () => {
    const doc = buildAsyncApiDocument(
      manifestOf(`manifestVersion: "0.1"
domain: payroll
version: 1.0.0
description: "Payroll."
events:
  consumes: [leave-request.Created, leave.RequestCreated]
`),
    ) as Record<string, Record<string, unknown>>;

    expect(Object.keys(doc['operations'] ?? {}).sort()).toEqual(['receive_leave-request_Created', 'receive_leave_RequestCreated']);
  });
});
