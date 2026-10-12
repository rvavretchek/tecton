import { parseManifest, type TectonManifest } from '@tecton/manifest';
import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './openapi.js';

function manifestOf(source: string): TectonManifest {
  const result = parseManifest(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.manifest;
}

const source = (input: string) => `manifestVersion: "0.1"
domain: tenant
version: 1.2.0
description: "Tenants."
actions:
  - name: createTenant
    description: "Creates a tenant."
    input: ${input}
    output: { id: uuid }
    auth: { requires: [tenant:create] }
  - name: archiveTenant
    description: "Archives a tenant."
    input: { id: uuid }
    output: {}
    auth: { public: true }
`;

type Doc = Record<string, any>;

describe('buildOpenApiDocument (AC 4)', () => {
  it('lists every action with description, operationId and input/output schemas', async () => {
    const doc = (await buildOpenApiDocument(manifestOf(source('{ displayName: string, slug: string }')))) as Doc;

    expect(doc['openapi']).toMatch(/^3\.1\./);
    expect(doc['info']).toEqual({ title: 'tenant', version: '1.2.0', description: 'Tenants.' });
    expect(Object.keys(doc['paths'])).toEqual(['/tenant/create-tenant', '/tenant/archive-tenant']);

    const create = doc['paths']['/tenant/create-tenant']['post'];
    expect(create).toMatchObject({ operationId: 'createTenant', description: 'Creates a tenant.', tags: ['tenant'] });
    expect(create['requestBody']['content']['application/json']['schema']).toMatchObject({
      type: 'object',
      properties: { displayName: { type: 'string' }, slug: { type: 'string' } },
      required: ['displayName', 'slug'],
    });
    expect(create['responses']['200']['content']['application/json']['schema']).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
    });
  });
});

describe('buildOpenApiDocument regenerated after a manifest change (AC 5)', () => {
  it('reflects a new input field without manual edits', async () => {
    const before = (await buildOpenApiDocument(manifestOf(source('{ displayName: string }')))) as Doc;
    const after = (await buildOpenApiDocument(manifestOf(source('{ displayName: string, region: string? }')))) as Doc;
    const schemaOf = (doc: Doc) => doc['paths']['/tenant/create-tenant']['post']['requestBody']['content']['application/json']['schema'];

    expect(schemaOf(before)['properties']).not.toHaveProperty('region');
    expect(schemaOf(after)['properties']).toHaveProperty('region', { type: 'string' });
  });
});
