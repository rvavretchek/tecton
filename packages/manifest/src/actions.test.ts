import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';
import { parseManifest } from './parse.js';
import type { ManifestError, ParseResult } from './types.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const HEADER = `manifestVersion: "0.1"
domain: tenant
version: 1.0.0
description: "Tenants."
`;

/** Builds a manifest whose `actions` list is the given YAML block (already indented by 2). */
function manifestWithActions(actionsYaml: string): string {
  return `${HEADER}actions:\n${actionsYaml}`;
}

const CREATE_TENANT = `  - name: createTenant
    description: "Creates a tenant."
    input: { displayName: string, slug: string, nickname: string? }
    output: { id: uuid }
    auth: { requires: [tenant:create] }
`;

function errorsOf(result: ParseResult): ManifestError[] {
  if (result.ok) throw new Error('expected errors, got a valid manifest');
  return result.errors;
}

/** Replaces one line of the CREATE_TENANT action. */
function createTenantWith(key: string, line: string | null): string {
  const lines = CREATE_TENANT.split('\n').filter((current) => !current.startsWith(`    ${key}:`));
  if (line !== null) lines.splice(lines.length - 1, 0, `    ${line}`);
  return manifestWithActions(lines.join('\n'));
}

describe('actions — valid action (AC 1, AC 9)', () => {
  it('Given a complete action, When validated, Then it passes with compiled input/output schemas and idempotent=false', () => {
    const result = parseManifest(manifestWithActions(CREATE_TENANT));

    expect(result.ok).toBe(true);
    const [action] = result.ok ? result.manifest.actions : [];
    expect(action).toMatchObject({
      name: 'createTenant',
      description: 'Creates a tenant.',
      auth: { requires: ['tenant:create'] },
      idempotent: false,
      inputSchema: {
        type: 'object',
        properties: { displayName: { type: 'string' }, slug: { type: 'string' }, nickname: { type: 'string' } },
        required: ['displayName', 'slug'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
        additionalProperties: false,
      },
    });
  });

  it('Given idempotent: true, When parsed, Then it is kept', () => {
    const result = parseManifest(createTenantWith('idempotent', 'idempotent: true'));

    expect(result.ok && result.manifest.actions[0]?.idempotent).toBe(true);
  });

  it('Given no actions key, When parsed, Then actions defaults to an empty list', () => {
    const result = parseManifest(HEADER);

    expect(result.ok && result.manifest.actions).toEqual([]);
  });

  it('Given empty input and output, When validated, Then they compile to empty closed objects', () => {
    const result = parseManifest(createTenantWith('input', 'input: {}').replace('    output: { id: uuid }\n', '    output: {}\n'));

    expect(result.ok && result.manifest.actions[0]?.inputSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
  });

  it('Given enum in block style without quotes and in flow style with quotes, When parsed, Then both work', () => {
    const block = createTenantWith('input', 'input:\n      format: enum[csv, json]');
    const flow = createTenantWith('input', 'input: { format: "enum[csv,json]" }');

    for (const source of [block, flow]) {
      const result = parseManifest(source);
      expect(result.ok && result.manifest.actions[0]?.inputSchema.properties).toEqual({
        format: { type: 'string', enum: ['csv', 'json'] },
      });
    }
  });

  it('produces compiled schemas that are valid draft-07', () => {
    const result = parseManifest(manifestWithActions(CREATE_TENANT));
    const ajv = new Ajv({ strict: true });

    expect(result.ok && ajv.validateSchema(result.manifest.actions[0]!.inputSchema)).toBe(true);
  });

  it.each(['tenant-domain-manifest-v0.yaml', 'leave-domain-manifest-v0.yaml'])(
    'Given the reference example %s, When parsed, Then its actions are valid',
    (file) => {
      const result = parseManifest(readFileSync(join(repoRoot, 'docs', 'examples', file), 'utf8'));

      expect(result.ok).toBe(true);
    },
  );

  it('compiles the Tenant example createTenant input', () => {
    const source = readFileSync(join(repoRoot, 'docs', 'examples', 'tenant-domain-manifest-v0.yaml'), 'utf8');
    const result = parseManifest(source);
    const createTenant = result.ok ? result.manifest.actions.find((action) => action.name === 'createTenant') : undefined;

    expect(createTenant?.inputSchema.required).toEqual(['displayName', 'slug']);
  });
});

describe('actions — types (AC 2)', () => {
  it('Given an unknown type, When validated, Then it fails naming the type and the valid types', () => {
    const errors = errorsOf(parseManifest(createTenantWith('input', 'input: { slug: strng }')));

    expect(errors).toEqual([
      expect.objectContaining({
        path: 'actions[0].input.slug',
        code: 'unknown-type',
        line: expect.any(Number),
      }),
    ]);
    expect(errors[0]?.message).toContain('"strng"');
    expect(errors[0]?.message).toContain('valid types: string, number, integer, boolean, uuid, date, datetime, enum[a,b]');
  });

  it('Given a field name that is not camelCase, When validated, Then it fails at that field', () => {
    const errors = errorsOf(parseManifest(createTenantWith('input', 'input: { display_name: string }')));

    expect(errors).toEqual([expect.objectContaining({ path: 'actions[0].input.display_name', code: 'invalid-format' })]);
  });
});

describe('actions — auth (AC 3, 4, 5, 6)', () => {
  it('Given no auth block, When validated, Then it fails', () => {
    const errors = errorsOf(parseManifest(createTenantWith('auth', null)));

    expect(errors).toEqual([expect.objectContaining({ path: 'actions[0].auth', code: 'required' })]);
  });

  it('Given auth.public: true without requires, When validated, Then it passes', () => {
    const result = parseManifest(createTenantWith('auth', 'auth: { public: true }'));

    expect(result.ok && result.manifest.actions[0]?.auth).toEqual({ public: true });
  });

  it.each([
    ['public and requires together', 'auth: { public: true, requires: [tenant:create] }', 'cannot be public and require permissions'],
    ['public and an empty requires list', 'auth: { public: true, requires: [] }', 'cannot be public and require permissions'],
    ['an empty requires list', 'auth: { requires: [] }', 'must declare either'],
    ['an empty auth block', 'auth: {}', 'must declare either'],
    ['public: false without requires', 'auth: { public: false }', 'must declare either'],
  ])('Given %s, When validated, Then it fails with invalid-auth', (_label, line, message) => {
    const errors = errorsOf(parseManifest(createTenantWith('auth', line)));

    expect(errors).toEqual([expect.objectContaining({ path: 'actions[0].auth', code: 'invalid-auth' })]);
    expect(errors[0]?.message).toContain(message);
  });

  it.each(['tenant', 'Tenant:Create', 'tenant:', ':create', 'tenant create'])(
    'Given permission "%s", When validated, Then it fails with the expected form',
    (permission) => {
      const errors = errorsOf(parseManifest(createTenantWith('auth', `auth: { requires: ["${permission}"] }`)));

      expect(errors).toEqual([expect.objectContaining({ path: 'actions[0].auth.requires[0]', code: 'invalid-format' })]);
      expect(errors[0]?.message).toContain('<resource>:<action>');
    },
  );

  it.each(['tenant:create', 'auth:service:register', 'call:billing', 'directory:acl:manage'])(
    'Given permission "%s", When validated, Then it passes',
    (permission) => {
      expect(parseManifest(createTenantWith('auth', `auth: { requires: ["${permission}"] }`)).ok).toBe(true);
    },
  );
});

describe('actions — sensitive and approval (AC 7, AC 8)', () => {
  it('Given sensitive without description, When validated, Then it fails', () => {
    const errors = errorsOf(parseManifest(createTenantWith('sensitive', 'sensitive: { quorum: true }')));

    expect(errors).toEqual([
      expect.objectContaining({
        path: 'actions[0].sensitive.description',
        code: 'required',
        message: 'actions[0].sensitive.description is required: explain why this action is sensitive',
      }),
    ]);
  });

  it('Given sensitive.quorum and approval together, When validated, Then it fails as mutually exclusive', () => {
    const source = createTenantWith(
      'sensitive',
      'sensitive: { quorum: true, description: "Bulk export." }\n    approval: { required: true }',
    );
    const errors = errorsOf(parseManifest(source));

    expect(errors).toEqual([
      expect.objectContaining({
        path: 'actions[0]',
        code: 'mutually-exclusive',
        message: 'actions[0] cannot use sensitive.quorum and approval together; choose one approval primitive',
      }),
    ]);
  });

  it('Given sensitive with quorum false plus approval, When validated, Then it passes', () => {
    const source = createTenantWith(
      'sensitive',
      'sensitive: { quorum: false, description: "Logged only." }\n    approval: { required: true }',
    );

    expect(parseManifest(source).ok).toBe(true);
  });

  it('Given approval.onApprove.emit not in PascalCase, When validated, Then it fails at the emit path', () => {
    const source = createTenantWith('approval', 'approval: { required: true, onApprove: { emit: leaveApproved } }');
    const errors = errorsOf(parseManifest(source));

    expect(errors).toEqual([expect.objectContaining({ path: 'actions[0].approval.onApprove.emit', code: 'invalid-format' })]);
  });
});

describe('actions — names and unknown keys', () => {
  it.each(['CreateTenant', 'create_tenant', 'create-tenant'])('Given name "%s", When validated, Then it fails', (name) => {
    const errors = errorsOf(parseManifest(manifestWithActions(CREATE_TENANT.replace('name: createTenant', `name: ${name}`))));

    expect(errors).toEqual([expect.objectContaining({ path: 'actions[0].name', code: 'invalid-format' })]);
  });

  it('Given two actions with the same name, When validated, Then the second one is reported', () => {
    const errors = errorsOf(parseManifest(manifestWithActions(`${CREATE_TENANT}${CREATE_TENANT}`)));

    expect(errors).toEqual([
      expect.objectContaining({
        path: 'actions[1].name',
        code: 'duplicate-name',
        message: 'actions[1].name "createTenant" is already used by actions[0]',
      }),
    ]);
  });

  it('Given an unknown key inside an action, When validated, Then it fails without a suggestion', () => {
    const errors = errorsOf(parseManifest(createTenantWith('timeout', 'timeout: 5000')));

    expect(errors).toEqual([
      expect.objectContaining({ path: 'actions[0].timeout', code: 'unknown-key', message: 'unknown key "timeout"' }),
    ]);
  });

  it('Given idempotent with a non-boolean value, When validated, Then it fails with invalid-type', () => {
    const errors = errorsOf(parseManifest(createTenantWith('idempotent', 'idempotent: "yes"')));

    expect(errors).toEqual([expect.objectContaining({ path: 'actions[0].idempotent', code: 'invalid-type' })]);
  });

  it('Given problems in several actions, When validated, Then all come back at once, by line', () => {
    const first = CREATE_TENANT.replace('auth: { requires: [tenant:create] }', 'auth: {}');
    const second = CREATE_TENANT.replace('createTenant', 'renameTenant').replace('slug: string,', 'slug: strng,');
    const errors = errorsOf(parseManifest(manifestWithActions(`${first}${second}`)));

    expect(errors.map((error) => [error.path, error.code])).toEqual([
      ['actions[0].auth', 'invalid-auth'],
      ['actions[1].input.slug', 'unknown-type'],
    ]);
  });
});
