import { describe, expect, it } from 'vitest';
import { parseManifest } from './parse.js';
import type { ManifestError, ParseResult } from './types.js';

const HEADER = `manifestVersion: "0.1"
domain: leave
version: 1.0.0
description: "Leave."
`;

function errorsOf(result: ParseResult): ManifestError[] {
  if (result.ok) throw new Error('expected errors, got a valid manifest');
  return result.errors;
}

describe('dependencies entries', () => {
  it('Given names and { domain, path } entries, When parsed, Then names and explicit paths are exposed', () => {
    const result = parseManifest(`${HEADER}dependencies:\n  - directory\n  - { domain: billing, path: ../billing }\n`);

    expect(result.ok && result.manifest.dependencies).toEqual(['directory', 'billing']);
    expect(result.ok && result.manifest.dependencyPaths).toEqual({ billing: '../billing' });
  });

  it.each([
    ['a remote URL string', '"https://example.com/billing/tecton.yaml"'],
    ['an object with url', '{ domain: billing, url: "https://example.com/tecton.yaml" }'],
    ['an object with a remote path', '{ domain: billing, path: "https://example.com/tecton.yaml" }'],
  ])('Given %s, When validated, Then it fails saying remote manifests are not supported (AC 7)', (_label, entry) => {
    const errors = errorsOf(parseManifest(`${HEADER}dependencies: [${entry}]\n`));

    expect(errors).toEqual([expect.objectContaining({ path: 'dependencies[0]', code: 'unsupported-dependency' })]);
    expect(errors[0]?.message).toContain('remote manifests are not supported in the MVP');
  });

  it.each([
    ['{ path: ../billing }', 'dependencies[0]', 'required'],
    ['{ domain: billing }', 'dependencies[0]', 'required'],
    ['{ domain: Billing, path: ../billing }', 'dependencies[0].domain', 'invalid-format'],
    ['{ domain: billing, path: "" }', 'dependencies[0].path', 'invalid-format'],
    ['{ domain: billing, path: ../b, version: 2 }', 'dependencies[0].version', 'unknown-key'],
    ['42', 'dependencies[0]', 'invalid-type'],
  ])('Given %s, When validated, Then it fails at %s with %s', (entry, path, code) => {
    expect(errorsOf(parseManifest(`${HEADER}dependencies: [${entry}]\n`))).toEqual([expect.objectContaining({ path, code })]);
  });

  it('Given the same domain as a name and as an object, When validated, Then the repeat is reported', () => {
    const errors = errorsOf(parseManifest(`${HEADER}dependencies: [billing, { domain: billing, path: ../billing }]\n`));

    expect(errors).toEqual([expect.objectContaining({ path: 'dependencies[1]', code: 'duplicate-item' })]);
  });
});

describe('built-in Directory classes', () => {
  it('Given an objectClass named Root, When validated, Then it fails as a reserved name', () => {
    const errors = errorsOf(parseManifest(`${HEADER}objectClass: { name: Root, containment: { allowedParents: [Tenant] } }\n`));

    expect(errors).toEqual([expect.objectContaining({ path: 'objectClass.name', code: 'reserved-name' })]);
  });
});
