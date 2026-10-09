import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseManifest } from './parse.js';
import { SUPPORTED_MANIFEST_VERSIONS } from './schema.js';
import type { ManifestError, ParseResult } from './types.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const VALID = `manifestVersion: "0.1"
domain: leave-requests
version: 1.0.0
description: "Leave requests and approvals."
dependencies: []
`;

function errorsOf(result: ParseResult): ManifestError[] {
  if (result.ok) throw new Error(`expected errors, got a valid manifest: ${JSON.stringify(result.manifest)}`);
  return result.errors;
}

function withField(field: string, line: string): string {
  return VALID.replace(new RegExp(`^${field}:.*$`, 'm'), line);
}

describe('parseManifest — valid identity (AC 1)', () => {
  it('Given a complete identity block, When parsed, Then it returns a typed manifest and no errors', () => {
    const result = parseManifest(VALID);

    expect(result).toEqual({
      ok: true,
      manifest: {
        manifestVersion: '0.1',
        domain: 'leave-requests',
        version: '1.0.0',
        description: 'Leave requests and approvals.',
        dependencies: [],
        actions: [],
        events: { publishes: [], consumes: [] },
      },
    });
  });

  it('Given no dependencies key, When parsed, Then dependencies defaults to an empty list', () => {
    const result = parseManifest(VALID.replace('dependencies: []\n', ''));

    expect(result.ok && result.manifest.dependencies).toEqual([]);
  });

  it('Given a full semver with pre-release and build metadata, When parsed, Then it is valid', () => {
    expect(parseManifest(withField('version', 'version: 1.0.0-rc.1+build.5')).ok).toBe(true);
  });

  it('Given dependencies on other domains, When parsed, Then they are kept in order', () => {
    const result = parseManifest(withField('dependencies', 'dependencies: [directory, auth]'));

    expect(result.ok && result.manifest.dependencies).toEqual(['directory', 'auth']);
  });

  it.each(['tenant-domain-manifest-v0.yaml', 'leave-domain-manifest-v0.yaml'])(
    'Given the reference example %s, When parsed, Then it is valid (reserved keys accepted)',
    (file) => {
      const source = readFileSync(join(repoRoot, 'docs', 'examples', file), 'utf8');

      expect(parseManifest(source, { fileName: file })).toMatchObject({ ok: true });
    },
  );
});

describe('parseManifest — manifestVersion (AC 2, AC 3)', () => {
  it('Given no manifestVersion, When validated, Then it fails at path manifestVersion', () => {
    const errors = errorsOf(parseManifest(VALID.replace('manifestVersion: "0.1"\n', '')));

    expect(errors).toEqual([
      expect.objectContaining({ path: 'manifestVersion', code: 'required', message: 'manifestVersion is required' }),
    ]);
  });

  it('Given an unsupported manifestVersion, When validated, Then the error lists the supported versions', () => {
    const [error] = errorsOf(parseManifest(withField('manifestVersion', 'manifestVersion: "9.9"')));

    expect(error).toMatchObject({ path: 'manifestVersion', code: 'unsupported-manifest-version', line: 1 });
    for (const version of SUPPORTED_MANIFEST_VERSIONS) {
      expect(error?.message).toContain(`"${version}"`);
    }
  });

  it('Given manifestVersion without quotes (YAML number), When validated, Then it explains the quoting', () => {
    const errors = errorsOf(parseManifest(withField('manifestVersion', 'manifestVersion: 0.1')));

    expect(errors).toEqual([
      expect.objectContaining({
        path: 'manifestVersion',
        code: 'invalid-type',
        message: 'manifestVersion must be a quoted string, e.g. "0.1"',
      }),
    ]);
  });
});

describe('parseManifest — domain and version format (AC 4)', () => {
  it.each(['Leave_Requests', '-leave', 'leave-', 'leave--x', 'Leave', '1leave', `a${'b'.repeat(63)}`])(
    'Given domain "%s", When validated, Then it fails at path domain',
    (domain) => {
      const errors = errorsOf(parseManifest(withField('domain', `domain: "${domain}"`)));

      expect(errors).toEqual([expect.objectContaining({ path: 'domain', code: 'invalid-format', line: 2 })]);
    },
  );

  it('Given a 63-character kebab-case domain, When validated, Then it is valid', () => {
    expect(parseManifest(withField('domain', `domain: a${'b'.repeat(62)}`)).ok).toBe(true);
  });

  it.each(['1.0', '"1.0"', '"v1.0.0"', '"1.0.0.0"', '"01.0.0"'])(
    'Given version %s, When validated, Then it fails at path version',
    (version) => {
      const errors = errorsOf(parseManifest(withField('version', `version: ${version}`)));

      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ path: 'version', line: 3 });
      expect(['invalid-format', 'invalid-type']).toContain(errors[0]?.code);
    },
  );

  it('Given a blank description, When validated, Then it fails at path description', () => {
    const errors = errorsOf(parseManifest(withField('description', 'description: "   "')));

    expect(errors).toEqual([expect.objectContaining({ path: 'description', code: 'invalid-format' })]);
  });

  it('Given a repeated dependency, When validated, Then it fails at the repeated item', () => {
    const errors = errorsOf(parseManifest(withField('dependencies', 'dependencies: [billing, auth, billing]')));

    expect(errors).toEqual([
      expect.objectContaining({
        path: 'dependencies[2]',
        code: 'duplicate-item',
        message: 'dependencies[2] "billing" is listed more than once',
      }),
    ]);
  });

  it('Given a dependency that is not a domain name, When validated, Then it fails at that item', () => {
    const errors = errorsOf(parseManifest(withField('dependencies', 'dependencies: [Billing_Service]')));

    expect(errors).toEqual([expect.objectContaining({ path: 'dependencies[0]', code: 'invalid-format' })]);
  });
});

describe('parseManifest — top-level keys (AC 5)', () => {
  it('Given an unknown top-level key one edit away from a reserved one, When validated, Then it fails and suggests the key', () => {
    const errors = errorsOf(parseManifest(`${VALID}action: []\n`));

    expect(errors).toEqual([
      expect.objectContaining({
        path: 'action',
        code: 'unknown-key',
        message: 'unknown top-level key "action"; did you mean "actions"?',
        line: 6,
        column: 1,
      }),
    ]);
  });

  it('Given an unrelated unknown key, When validated, Then it fails without a suggestion', () => {
    const [error] = errorsOf(parseManifest(`${VALID}owner: team-a\n`));

    expect(error).toMatchObject({ path: 'owner', code: 'unknown-key', message: 'unknown top-level key "owner"' });
  });

  it('Given the reserved keys actions, events and objectClass, When validated, Then they are accepted', () => {
    const source = `${VALID}actions: []\nevents: { publishes: [], consumes: [] }\nobjectClass: { name: Thing }\n`;

    expect(parseManifest(source).ok).toBe(true);
  });
});

describe('parseManifest — YAML syntax and root (AC 6)', () => {
  it('Given broken indentation, When parsed, Then the error has line and column', () => {
    const errors = errorsOf(parseManifest('manifestVersion: "0.1"\ndomain: leave\n  version: 1.0.0\n'));

    expect(errors[0]).toMatchObject({ code: 'yaml-syntax', path: '', line: expect.any(Number), column: expect.any(Number) });
  });

  it('Given a duplicated key, When parsed, Then it is a syntax error pointing at the duplicate', () => {
    const errors = errorsOf(parseManifest(`${VALID}domain: other\n`));

    expect(errors).toEqual([expect.objectContaining({ code: 'yaml-syntax', line: 6 })]);
  });

  it('Given two YAML documents, When parsed, Then it is a syntax error', () => {
    const errors = errorsOf(parseManifest(`${VALID}---\n${VALID}`));

    expect(errors[0]).toMatchObject({ code: 'yaml-syntax' });
  });

  it.each([
    ['an empty file', ''],
    ['only comments', '# nothing here\n'],
    ['a list', '- a\n- b\n'],
    ['a scalar', 'hello\n'],
  ])('Given %s, When parsed, Then it fails with invalid-root', (_label, source) => {
    expect(errorsOf(parseManifest(source))).toEqual([expect.objectContaining({ code: 'invalid-root', path: '' })]);
  });
});

describe('parseManifest — error reporting (AC 7)', () => {
  const BROKEN = `domain: Bad_Domain
version: "1.0"
description: ""
owner: someone
`;

  it('Given several problems, When validated, Then all errors come back at once, ordered by line', () => {
    const errors = errorsOf(parseManifest(BROKEN));

    expect(errors.map((error) => [error.path, error.code])).toEqual([
      ['manifestVersion', 'required'],
      ['domain', 'invalid-format'],
      ['version', 'invalid-format'],
      ['description', 'invalid-format'],
      ['owner', 'unknown-key'],
    ]);
    for (const error of errors) {
      expect(error).toEqual(expect.objectContaining({ path: expect.any(String), code: expect.any(String), message: expect.any(String) }));
    }
  });

  it('Given any error, When reported, Then the message is plain English (ASCII only)', () => {
    const errors = [
      ...errorsOf(parseManifest(BROKEN)),
      ...errorsOf(parseManifest('')),
      ...errorsOf(parseManifest('a: [')),
      ...errorsOf(parseManifest(withField('dependencies', 'dependencies: [x, x]'))),
    ];

    for (const error of errors) {
      expect(error.message).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  it('Given the same input twice, When parsed, Then the result is identical (deterministic)', () => {
    expect(parseManifest(BROKEN)).toEqual(parseManifest(BROKEN));
  });
});
