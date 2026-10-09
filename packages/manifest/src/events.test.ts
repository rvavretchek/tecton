import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cloudEventType } from './events.js';
import { parseManifest } from './parse.js';
import type { ManifestError, ParseResult } from './types.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const HEADER = `manifestVersion: "0.1"
domain: tenant
version: 1.0.0
description: "Tenants."
`;

function errorsOf(result: ParseResult): ManifestError[] {
  if (result.ok) throw new Error('expected errors, got a valid manifest');
  return result.errors;
}

const withEvents = (eventsYaml: string) => `${HEADER}events:\n${eventsYaml}`;

describe('cloudEventType — deterministic rule (AC 1)', () => {
  it.each([
    ['tenant', 'TenantCreated', 'com.tecton.tenant.tenant-created'],
    ['leave', 'LeaveApproved', 'com.tecton.leave.leave-approved'],
    ['leave-requests', 'Submitted', 'com.tecton.leave-requests.submitted'],
    ['billing', 'ExportCSVReady', 'com.tecton.billing.export-csv-ready'],
    ['billing', 'Invoice2Paid', 'com.tecton.billing.invoice2-paid'],
  ])('(%s, %s) -> %s', (domain, event, type) => {
    expect(cloudEventType(domain, event)).toBe(type);
  });

  it('keeps the domain prefix of the event name, so different events never collide', () => {
    expect(cloudEventType('tenant', 'TenantCreated')).not.toBe(cloudEventType('tenant', 'Created'));
  });
});

describe('events.publishes (AC 1)', () => {
  it('Given a published event, When validated, Then the payload schema is compiled and the CloudEvents type exposed', () => {
    const result = parseManifest(
      withEvents(`  publishes:
    - name: TenantCreated
      description: "A tenant was created."
      schema: { tenantId: uuid, slug: string, at: datetime, note: string? }
`),
    );

    expect(result.ok && result.manifest.events).toEqual({
      publishes: [
        {
          name: 'TenantCreated',
          description: 'A tenant was created.',
          schema: { tenantId: 'uuid', slug: 'string', at: 'datetime', note: 'string?' },
          type: 'com.tecton.tenant.tenant-created',
          payloadSchema: {
            type: 'object',
            properties: {
              tenantId: { type: 'string', format: 'uuid' },
              slug: { type: 'string' },
              at: { type: 'string', format: 'date-time' },
              note: { type: 'string' },
            },
            required: ['tenantId', 'slug', 'at'],
            additionalProperties: false,
          },
        },
      ],
      consumes: [],
    });
  });

  it('Given no events key, When parsed, Then events defaults to empty lists', () => {
    const result = parseManifest(HEADER);

    expect(result.ok && result.manifest.events).toEqual({ publishes: [], consumes: [] });
  });

  it('Given events: {} and an event with an empty schema, When parsed, Then both are valid', () => {
    expect(parseManifest(`${HEADER}events: {}\n`).ok).toBe(true);
    expect(parseManifest(withEvents('  publishes:\n    - { name: Pinged, schema: {} }\n')).ok).toBe(true);
  });

  it('Given a camelCase event name, When validated, Then it fails at the name', () => {
    const errors = errorsOf(parseManifest(withEvents('  publishes:\n    - { name: tenantCreated, schema: {} }\n')));

    expect(errors).toEqual([expect.objectContaining({ path: 'events.publishes[0].name', code: 'invalid-format' })]);
  });

  it('Given an event without schema, When validated, Then the schema is required', () => {
    const errors = errorsOf(parseManifest(withEvents('  publishes:\n    - { name: TenantCreated }\n')));

    expect(errors).toEqual([expect.objectContaining({ path: 'events.publishes[0].schema', code: 'required' })]);
  });

  it('Given the same event published twice, When validated, Then the second is a duplicate name', () => {
    const errors = errorsOf(
      parseManifest(withEvents('  publishes:\n    - { name: TenantCreated, schema: {} }\n    - { name: TenantCreated, schema: {} }\n')),
    );

    expect(errors).toEqual([
      expect.objectContaining({
        path: 'events.publishes[1].name',
        code: 'duplicate-name',
        message: 'events.publishes[1].name "TenantCreated" is already used by events.publishes[0]',
      }),
    ]);
  });

  it('Given an unknown type in the payload, When validated, Then it fails at that field', () => {
    const errors = errorsOf(parseManifest(withEvents('  publishes:\n    - { name: TenantCreated, schema: { at: timestamp } }\n')));

    expect(errors).toEqual([expect.objectContaining({ path: 'events.publishes[0].schema.at', code: 'unknown-type' })]);
  });

  it('Given an unknown key inside events, When validated, Then it fails', () => {
    const errors = errorsOf(parseManifest(withEvents('  produces: []\n')));

    expect(errors).toEqual([expect.objectContaining({ path: 'events.produces', code: 'unknown-key' })]);
  });
});

describe('events.consumes — syntax only (AC 2)', () => {
  it('Given <domain>.<Event> entries, When validated, Then they are accepted without resolving the other domain', () => {
    const result = parseManifest(withEvents('  consumes: [directory.UserCreated, leave-requests.Submitted]\n'));

    expect(result.ok && result.manifest.events.consumes).toEqual(['directory.UserCreated', 'leave-requests.Submitted']);
  });

  it.each(['Directory.UserCreated', 'directory.userCreated', 'directory', 'directory.User.Created'])(
    'Given "%s", When validated, Then it fails with the expected syntax',
    (entry) => {
      const errors = errorsOf(parseManifest(withEvents(`  consumes: ["${entry}"]\n`)));

      expect(errors).toEqual([expect.objectContaining({ path: 'events.consumes[0]', code: 'invalid-format' })]);
      expect(errors[0]?.message).toContain('<domain>.<Event>');
    },
  );

  it('Given the same consumed event twice, When validated, Then the repeat is reported', () => {
    const errors = errorsOf(parseManifest(withEvents('  consumes: [directory.UserCreated, directory.UserCreated]\n')));

    expect(errors).toEqual([expect.objectContaining({ path: 'events.consumes[1]', code: 'duplicate-item' })]);
  });
});

describe('approval emit references (AC 3)', () => {
  const action = (approval: string) => `${HEADER}actions:
  - name: requestLeave
    description: "Requests leave."
    input: {}
    output: {}
    auth: { requires: [leave:request] }
    approval: ${approval}
events:
  publishes:
    - { name: LeaveApproved, schema: {} }
`;

  it('Given emit events that are published, When validated, Then it passes', () => {
    expect(parseManifest(action('{ required: true, onApprove: { emit: LeaveApproved } }')).ok).toBe(true);
  });

  it.each([
    ['onApprove', 'LeaveGranted'],
    ['onReject', 'LeaveRejected'],
  ])('Given %s.emit "%s" not in publishes, When validated, Then it fails naming the event', (side, event) => {
    const errors = errorsOf(parseManifest(action(`{ required: true, ${side}: { emit: ${event} } }`)));

    expect(errors).toEqual([
      expect.objectContaining({
        path: `actions[0].approval.${side}.emit`,
        code: 'unknown-event',
        message: `actions[0].approval.${side}.emit refers to event "${event}", which is not in events.publishes`,
      }),
    ]);
  });
});

describe('reference example (AC 4)', () => {
  it('Given leave-domain-manifest-v0.yaml, When validated, Then it passes and exposes the CloudEvents types', () => {
    const result = parseManifest(readFileSync(join(repoRoot, 'docs', 'examples', 'leave-domain-manifest-v0.yaml'), 'utf8'));

    expect(result.ok && result.manifest.events.publishes.map((event) => event.type)).toEqual([
      'com.tecton.leave.leave-approved',
      'com.tecton.leave.leave-rejected',
    ]);
  });
});
