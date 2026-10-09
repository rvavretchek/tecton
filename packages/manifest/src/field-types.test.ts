import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { compileFields, parseFieldType, PRIMITIVE_TYPES } from './field-types.js';

describe('parseFieldType (AC 2)', () => {
  it.each([
    ['string', { type: 'string' }],
    ['number', { type: 'number' }],
    ['integer', { type: 'integer' }],
    ['boolean', { type: 'boolean' }],
    ['uuid', { type: 'string', format: 'uuid' }],
    ['date', { type: 'string', format: 'date' }],
    ['datetime', { type: 'string', format: 'date-time' }],
    ['enum[csv,json]', { type: 'string', enum: ['csv', 'json'] }],
    ['enum[ csv , json ]', { type: 'string', enum: ['csv', 'json'] }],
  ])('Given "%s", When compiled, Then it becomes the equivalent JSON Schema', (text, schema) => {
    expect(parseFieldType(text)).toEqual({ ok: true, optional: false, schema });
  });

  it('Given a "?" suffix, When parsed, Then the field is optional', () => {
    expect(parseFieldType('string?')).toEqual({ ok: true, optional: true, schema: { type: 'string' } });
    expect(parseFieldType('enum[a,b]?')).toEqual({ ok: true, optional: true, schema: { type: 'string', enum: ['a', 'b'] } });
  });

  it.each([
    ['strng', /unknown type "strng"/],
    ['String', /unknown type "String"/],
    ['enum[]', /at least one value/],
    ['enum[a,a]', /repeated value "a"/],
    ['enum[a b]', /invalid value "a b"/],
    ['enum[a,b', /unknown type "enum\[a,b"/],
    ['string??', /unknown type "string\?\?"/],
  ])('Given "%s", When parsed, Then it fails with a reason naming the problem', (text, reason) => {
    const result = parseFieldType(text);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(reason);
  });

  it('lists every primitive type', () => {
    expect(PRIMITIVE_TYPES).toEqual(['string', 'number', 'integer', 'boolean', 'uuid', 'date', 'datetime']);
  });
});

describe('compileFields (AC 1)', () => {
  it('Given a field map, When compiled, Then it is a closed object with required non-optional fields', () => {
    const result = compileFields({ displayName: 'string', slug: 'string', nickname: 'string?' });

    expect(result).toEqual({
      ok: true,
      schema: {
        type: 'object',
        properties: { displayName: { type: 'string' }, slug: { type: 'string' }, nickname: { type: 'string' } },
        required: ['displayName', 'slug'],
        additionalProperties: false,
      },
    });
  });

  it('Given an empty field map, When compiled, Then it is an empty closed object without required', () => {
    expect(compileFields({})).toEqual({ ok: true, schema: { type: 'object', properties: {}, additionalProperties: false } });
  });

  it('Given unknown types, When compiled, Then every bad field is reported', () => {
    const result = compileFields({ a: 'strng', b: 'string', c: 'enum[]' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((error) => error.field)).toEqual(['a', 'c']);
  });

  it('produces schemas that are valid JSON Schema draft-07', () => {
    const ajv = new Ajv({ strict: true });
    const result = compileFields({ id: 'uuid', at: 'datetime', day: 'date', kind: 'enum[a,b]?', n: 'integer' });

    expect(result.ok && ajv.validateSchema(result.schema)).toBe(true);
  });
});
