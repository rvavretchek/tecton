import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMAIN_NAME_PATTERN, parseManifest } from '@tecton/manifest';
import { CliError, readJsonFile, safeWorkspaceName } from './workspace.js';

export const DEV_DATABASES = ['postgres', 'mariadb', 'mysql'] as const;
export type DevDatabase = (typeof DEV_DATABASES)[number];

export const COMPOSE_FILE = 'docker-compose.dev.yml';
export const DATABASES_SQL = 'dev-services/databases.sql';
export const ENV_EXAMPLE = '.env.example';

const USER = 'tecton';
const PASSWORD = 'tecton';

interface Engine {
  image: string;
  port: number;
  /** Prisma connection URL scheme (MariaDB uses the mysql provider). */
  scheme: string;
  environment: Record<string, string>;
  volumePath: string;
  healthcheck: string[];
  /** Command of the one-shot database-init service, run against the `database` service. */
  initCommand: string[];
  initEnvironment: Record<string, string>;
  createDatabase: (name: string) => string;
}

const ENGINES: Record<DevDatabase, Engine> = {
  postgres: {
    image: 'postgres:18-alpine',
    port: 5432,
    scheme: 'postgresql',
    environment: { POSTGRES_USER: USER, POSTGRES_PASSWORD: PASSWORD, POSTGRES_DB: USER },
    // PostgreSQL 18 keeps its data under /var/lib/postgresql/18/docker; mount the parent.
    volumePath: '/var/lib/postgresql',
    healthcheck: ['CMD-SHELL', `pg_isready -U ${USER} -d ${USER}`],
    initCommand: ['psql', '-v', 'ON_ERROR_STOP=1', '-h', 'database', '-U', USER, '-d', USER, '-f', '/dev-services/databases.sql'],
    initEnvironment: { PGPASSWORD: PASSWORD },
    // Quoted identifier: domains like "user", "group" or "order" are reserved words in PostgreSQL.
    createDatabase: (name) => `SELECT 'CREATE DATABASE "${name}"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${name}')\\gexec`,
  },
  mariadb: {
    image: 'mariadb:11.8',
    port: 3306,
    scheme: 'mysql',
    environment: { MARIADB_ROOT_PASSWORD: PASSWORD, MARIADB_USER: USER, MARIADB_PASSWORD: PASSWORD },
    volumePath: '/var/lib/mysql',
    healthcheck: ['CMD', 'healthcheck.sh', '--connect', '--innodb_initialized'],
    initCommand: ['sh', '-c', 'mariadb -h database -u root < /dev-services/databases.sql'],
    initEnvironment: { MYSQL_PWD: PASSWORD },
    createDatabase: (name) => `CREATE DATABASE IF NOT EXISTS \`${name}\`;\nGRANT ALL PRIVILEGES ON \`${name}\`.* TO '${USER}'@'%';`,
  },
  mysql: {
    image: 'mysql:8.4',
    port: 3306,
    scheme: 'mysql',
    environment: { MYSQL_ROOT_PASSWORD: PASSWORD, MYSQL_USER: USER, MYSQL_PASSWORD: PASSWORD },
    volumePath: '/var/lib/mysql',
    healthcheck: ['CMD-SHELL', `mysqladmin ping -h 127.0.0.1 -u root -p${PASSWORD}`],
    // MYSQL_PWD is deprecated in the MySQL client; dev-only password on the command line.
    initCommand: ['sh', '-c', `mysql -h database -u root -p${PASSWORD} < /dev-services/databases.sql`],
    initEnvironment: {},
    createDatabase: (name) => `CREATE DATABASE IF NOT EXISTS \`${name}\`;\nGRANT ALL PRIVILEGES ON \`${name}\`.* TO '${USER}'@'%';`,
  },
};

/**
 * Database names a domain must not take: system databases of the three engines and the
 * Dev Services admin database. In MySQL/MariaDB the GRANT on `mysql` would give the dev user
 * control of the server's own tables.
 */
export const RESERVED_DATABASE_NAMES: readonly string[] = [
  USER,
  'postgres',
  'template0',
  'template1',
  'mysql',
  'sys',
  'information_schema',
  'performance_schema',
];

export function isDevDatabase(value: string): value is DevDatabase {
  return (DEV_DATABASES as readonly string[]).includes(value);
}

/** Logical database of a domain: SQL-safe version of its kebab-case name. */
export function databaseName(domain: string): string {
  return domain.replaceAll('-', '_');
}

function envName(domain: string): string {
  return `TECTON_${domain.replaceAll('-', '_').toUpperCase()}_DATABASE_URL`;
}

const yamlList = (items: readonly string[]) => `[${items.map((item) => JSON.stringify(item)).join(', ')}]`;
const yamlMap = (entries: Record<string, string>, indent: string) =>
  Object.entries(entries)
    .map(([key, value]) => `${indent}${key}: ${JSON.stringify(value)}`)
    .join('\n');

const DOMAIN_NAME = new RegExp(DOMAIN_NAME_PATTERN);

/**
 * Domains of the workspace: every apps/domains/<name>/tecton.yaml. The folder name becomes a
 * database name and an environment variable, so it must be a valid domain name, must not be
 * reserved, and must match the `domain` its manifest declares.
 */
function workspaceDomains(root: string): string[] {
  const dir = join(root, 'apps', 'domains');
  if (!existsSync(dir)) return [];
  const domains = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'tecton.yaml')))
    .map((entry) => entry.name)
    .sort();
  for (const domain of domains) {
    if (!DOMAIN_NAME.test(domain)) throw new CliError(`apps/domains/${domain} is not a valid domain name (kebab-case)`);
    if (RESERVED_DATABASE_NAMES.includes(databaseName(domain))) {
      throw new CliError(`apps/domains/${domain}: "${databaseName(domain)}" is a reserved database name; rename the domain`);
    }
    const parsed = parseManifest(readFileSync(join(dir, domain, 'tecton.yaml'), 'utf8'));
    if (parsed.ok && parsed.manifest.domain !== domain) {
      throw new CliError(
        `apps/domains/${domain}/tecton.yaml declares domain "${parsed.manifest.domain}"; the folder must have the same name`,
      );
    }
  }
  return domains;
}

/** Database engine chosen for Dev Services, from package.json "tecton.devServices.database". */
export function workspaceDatabase(root: string): DevDatabase {
  const pkg = readJsonFile<{ tecton?: { devServices?: { database?: string } } }>(join(root, 'package.json'));
  const value = pkg.tecton?.devServices?.database ?? 'postgres';
  if (!isDevDatabase(value)) {
    throw new CliError(`package.json "tecton.devServices.database" is "${value}"; use one of: ${DEV_DATABASES.join(', ')}`);
  }
  return value;
}

export function composeFile(workspace: string, database: DevDatabase): string {
  const engine = ENGINES[database];
  return `# Tecton Dev Services: FOR LOCAL DEVELOPMENT ONLY, NEVER FOR PRODUCTION.
# Fixed credentials (${USER}/${PASSWORD}), no TLS, no backups. Ports are published on
# 127.0.0.1 only; reach them from another machine through an SSH tunnel, not by exposing them.
# Generated by tecton-admin and regenerated when domains are added: do not edit by hand.
# Start: docker compose -f ${COMPOSE_FILE} up -d   (database-init creates missing domain databases)
name: ${workspace}-dev

services:
  valkey:
    image: valkey/valkey:9.1-alpine
    ports: ["127.0.0.1:6379:6379"]
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 2s
      timeout: 3s
      retries: 30

  database:
    image: ${engine.image}
    environment:
${yamlMap(engine.environment, '      ')}
    ports: ["127.0.0.1:${engine.port}:${engine.port}"]
    volumes:
      - database:${engine.volumePath}
    healthcheck:
      test: ${yamlList(engine.healthcheck)}
      interval: 2s
      timeout: 5s
      retries: 60

  # One-shot: creates every domain database that does not exist yet, on every "up".
  database-init:
    image: ${engine.image}
    depends_on:
      database:
        condition: service_healthy
${Object.keys(engine.initEnvironment).length > 0 ? `    environment:\n${yamlMap(engine.initEnvironment, '      ')}\n` : ''}    volumes:
      - ./dev-services:/dev-services:ro
    command: ${yamlList(engine.initCommand)}
    restart: "no"

volumes:
  database: {}
`;
}

export function databasesSql(database: DevDatabase, domains: readonly string[]): string {
  const engine = ENGINES[database];
  const statements = domains.map((domain) => `-- ${domain}\n${engine.createDatabase(databaseName(domain))}`);
  return [
    '-- Generated by tecton-admin (Dev Services). Idempotent: runs on every "docker compose up".',
    '-- One logical database per domain; do not edit by hand.',
    ...(statements.length > 0 ? statements : ['-- No domains yet.', 'SELECT 1;']),
    '',
  ].join('\n');
}

export function envExample(database: DevDatabase, domains: readonly string[]): string {
  const engine = ENGINES[database];
  return [
    '# Generated by tecton-admin for Dev Services (docker-compose.dev.yml). Do not edit by hand:',
    '# copy to .env (ignored by Git) and change values there.',
    'TECTON_VALKEY_URL=redis://localhost:6379',
    ...domains.map((domain) => `${envName(domain)}=${engine.scheme}://${USER}:${PASSWORD}@localhost:${engine.port}/${databaseName(domain)}`),
    '',
  ].join('\n');
}

/** (Re)generates docker-compose.dev.yml, dev-services/databases.sql and .env.example for a workspace. */
export function writeDevServices(root: string): void {
  const pkg = readJsonFile<{ name?: string }>(join(root, 'package.json'));
  const database = workspaceDatabase(root);
  const domains = workspaceDomains(root);
  writeFileSync(join(root, COMPOSE_FILE), composeFile(safeWorkspaceName(pkg.name), database));
  mkdirSync(join(root, 'dev-services'), { recursive: true });
  writeFileSync(join(root, DATABASES_SQL), databasesSql(database, domains));
  writeFileSync(join(root, ENV_EXAMPLE), envExample(database, domains));
}

/** Records the Dev Services database choice in the workspace package.json. */
export function setWorkspaceDatabase(root: string, database: DevDatabase): void {
  const file = join(root, 'package.json');
  const pkg = readJsonFile<Record<string, unknown>>(file);
  pkg['tecton'] = { devServices: { database } };
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
