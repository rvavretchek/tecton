import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintWorkspace, parseManifest } from '@tecton/manifest';
import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
  version: string;
  files: string[];
  tecton: { manifests: string[] };
};
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Story 2.2a, AC 4.
describe('@tecton/auth manifest', () => {
  const parsed = parseManifest(readFileSync(join(packageRoot, 'tecton.yaml'), 'utf8'));

  it('is a valid manifest for the auth domain with the package version', () => {
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    expect(parsed.ok && parsed.manifest).toMatchObject({ domain: 'auth', version: packageJson.version });
  });

  it('declares login, refresh, logout, service-token and register-service, and no JWKS action', () => {
    expect(parsed.ok && parsed.manifest.actions.map((action) => action.name)).toEqual(['login', 'refresh', 'logout', 'serviceToken', 'registerService']);
  });

  it('never declares a refresh token in an output: the response serializer drops it from bodies (Story 2.3, AC 1, AC 7)', () => {
    const outputs = parsed.ok ? Object.fromEntries(parsed.manifest.actions.map((action) => [action.name, Object.keys(action.output).sort()])) : {};

    expect(outputs).toEqual({
      login: ['accessToken', 'expiresIn', 'tokenType'],
      refresh: ['accessToken', 'expiresIn', 'tokenType'],
      logout: [],
      serviceToken: ['accessToken', 'expiresIn', 'tokenType'],
      registerService: ['domain', 'rotated', 'secret'],
    });
  });

  it('is published and declared for the lint through "tecton.manifests"', () => {
    expect(packageJson.tecton.manifests).toEqual(['./tecton.yaml']);
    expect(packageJson.files).toEqual(expect.arrayContaining(['tecton.yaml', 'prisma']));
  });

  it('lets a workspace domain depend on "auth" through the installed package', () => {
    const root = mkdtempSync(join(tmpdir(), 'tecton-auth-lint-'));
    created.push(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'acme', dependencies: { '@tecton/auth': '*' } }));
    mkdirSync(join(root, 'node_modules', '@tecton'), { recursive: true });
    symlinkSync(packageRoot, join(root, 'node_modules', '@tecton', 'auth'), 'junction');
    mkdirSync(join(root, 'finance'));
    writeFileSync(
      join(root, 'finance', 'tecton.yaml'),
      'manifestVersion: "0.1"\ndomain: finance\nversion: 1.0.0\ndescription: "Finance."\ndependencies: [auth]\n',
    );

    expect(lintWorkspace({ cwd: root }).problems).toEqual([]);
  });
});
