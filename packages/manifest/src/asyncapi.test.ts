import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from '@asyncapi/parser';
import { describe, expect, it } from 'vitest';
import { buildAsyncApiDocument } from './asyncapi.js';
import { parseManifest } from './parse.js';
import type { TectonManifest } from './types.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const parser = new Parser();

function manifestOf(source: string): TectonManifest {
  const result = parseManifest(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.manifest;
}

/** Errors (severity 0) reported by the official AsyncAPI parser. */
async function parserErrors(document: unknown): Promise<string[]> {
  const { diagnostics } = await parser.parse(JSON.stringify(document));
  return diagnostics.filter((diagnostic) => diagnostic.severity === 0).map((diagnostic) => `${diagnostic.code}: ${diagnostic.message} at ${diagnostic.path.join('.')}`);
}

const LEAVE = manifestOf(`manifestVersion: "0.1"
domain: leave
version: 1.0.0
description: "Leave requests."
events:
  publishes:
    - name: LeaveApproved
      description: "A leave request was approved."
      schema: { requestId: uuid, approvedBy: uuid, at: datetime }
    - name: LeaveRejected
      schema: { requestId: uuid, reason: string? }
  consumes: [directory.UserCreated, leave.LeaveApproved]
`);

type Doc = Record<string, any>;

describe('buildAsyncApiDocument (AC 1)', () => {
  const doc = buildAsyncApiDocument(LEAVE) as Doc;

  it('describes the domain as an AsyncAPI 3.0 document', () => {
    expect(doc['asyncapi']).toBe('3.0.0');
    expect(doc['info']).toEqual({ title: 'leave', version: '1.0.0', description: 'Leave requests.' });
    expect(doc['defaultContentType']).toBe('application/json');
  });

  it('has one channel per origin domain (one stream per domain)', () => {
    expect(doc['channels']['leave']['address']).toBe('tecton.leave');
    expect(Object.keys(doc['channels']['leave']['messages'])).toEqual(['LeaveApproved', 'LeaveRejected']);
    expect(doc['channels']['directory']['address']).toBe('tecton.directory');
    expect(Object.keys(doc['channels']['directory']['messages'])).toEqual(['UserCreated']);
  });

  it('turns each published event into a send operation', () => {
    expect(doc['operations']['sendLeaveApproved']).toEqual({
      action: 'send',
      channel: { $ref: '#/channels/leave' },
      messages: [{ $ref: '#/channels/leave/messages/LeaveApproved' }],
    });
  });

  it('turns each consumed event into a receive operation', () => {
    expect(doc['operations']['receiveDirectoryUserCreated']).toEqual({
      action: 'receive',
      channel: { $ref: '#/channels/directory' },
      messages: [{ $ref: '#/channels/directory/messages/UserCreated' }],
    });
    expect(doc['operations']['receiveLeaveLeaveApproved']['channel']).toEqual({ $ref: '#/channels/leave' });
  });

  it('uses the compiled JSON Schema as payload and carries the CloudEvents type', () => {
    expect(doc['components']['messages']['LeaveApproved']).toEqual({
      name: 'LeaveApproved',
      title: 'LeaveApproved',
      summary: 'A leave request was approved.',
      contentType: 'application/json',
      payload: LEAVE.events.publishes[0]?.payloadSchema,
      'x-cloudevents-type': 'com.tecton.leave.leave-approved',
    });
    expect(doc['components']['messages']['directory.UserCreated']['x-cloudevents-type']).toBe('com.tecton.directory.user-created');
  });

  it('uses a resolver for consumed payloads when one is given', () => {
    const resolved = buildAsyncApiDocument(LEAVE, {
      resolveEvent: (domain, event) => (domain === 'directory' && event === 'UserCreated' ? { type: 'object', properties: { userId: { type: 'string' } } } : undefined),
    }) as Doc;

    expect(resolved['components']['messages']['directory.UserCreated']['payload']).toEqual({
      type: 'object',
      properties: { userId: { type: 'string' } },
    });
  });
});

describe('validated by @asyncapi/parser (AC 2, AC 4)', () => {
  it('Given publishes and consumes, When parsed, Then there is no error', async () => {
    expect(await parserErrors(buildAsyncApiDocument(LEAVE))).toEqual([]);
  });

  it('Given a manifest without events, When generated and parsed, Then it is valid and has no operations', async () => {
    const doc = buildAsyncApiDocument(manifestOf('manifestVersion: "0.1"\ndomain: quiet\nversion: 1.0.0\ndescription: "No events."\n')) as Doc;

    expect(doc['operations']).toEqual({});
    expect(await parserErrors(doc)).toEqual([]);
  });

  it.each(['tenant-domain-manifest-v0.yaml', 'leave-domain-manifest-v0.yaml'])('Given the example %s, When generated and parsed, Then there is no error', async (file) => {
    const manifest = manifestOf(readFileSync(join(repoRoot, 'docs', 'examples', file), 'utf8'));

    expect(await parserErrors(buildAsyncApiDocument(manifest))).toEqual([]);
  });
});
