import { createArgon2idAuthProvider, RevocationStoreUnavailableError } from '@tecton/providers';
import { createMemoryTokenRevocationStore, createTestClock, selectedDatabase, startDatabase, type StartedDatabase } from '#test-support';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvalidCredentialError } from '../../core/credential.js';
import {
  InvalidServiceCredentialsError,
  issueServiceToken,
  registerService,
  ServiceAlreadyRegisteredError,
  type ServiceCredential,
  type ServiceCredentialStore,
  type ServiceTokenIssuer,
} from '../../core/service-credential.js';
import { createAuthPrismaClient, type AuthPrismaClient } from './client.js';
import { applyAuthMigrations } from './migrations.js';
import { createPrismaServiceCredentialStore } from './prisma-service-credential-store.js';

const auth = createArgon2idAuthProvider({
  peppers: [{ id: '1', key: Buffer.from('service-persistence-pepper-32-byte', 'utf8') }],
  currentPepperId: '1',
});
const AT = new Date('2026-10-23T12:34:56.789Z');
const HASH = '$argon2id$v=19$m=19456,t=2,p=1,keyid=MQ$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

function credentialOf(domain: string, overrides: Partial<ServiceCredential> = {}): ServiceCredential {
  return { id: uuidv7(), domain, secretHash: HASH, permissions: ['invoice:write'], callees: ['tenant'], status: 'active', createdAt: AT, updatedAt: AT, ...overrides };
}

// Story 2.7a, AC 1, 3, 4: runs once per engine in the CI matrix (TECTON_TEST_DB).
describe(`Service credential store on ${selectedDatabase()} (Story 2.7a)`, () => {
  let database: StartedDatabase;
  let client: AuthPrismaClient;
  let store: ServiceCredentialStore;

  beforeAll(async () => {
    database = await startDatabase();
    await applyAuthMigrations({ databaseUrl: database.url });
    client = createAuthPrismaClient(database.url);
    store = createPrismaServiceCredentialStore({ client });
  }, 240_000);

  afterAll(async () => {
    await client?.close();
    await database?.stop();
  });

  it('registers and finds a credential, with its lists and millisecond timestamps', async () => {
    const credential = credentialOf('billing', { callees: ['catalog', 'tenant'], permissions: [] });
    await store.register(credential);

    expect(await store.findByDomain('billing')).toEqual(credential);
    expect(await store.findByDomain('nobody')).toBeUndefined();
  });

  it('keeps the domain unique: a second register fails with ServiceAlreadyRegisteredError', async () => {
    await store.register(credentialOf('unique-one'));

    await expect(store.register(credentialOf('unique-one'))).rejects.toThrow(ServiceAlreadyRegisteredError);
  });

  it('replaces atomically, keeping the id and createdAt; false for an unknown domain', async () => {
    const original = credentialOf('replaced');
    await store.register(original);
    const later = new Date(AT.getTime() + 60_000);

    expect(await store.replace(credentialOf('replaced', { secretHash: `${HASH}x`, permissions: ['tenant:read'], callees: [], updatedAt: later }))).toBe(true);
    expect(await store.findByDomain('replaced')).toEqual({ ...original, secretHash: `${HASH}x`, permissions: ['tenant:read'], callees: [], updatedAt: later });
    expect(await store.replace(credentialOf('never-registered'))).toBe(false);
    expect(await store.findByDomain('never-registered')).toBeUndefined();
  });

  it('re-hashes only while the stored hash is the expected one, keeping updatedAt', async () => {
    const original = credentialOf('rehashed');
    await store.register(original);

    expect(await store.updateSecretHash('rehashed', `${HASH}y`, `${HASH}-not-current`)).toBe(false);
    expect(await store.updateSecretHash('rehashed', `${HASH}y`, HASH)).toBe(true);
    expect(await store.findByDomain('rehashed')).toEqual({ ...original, secretHash: `${HASH}y` });
    expect(await store.updateSecretHash('never-registered', `${HASH}y`, HASH)).toBe(false);
  });

  it('refuses to write an invalid credential', async () => {
    await expect(store.register(credentialOf('bad-status', { status: 'paused' as ServiceCredential['status'] }))).rejects.toThrow(InvalidCredentialError);
    expect(await store.findByDomain('bad-status')).toBeUndefined();
  });

  it('refuses a corrupt row read back (fail closed)', async () => {
    await store.register(credentialOf('corrupted'));
    const rows = client.delegates.serviceCredential as { updateMany(args: { where: { domain: string }; data: { callees: unknown } }): Promise<unknown> };
    await rows.updateMany({ where: { domain: 'corrupted' }, data: { callees: ['Not_A_Domain'] } });

    await expect(store.findByDomain('corrupted')).rejects.toThrow(InvalidCredentialError);
  });

  it('registers, issues, rotates and refuses the old secret end to end', async () => {
    const clock = createTestClock(AT);
    const revocations = createMemoryTokenRevocationStore(() => new RevocationStoreUnavailableError('down'), () => clock.now());
    const issued: Array<readonly string[]> = [];
    const tokens: ServiceTokenIssuer = {
      async issue({ permissions }) {
        issued.push(permissions);
        return { accessToken: 'token', tokenType: 'Bearer', expiresIn: 300 };
      },
    };
    const dependencies = { services: store, auth, revocations, clock };
    const dummyHash = await auth.hashPassword('dummy');
    const issue = (secret: string) => issueServiceToken({ services: store, auth, tokens, dummyHash }, { serviceId: 'end-to-end', secret });

    const first = await registerService(dependencies, { domain: 'end-to-end', dependencies: ['tenant'], permissions: [], rotate: false });
    await issue(first.secret);
    clock.advance(1000);
    const second = await registerService(dependencies, { domain: 'end-to-end', dependencies: ['catalog'], permissions: ['invoice:write'], rotate: true });

    await expect(issue(first.secret)).rejects.toThrow(InvalidServiceCredentialsError);
    await issue(second.secret);
    expect(issued).toEqual([['call:tenant'], ['invoice:write', 'call:catalog']]);
    expect(revocations.revokedSubjects()).toEqual([{ subject: 'service:end-to-end', at: new Date(clock.now().getTime() + 1000) }]);
  });
});
