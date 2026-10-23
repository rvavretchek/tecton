import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertValidServiceCredential,
  buildSigningKeys,
  createAccessTokenIssuer,
  createAuthService,
  createServiceTokenIssuer,
  ServiceAlreadyRegisteredError,
  type AuthServiceApp,
  type Credential,
  type CredentialStore,
  type RefreshTokenStore,
  type ServiceCredential,
  type ServiceCredentialStore,
} from '@tecton/auth';
import { createArgon2idAuthProvider, LoginLockoutUnavailableError, RevocationStoreUnavailableError } from '@tecton/providers';
import { assertNoSecretsLeaked, createMemoryLoginLockout, createMemoryTokenRevocationStore, ed25519KeyPairPem } from '#test-support';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../cli.js';
import type { CliIo } from '../io.js';
import { authRegisterServiceCommand, type AuthRegisterServiceDependencies } from './auth-register-service.js';

const PASSWORD = 'admin-password-123';
const auth = createArgon2idAuthProvider({ peppers: [{ id: '1', key: Buffer.from('cli-register-service-pepper-32-byte', 'utf8') }], currentPepperId: '1' });
const workspaces: string[] = [];

afterAll(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

/** A Tecton workspace with apps/domains/<domain>/tecton.yaml for each manifest given. */
function workspace(manifests: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tecton-register-service-'));
  workspaces.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'acme', devDependencies: { '@tecton/cli': '0.0.0' } }));
  mkdirSync(join(root, 'apps', 'domains'), { recursive: true });
  for (const [domain, source] of Object.entries(manifests)) {
    mkdirSync(join(root, 'apps', 'domains', domain), { recursive: true });
    writeFileSync(join(root, 'apps', 'domains', domain, 'tecton.yaml'), source);
  }
  return root;
}

const manifest = (domain: string, dependencies: string[] = []) =>
  `manifestVersion: "0.1"\ndomain: ${domain}\nversion: 1.0.0\ndescription: "The ${domain} domain."\ndependencies: [${dependencies.join(', ')}]\n`;

function memoryServices() {
  const rows = new Map<string, ServiceCredential>();
  const store: ServiceCredentialStore = {
    findByDomain: async (domain) => rows.get(domain),
    register: async (credential) => {
      assertValidServiceCredential(credential);
      if (rows.has(credential.domain)) throw new ServiceAlreadyRegisteredError(credential.domain);
      rows.set(credential.domain, credential);
    },
    replace: async (credential) => {
      if (!rows.has(credential.domain)) return false;
      rows.set(credential.domain, credential);
      return true;
    },
    close: async () => undefined,
  };
  return { store, rows };
}

/** No refresh family is ever needed here: the command uses the access token only. */
const refreshTokens: RefreshTokenStore = {
  openFamily: async () => undefined,
  rotate: async () => ({ kind: 'unknown' }),
  revokeFamilyOf: async () => false,
  close: async () => undefined,
};

let app: AuthServiceApp;
let baseUrl: string;
let services: ReturnType<typeof memoryServices>;
let revocations: ReturnType<typeof createMemoryTokenRevocationStore>;

beforeAll(async () => {
  const keys = await buildSigningKeys({ privateKeyPem: ed25519KeyPairPem().privatePem });
  const hash = await auth.hashPassword(PASSWORD);
  const credentials: Credential[] = [
    { id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e5f', login: 'admin', passwordHash: hash, status: 'active', permissions: ['auth:service:register'], createdAt: new Date(0), updatedAt: new Date(0) },
    { id: '0192a6b2-7c4e-7a10-9d3f-0a1b2c3d4e60', login: 'alice', passwordHash: hash, status: 'active', permissions: [], createdAt: new Date(0), updatedAt: new Date(0) },
  ];
  const store: CredentialStore = {
    count: async () => credentials.length,
    findByLogin: async (login) => credentials.find((credential) => credential.login === login),
    findById: async (id) => credentials.find((credential) => credential.id === id),
    create: async () => undefined,
    createIfEmpty: async () => false,
    updatePasswordHash: async () => true,
    close: async () => undefined,
  };
  services = memoryServices();
  revocations = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('down'));
  const clock = { now: () => new Date() };
  app = await createAuthService({
    store,
    refreshTokens,
    revocations,
    lockout: createMemoryLoginLockout(() => new LoginLockoutUnavailableError('down'), () => new Date()),
    auth,
    issuer: createAccessTokenIssuer({ keys, clock }),
    keys,
    clock,
    services: services.store,
    serviceTokens: createServiceTokenIssuer({ keys, clock }),
    logger: false,
  });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
}, 60_000);

afterAll(async () => {
  await app?.close();
});

afterEach(() => {
  services.rows.clear();
});

function harness(cwd: string, env: NodeJS.ProcessEnv, stdin?: { isTTY?: boolean; text?: string }) {
  let stdout = '';
  let stderr = '';
  const calls: string[] = [];
  const io: CliIo = {
    cwd,
    stdout: { write: (text) => void (stdout += text) },
    stderr: { write: (text) => void (stderr += text) },
    env,
    ...(stdin ? { stdin: { isTTY: stdin.isTTY ?? false, readAll: async () => stdin.text ?? '' } } : {}),
  };
  const dependencies: AuthRegisterServiceDependencies = {
    fetch: (input, init) => {
      calls.push(new URL(String(input)).pathname);
      return fetch(input, init);
    },
  };
  return { io, dependencies, calls, output: () => ({ stdout, stderr }) };
}

const devEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ TECTON_AUTH_URL: baseUrl, TECTON_ENV: 'development', TECTON_AUTH_ADMIN_PASSWORD: PASSWORD, ...extra });
const secretIn = (stdout: string) => /^([A-Za-z0-9_-]{43})$/m.exec(stdout)?.[1] ?? '';
const serviceToken = (serviceId: string, secret: string) => app.inject({ method: 'POST', url: '/auth/service-token', payload: { serviceId, secret } });

describe('tecton-admin auth register-service (Story 2.7a, AC 1, 3, 5, 6, 9)', () => {
  it('logs in, registers with the manifest dependencies, prints the secret once and logs out', async () => {
    const root = workspace({ billing: manifest('billing', ['tenant', 'catalog']) });
    const { io, dependencies, calls, output } = harness(root, devEnv());
    const revokedBefore = revocations.revokedTokens().length;

    const code = await authRegisterServiceCommand('billing', { login: 'admin', permission: ['invoice:write'] }, io, dependencies);

    expect(code).toBe(0);
    const { stdout, stderr } = output();
    expect(stderr).toBe('');
    expect(stdout).toContain('Registered the credential of service "billing" (service:billing).');
    expect(stdout).toContain('Calls: tenant, catalog. Permissions: invoice:write.');
    expect(stdout).toContain('shown only this once');
    const secret = secretIn(stdout);
    expect(stdout.split(secret)).toHaveLength(2);
    expect(calls).toEqual(['/auth/login', '/auth/register-service', '/auth/logout']);
    // The administrator token is revoked at the end (EQ-5).
    expect(revocations.revokedTokens()).toHaveLength(revokedBefore + 1);
    expect(services.rows.get('billing')).toMatchObject({ callees: ['catalog', 'tenant'], permissions: ['invoice:write'] });
    const issued = await serviceToken('billing', secret);
    expect(issued.statusCode).toBe(200);
    const perms = JSON.parse(Buffer.from((issued.json() as { accessToken: string }).accessToken.split('.')[1] ?? '', 'base64url').toString()).perms;
    expect(perms).toEqual(['invoice:write', 'call:catalog', 'call:tenant']);
    assertNoSecretsLeaked(stdout + stderr, { password: PASSWORD });
  });

  it('reads the password from standard input', async () => {
    const root = workspace({ billing: manifest('billing') });
    const { io, dependencies, output } = harness(root, devEnv({ TECTON_AUTH_ADMIN_PASSWORD: undefined }), { text: `${PASSWORD}\n` });

    expect(await authRegisterServiceCommand('billing', { login: 'admin' }, io, dependencies)).toBe(0);
    expect(output().stdout).toContain('Calls: none. Permissions: none.');
  });

  it('exits 2 for an already registered service, changes nothing and still logs out', async () => {
    const root = workspace({ billing: manifest('billing') });
    const first = harness(root, devEnv());
    await authRegisterServiceCommand('billing', { login: 'admin' }, first.io, first.dependencies);
    const secret = secretIn(first.output().stdout);
    const again = harness(root, devEnv());

    const code = await authRegisterServiceCommand('billing', { login: 'admin' }, again.io, again.dependencies);

    expect(code).toBe(2);
    expect(again.output().stderr).toMatch(/^auth register-service refused: service "billing" is already registered; nothing changed \(use --rotate/);
    expect(again.output().stdout).toBe('');
    expect(again.calls).toEqual(['/auth/login', '/auth/register-service', '/auth/logout']);
    expect((await serviceToken('billing', secret)).statusCode).toBe(200);
  });

  it('rotates with --rotate: the old secret stops working', async () => {
    const root = workspace({ billing: manifest('billing') });
    const first = harness(root, devEnv());
    await authRegisterServiceCommand('billing', { login: 'admin' }, first.io, first.dependencies);
    const old = secretIn(first.output().stdout);
    const rotated = harness(root, devEnv());

    expect(await authRegisterServiceCommand('billing', { login: 'admin', rotate: true }, rotated.io, rotated.dependencies)).toBe(0);
    expect(rotated.output().stdout).toContain('Rotated the credential of service "billing"');
    expect(rotated.output().stdout).toContain('The previous secret no longer works');
    expect((await serviceToken('billing', old)).statusCode).toBe(401);
    expect((await serviceToken('billing', secretIn(rotated.output().stdout))).statusCode).toBe(200);
  });

  it('parses repeated --permission and --rotate through tecton-admin', async () => {
    const root = workspace({ billing: manifest('billing') });
    let stdout = '';
    const io: CliIo = { cwd: root, stdout: { write: (text) => void (stdout += text) }, stderr: { write: () => undefined }, env: devEnv() };

    expect(await run(['auth', 'register-service', 'billing', '--login', 'admin', '--permission', 'invoice:write', '--permission', 'tenant:read', '--rotate'], io)).toBe(0);
    expect(stdout).toContain('Permissions: invoice:write, tenant:read.');
    expect(services.rows.get('billing')?.permissions).toEqual(['invoice:write', 'tenant:read']);
  });

  it('logs out also when the registration is refused (invalid permission)', async () => {
    const root = workspace({ billing: manifest('billing') });
    const { io, dependencies, calls, output } = harness(root, devEnv());

    expect(await authRegisterServiceCommand('billing', { login: 'admin', permission: ['call:tenant'] }, io, dependencies)).toBe(1);
    expect(output().stderr).toMatch(/^auth register-service failed: registration refused: .*derived from the manifest dependencies/);
    expect(calls).toEqual(['/auth/login', '/auth/register-service', '/auth/logout']);
    expect(services.rows.size).toBe(0);
  });

  it('fails for an administrator without auth:service:register, and logs out', async () => {
    const root = workspace({ billing: manifest('billing') });
    const { io, dependencies, calls, output } = harness(root, devEnv());

    expect(await authRegisterServiceCommand('billing', { login: 'alice' }, io, dependencies)).toBe(1);
    expect(output().stderr).toBe('auth register-service failed: "alice" lacks the permission auth:service:register\n');
    expect(calls.at(-1)).toBe('/auth/logout');
  });

  it('fails on a wrong password without registering', async () => {
    const root = workspace({ billing: manifest('billing') });
    const { io, dependencies, calls, output } = harness(root, devEnv({ TECTON_AUTH_ADMIN_PASSWORD: 'wrong-password-123' }));

    expect(await authRegisterServiceCommand('billing', { login: 'admin' }, io, dependencies)).toBe(1);
    expect(output().stderr).toBe('auth register-service failed: login refused: wrong login or password\n');
    expect(calls).toEqual(['/auth/login']);
    assertNoSecretsLeaked(output().stderr, { password: 'wrong-password-123' });
  });

  it.each([
    ['a missing manifest', {}, 'billing', /cannot read the manifest of "billing" at .*generate the domain first/],
    ['an invalid manifest', { billing: 'domain: [' }, 'billing', /the manifest at .* is invalid/],
    ['a manifest of another domain', { billing: manifest('catalog') }, 'billing', /declares domain "catalog", not "billing"/],
    ['an invalid domain name', {}, 'Billing', /"Billing" is not a valid domain name/],
  ])('fails on %s before any request', async (_name, manifests, domain, message) => {
    const root = workspace(manifests);
    const { io, dependencies, calls, output } = harness(root, devEnv());

    expect(await authRegisterServiceCommand(domain, { login: 'admin' }, io, dependencies)).toBe(1);
    expect(output().stderr).toMatch(message);
    expect(calls).toEqual([]);
  });

  it('fails outside a Tecton workspace', async () => {
    const { io, dependencies, output } = harness(tmpdir(), devEnv());

    expect(await authRegisterServiceCommand('billing', { login: 'admin' }, io, dependencies)).toBe(1);
    expect(output().stderr).toMatch(/not inside a Tecton workspace/);
  });

  it.each([
    ['no URL', { TECTON_AUTH_URL: undefined }, /TECTON_AUTH_URL is not set/],
    ['http outside development', { TECTON_ENV: undefined }, /TECTON_AUTH_URL must use https \(http is accepted only with TECTON_ENV=development\)/],
    ['a URL with credentials', { TECTON_AUTH_URL: 'https://admin:url-secret-123@auth.example.com' }, /TECTON_AUTH_URL must not contain a user or password/],
    ['an invalid URL', { TECTON_AUTH_URL: 'not a url' }, /TECTON_AUTH_URL is not a valid URL/],
  ])('fails with %s before any request', async (_name, extra, message) => {
    const root = workspace({ billing: manifest('billing') });
    const { io, dependencies, calls, output } = harness(root, devEnv(extra));

    expect(await authRegisterServiceCommand('billing', { login: 'admin' }, io, dependencies)).toBe(1);
    expect(output().stderr).toMatch(message);
    expect(output().stderr).not.toContain('url-secret-123');
    expect(calls).toEqual([]);
  });

  it('fails without a password: never reads an interactive terminal', async () => {
    const root = workspace({ billing: manifest('billing') });
    const { io, dependencies, calls, output } = harness(root, devEnv({ TECTON_AUTH_ADMIN_PASSWORD: undefined }), { isTTY: true });

    expect(await authRegisterServiceCommand('billing', { login: 'admin' }, io, dependencies)).toBe(1);
    expect(output().stderr).toMatch(/no password given; set TECTON_AUTH_ADMIN_PASSWORD or pipe it to standard input/);
    expect(calls).toEqual([]);
  });

  it('fails clearly when the Auth service is unreachable, without printing the URL', async () => {
    const root = workspace({ billing: manifest('billing') });
    const { io, dependencies, output } = harness(root, devEnv({ TECTON_AUTH_URL: 'http://127.0.0.1:1' }));

    expect(await authRegisterServiceCommand('billing', { login: 'admin' }, io, dependencies)).toBe(1);
    expect(output().stderr).toMatch(/^auth register-service failed: could not reach the Auth service \(\w+\); check TECTON_AUTH_URL/);
    expect(output().stderr).not.toContain('127.0.0.1');
  });

  it('warns when the final logout fails, keeping the outcome', async () => {
    const root = workspace({ billing: manifest('billing') });
    const { io, output } = harness(root, devEnv());
    const dependencies: AuthRegisterServiceDependencies = {
      fetch: (input, init) => (new URL(String(input)).pathname === '/auth/logout' ? Promise.reject(new TypeError('fetch failed')) : fetch(input, init)),
    };

    expect(await authRegisterServiceCommand('billing', { login: 'admin' }, io, dependencies)).toBe(0);
    expect(output().stderr).toBe('warning: could not log out; the administrator token stays valid until it expires (15 minutes)\n');
  });
});
