import { createArgon2idAuthProvider, RevocationStoreUnavailableError } from '@tecton/providers';
import { createMemoryTokenRevocationStore, createTestClock } from '#test-support';
import { describe, expect, it, vi } from 'vitest';
import type { IssuedAccessToken } from './access-token.js';
import { InvalidCredentialError } from './credential.js';
import { createMemoryServiceCredentialStore } from './memory-service-credential-store.test-helper.js';
import {
  InvalidServiceCredentialsError,
  InvalidServiceRegistrationError,
  issueServiceToken,
  registerService,
  ServiceAlreadyRegisteredError,
  validatedRegistration,
  type ServiceTokenIssuer,
} from './service-credential.js';

const auth = createArgon2idAuthProvider({ peppers: [{ id: '1', key: Buffer.from('service-credential-pepper-32-bytes', 'utf8') }], currentPepperId: '1' });
const NOW = new Date('2026-10-23T12:00:00.000Z');

function setup() {
  const clock = createTestClock(NOW);
  const services = createMemoryServiceCredentialStore();
  const revocations = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('down'), () => clock.now());
  const issued: Array<{ domain: string; permissions: readonly string[] }> = [];
  const tokens: ServiceTokenIssuer = {
    async issue(service): Promise<IssuedAccessToken> {
      issued.push(service);
      return { accessToken: `token-for-${service.domain}`, tokenType: 'Bearer', expiresIn: 300 };
    },
  };
  const register = (request: Partial<Parameters<typeof registerService>[1]> & { domain: string }) =>
    registerService({ services: services.store, auth, revocations, clock }, { dependencies: [], permissions: [], rotate: false, ...request });
  return { clock, services, revocations, tokens, issued, register };
}

describe('validatedRegistration', () => {
  it('normalizes the lists: de-duplicated and sorted', () => {
    expect(validatedRegistration({ domain: 'billing', dependencies: ['tenant', 'catalog', 'tenant'], permissions: ['tenant:read', 'invoice:write', 'tenant:read'] })).toEqual({
      domain: 'billing',
      callees: ['catalog', 'tenant'],
      permissions: ['invoice:write', 'tenant:read'],
    });
  });

  it.each([
    ['an invalid domain', { domain: 'Billing', dependencies: [], permissions: [] }, /not a valid domain name/],
    ['the Auth service', { domain: 'auth', dependencies: [], permissions: [] }, /ready-made service/],
    ['an invalid dependency', { domain: 'billing', dependencies: ['tenant_x'], permissions: [] }, /dependency "tenant_x"/],
    ['a dependency on itself', { domain: 'billing', dependencies: ['billing'], permissions: [] }, /depend on itself/],
    ['an invalid permission', { domain: 'billing', dependencies: [], permissions: ['not a permission'] }, /./],
    ['a hand-granted call: permission (AC 5)', { domain: 'billing', dependencies: [], permissions: ['call:tenant'] }, /derived from the manifest dependencies/],
  ])('refuses %s', (_name, request, message) => {
    expect(() => validatedRegistration(request)).toThrow(InvalidServiceRegistrationError);
    expect(() => validatedRegistration(request)).toThrow(message);
  });
});

describe('registerService (AC 1, 3, 6)', () => {
  it('returns the secret once and stores only its AuthProvider hash', async () => {
    const { register, services } = setup();
    const result = await register({ domain: 'billing', dependencies: ['tenant'], permissions: ['invoice:write'] });

    expect(result).toEqual({ domain: 'billing', secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), rotated: false });
    const row = services.rows.get('billing');
    expect(row).toMatchObject({ domain: 'billing', permissions: ['invoice:write'], callees: ['tenant'], status: 'active', createdAt: NOW, updatedAt: NOW });
    expect(row?.secretHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(row)).not.toContain(result.secret);
    expect((await auth.verifyPassword(result.secret, row?.secretHash ?? '')).valid).toBe(true);
  });

  it('gives each registration a different secret', async () => {
    const { register } = setup();
    const first = await register({ domain: 'billing' });
    const second = await register({ domain: 'catalog' });

    expect(first.secret).not.toBe(second.secret);
  });

  it('refuses to overwrite an existing credential without rotate (AC 3)', async () => {
    const { register, services, revocations } = setup();
    const first = await register({ domain: 'billing' });
    const before = services.rows.get('billing');

    await expect(register({ domain: 'billing' })).rejects.toThrow(ServiceAlreadyRegisteredError);
    expect(services.rows.get('billing')).toEqual(before);
    expect((await auth.verifyPassword(first.secret, before?.secretHash ?? '')).valid).toBe(true);
    expect(revocations.revokedSubjects()).toEqual([]);
  });

  it('rotates: new secret, old one refused, tokens of service:<domain> revoked, new permissions (AC 3, AC 6)', async () => {
    const { register, services, revocations, clock } = setup();
    const first = await register({ domain: 'billing', dependencies: ['tenant'] });
    clock.advance(60_000);

    const rotated = await register({ domain: 'billing', dependencies: ['catalog'], permissions: ['invoice:write'], rotate: true });

    expect(rotated).toMatchObject({ domain: 'billing', rotated: true });
    expect(rotated.secret).not.toBe(first.secret);
    const row = services.rows.get('billing');
    expect(row).toMatchObject({ callees: ['catalog'], permissions: ['invoice:write'], updatedAt: clock.now(), createdAt: NOW });
    expect((await auth.verifyPassword(first.secret, row?.secretHash ?? '')).valid).toBe(false);
    expect((await auth.verifyPassword(rotated.secret, row?.secretHash ?? '')).valid).toBe(true);
    expect(revocations.revokedSubjects()).toEqual([{ subject: 'service:billing', at: clock.now() }]);
  });

  it('rotating a domain without a credential registers it (rotated: false)', async () => {
    const { register, services } = setup();

    expect(await register({ domain: 'billing', rotate: true })).toMatchObject({ rotated: false });
    expect(services.rows.has('billing')).toBe(true);
  });

  it('stores nothing for an invalid registration', async () => {
    const { register, services } = setup();

    await expect(register({ domain: 'billing', permissions: ['call:tenant'] })).rejects.toThrow(InvalidServiceRegistrationError);
    expect(services.rows.size).toBe(0);
  });
});

describe('issueServiceToken (AC 4, 5, 7)', () => {
  async function registered() {
    const context = setup();
    const { secret } = await context.register({ domain: 'billing', dependencies: ['tenant', 'catalog'], permissions: ['invoice:write'] });
    const dummyHash = await auth.hashPassword('dummy-secret');
    const issue = (serviceId: string, value: string) =>
      issueServiceToken({ services: context.services.store, auth, tokens: context.tokens, dummyHash }, { serviceId, secret: value });
    return { ...context, secret, issue };
  }

  it('issues a token with the given permissions plus call:<domain> of each dependency only', async () => {
    const { issue, secret, issued } = await registered();

    expect(await issue('billing', secret)).toEqual({ accessToken: 'token-for-billing', tokenType: 'Bearer', expiresIn: 300 });
    expect(issued).toEqual([{ domain: 'billing', permissions: ['invoice:write', 'call:catalog', 'call:tenant'] }]);
  });

  it('without --permission, the service has only its call: permissions (AC 6)', async () => {
    const context = setup();
    const { secret } = await context.register({ domain: 'catalog', dependencies: ['tenant'] });
    const dummyHash = await auth.hashPassword('dummy-secret');
    await issueServiceToken({ services: context.services.store, auth, tokens: context.tokens, dummyHash }, { serviceId: 'catalog', secret });

    expect(context.issued).toEqual([{ domain: 'catalog', permissions: ['call:tenant'] }]);
  });

  it('refuses an unknown service, a wrong secret and a revoked credential with the same error and one Argon2id each', async () => {
    const { issue, secret, services, issued } = await registered();
    const row = services.rows.get('billing');
    services.putRaw({ ...(row as NonNullable<typeof row>), domain: 'revoked-one', status: 'revoked' });
    const verify = vi.spyOn(auth, 'verifyPassword');

    const errors = await Promise.all(
      [issue('nobody', secret), issue('billing', 'wrong-secret'), issue('revoked-one', secret), issue('Not A Domain', secret)].map((call) =>
        call.then(() => undefined, (error: unknown) => error),
      ),
    );

    for (const error of errors) {
      expect(error).toBeInstanceOf(InvalidServiceCredentialsError);
      expect((error as Error).message).toBe('invalid service credentials');
    }
    expect(verify).toHaveBeenCalledTimes(4);
    expect(issued).toEqual([]);
    verify.mockRestore();
  });

  it('treats a corrupt row as unknown (fail closed) and reports it', async () => {
    const context = await registered();
    const row = context.services.rows.get('billing');
    context.services.putRaw({ ...(row as NonNullable<typeof row>), callees: ['Not_A_Domain'] });
    const reported: InvalidCredentialError[] = [];

    await expect(
      issueServiceToken(
        { services: context.services.store, auth, tokens: context.tokens, dummyHash: await auth.hashPassword('dummy'), onCorruptCredential: (error) => reported.push(error) },
        { serviceId: 'billing', secret: context.secret },
      ),
    ).rejects.toThrow(InvalidServiceCredentialsError);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(InvalidCredentialError);
  });
});
