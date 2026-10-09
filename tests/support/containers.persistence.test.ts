import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { selectedDatabase, startDatabase, type StartedDatabase } from './containers.js';

// Runs once per engine in the CI matrix (TECTON_TEST_DB). Proves the matrix wiring and
// that each engine starts, accepts SQL and exposes a connection URL for Prisma.
describe(`database container (${selectedDatabase()})`, () => {
  let database: StartedDatabase;

  beforeAll(async () => {
    database = await startDatabase();
  }, 180_000);

  afterAll(async () => {
    await database?.stop();
  });

  it('starts the engine selected by TECTON_TEST_DB and runs SQL', async () => {
    expect(database.kind).toBe(selectedDatabase());
    expect(await database.query('SELECT 1')).toBe('1');
  });

  it('exposes a connection URL with the engine scheme', () => {
    const scheme = { postgres: /^postgres(ql)?:\/\//, mariadb: /^mariadb:\/\//, mysql: /^mysql:\/\// }[database.kind];

    expect(database.url).toMatch(scheme);
  });
});
