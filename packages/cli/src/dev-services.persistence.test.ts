import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from './cli.js';
import { databaseName, isDevDatabase, type DevDatabase } from './dev-services.js';

// Story 1.11, AC 3: the generated docker-compose.dev.yml really brings up Valkey and one logical
// database per domain, also for domains generated later. Needs Docker; runs once per engine in
// the CI persistence matrix (TECTON_TEST_DB).
const engine: DevDatabase = isDevDatabase(process.env['TECTON_TEST_DB'] ?? '') ? (process.env['TECTON_TEST_DB'] as DevDatabase) : 'postgres';
const parent = mkdtempSync(join(tmpdir(), 'tecton-devsvc-'));
const name = `devsvc-${randomBytes(3).toString('hex')}`;
const root = join(parent, name);
const io = { cwd: parent, stdout: { write: () => undefined }, stderr: { write: () => undefined } };

/** Runs a fixed docker command (no user input) and returns status and output. */
function docker(command: string) {
  const result = spawnSync(`docker ${command}`, { cwd: root, encoding: 'utf8', shell: true, timeout: 300_000 });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

const compose = (command: string) => docker(`compose -f docker-compose.dev.yml ${command}`);

const LIST_DATABASE: Record<DevDatabase, (db: string) => string> = {
  postgres: (db) => `psql -U tecton -d tecton -tAc "SELECT datname FROM pg_database WHERE datname = '${db}'"`,
  mariadb: (db) => `mariadb -u root -ptecton -N -e "SHOW DATABASES LIKE '${db}'"`,
  mysql: (db) => `mysql -u root -ptecton -N -e "SHOW DATABASES LIKE '${db}'"`,
};

/** Polls until the logical database exists (database-init runs right after the server is healthy). */
async function waitForDatabase(db: string): Promise<boolean> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (compose(`exec -T database ${LIST_DATABASE[engine](db)}`).output.split(/\s+/).includes(db)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
  return false;
}

describe(`Dev Services with ${engine} (Story 1.11, AC 3)`, () => {
  beforeAll(async () => {
    if (docker('version --format "{{.Server.Version}}"').status !== 0) {
      throw new Error('This test needs Docker with the compose plugin. Start Docker, or point DOCKER_HOST to a reachable engine.');
    }
    expect(await run(['new', name, '--db', engine], io)).toBe(0);
    expect(await run(['generate', 'domain', 'finance'], { ...io, cwd: root })).toBe(0);
  }, 60_000);

  afterAll(() => {
    compose('down -v --remove-orphans');
    rmSync(parent, { recursive: true, force: true });
  }, 120_000);

  it('Given docker compose up, When it settles, Then Valkey answers and each domain has its database', async () => {
    const up = compose('up -d');
    expect(up.status, up.output).toBe(0);

    expect(await waitForDatabase(databaseName('finance'))).toBe(true);
    expect(compose('exec -T valkey valkey-cli ping').output).toBe('PONG');
  }, 300_000);

  it('Given a domain generated later, When compose is brought up again, Then its database is created too', async () => {
    expect(await run(['generate', 'domain', 'leave-requests'], { ...io, cwd: root })).toBe(0);
    const up = compose('up -d');
    expect(up.status, up.output).toBe(0);

    expect(await waitForDatabase(databaseName('leave-requests'))).toBe(true);
  }, 300_000);
});
