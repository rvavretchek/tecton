import { MariaDbContainer } from '@testcontainers/mariadb';
import { MySqlContainer } from '@testcontainers/mysql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedNetwork, type StartedTestContainer } from 'testcontainers';

/**
 * Ephemeral databases and Valkey for integration tests (FR-31, Test Design R-08).
 *
 * Persistence tests (`*.persistence.test.ts`) call `startDatabase()` without arguments:
 * the engine comes from TECTON_TEST_DB, so the same test runs on PostgreSQL locally and
 * on all three engines in the CI matrix. Containers are discarded after each run.
 */

export const TEST_DATABASES = ['postgres', 'mariadb', 'mysql'] as const;
export type TestDatabase = (typeof TEST_DATABASES)[number];

export const IMAGES = {
  postgres: 'postgres:18-alpine',
  mariadb: 'mariadb:11.8',
  mysql: 'mysql:8.4',
  valkey: 'valkey/valkey:9.1-alpine',
  toxiproxy: 'ghcr.io/shopify/toxiproxy:2.12.0',
} as const;

export function selectedDatabase(env: NodeJS.ProcessEnv = process.env): TestDatabase {
  const value = env['TECTON_TEST_DB'] ?? 'postgres';
  if (!(TEST_DATABASES as readonly string[]).includes(value)) {
    throw new Error(`TECTON_TEST_DB must be one of ${TEST_DATABASES.join(', ')}; got "${value}"`);
  }
  return value as TestDatabase;
}

export interface StartedDatabase {
  kind: TestDatabase;
  /** Connection URL in the form Prisma expects for the engine. */
  url: string;
  container: StartedTestContainer;
  /** Runs SQL through the engine's own CLI inside the container and returns stdout. */
  query(sql: string): Promise<string>;
  stop(): Promise<void>;
}

/** Rethrows the Testcontainers "no container runtime" failure with an actionable message. */
async function withDockerCheck<T>(start: () => Promise<T>): Promise<T> {
  try {
    return await start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/container runtime|docker/i.test(message)) {
      throw new Error(
        'This test needs Docker (Testcontainers found no container runtime). ' +
          'Start Docker locally, or point DOCKER_HOST to a reachable Docker engine.',
        { cause: error },
      );
    }
    throw error;
  }
}

/** Runs a command in the container and returns stdout only (CLI warnings go to stderr). */
async function exec(
  container: StartedTestContainer,
  command: string[],
  env: Record<string, string> = {},
): Promise<string> {
  const result = await container.exec(command, { env });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed in container (exit ${result.exitCode}): ${result.stderr || result.output}`);
  }
  return result.stdout.trim();
}

export async function startDatabase(kind: TestDatabase = selectedDatabase()): Promise<StartedDatabase> {
  return withDockerCheck(async () => {
    switch (kind) {
      case 'postgres': {
        const container = await new PostgreSqlContainer(IMAGES.postgres).start();
        return {
          kind,
          url: container.getConnectionUri(),
          container,
          query: (sql) =>
            exec(container, ['psql', '-U', container.getUsername(), '-d', container.getDatabase(), '-tAc', sql]),
          stop: async () => {
            await container.stop();
          },
        };
      }
      case 'mariadb': {
        const container = await new MariaDbContainer(IMAGES.mariadb).start();
        return {
          kind,
          url: container.getConnectionUri(),
          container,
          // Password through MYSQL_PWD, never on the command line.
          query: (sql) =>
            exec(container, ['mariadb', '-u', container.getUsername(), '-N', '-e', sql, container.getDatabase()], {
              MYSQL_PWD: container.getUserPassword(),
            }),
          stop: async () => {
            await container.stop();
          },
        };
      }
      case 'mysql': {
        const container = await new MySqlContainer(IMAGES.mysql).start();
        return {
          kind,
          url: container.getConnectionUri(),
          container,
          query: (sql) =>
            exec(container, ['mysql', '-u', container.getUsername(), '-N', '-e', sql, container.getDatabase()], {
              MYSQL_PWD: container.getUserPassword(),
            }),
          stop: async () => {
            await container.stop();
          },
        };
      }
    }
  });
}

export interface StartedValkey {
  container: StartedTestContainer;
  host: string;
  port: number;
  /** Alias reachable from other containers on `network` (when one was given). */
  networkAlias: string;
  stop(): Promise<void>;
}

export async function startValkey(network?: StartedNetwork): Promise<StartedValkey> {
  return withDockerCheck(async () => {
    const networkAlias = 'valkey';
    let builder = new GenericContainer(IMAGES.valkey)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/));
    if (network) builder = builder.withNetwork(network).withNetworkAliases(networkAlias);
    const container = await builder.start();
    return {
      container,
      host: container.getHost(),
      port: container.getMappedPort(6379),
      networkAlias,
      stop: async () => {
        await container.stop();
      },
    };
  });
}

export { withDockerCheck };
