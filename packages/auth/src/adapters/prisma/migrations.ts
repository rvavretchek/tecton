import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dialectOf, withScheme } from './dialect.js';

// src/adapters/prisma (tests) and dist/adapters/prisma (published) are both three levels below
// the package root, where prisma/<dialect>/ ships.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 4_000;
const URL_VARIABLE = 'TECTON_AUTH_DATABASE_URL';

/** The Prisma CLI of this package, found through its package.json "bin" field. */
function prismaCli(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('prisma/package.json');
  const bin = (JSON.parse(readFileSync(packageJson, 'utf8')) as { bin: { prisma: string } }).bin.prisma;
  return join(dirname(packageJson), bin);
}

// What the Prisma CLI needs from the environment: executable search path, home and temp
// directories, Windows system root, and proxy/CA settings for its engine download.
const PASSED_VARIABLES = new Set([
  'PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR',
  'APPDATA', 'LOCALAPPDATA', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS',
]);

/**
 * Environment of the migration child process: only what the Prisma CLI needs (plus PRISMA_*
 * settings) and the database URL. Never the Pepper, the bootstrap password or other secrets.
 */
export function migrationEnvironment(env: NodeJS.ProcessEnv, databaseUrl: string): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && (PASSED_VARIABLES.has(name) || name.startsWith('PRISMA_'))) child[name] = value;
  }
  child[URL_VARIABLE] = databaseUrl;
  return child;
}

/** Removes the URL and its password (raw, decoded and re-encoded) from `text`, and caps its size. */
export function redactDatabaseUrl(text: string, urls: readonly string[]): string {
  const secrets = new Set<string>();
  for (const url of urls) {
    secrets.add(url);
    try {
      const password = new URL(url).password;
      if (password !== '') {
        secrets.add(password);
        const decoded = decodeURIComponent(password);
        secrets.add(decoded);
        secrets.add(encodeURIComponent(decoded));
      }
    } catch {
      // Not a URL: the raw string is still redacted.
    }
  }
  let redacted = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret !== '') redacted = redacted.split(secret).join('<redacted>');
  }
  return redacted.length > MAX_OUTPUT_CHARS ? `...${redacted.slice(-MAX_OUTPUT_CHARS)}` : redacted;
}

export interface ApplyAuthMigrationsOptions {
  databaseUrl: string;
  /** Kills the migration after this long. Default 120 s. */
  timeoutMs?: number;
}

/**
 * Applies the pending migrations of the Auth database (prisma migrate deploy) for the dialect of
 * `databaseUrl`. The URL goes only to the child process environment and never into errors.
 * Story 6.1 (`tecton-admin migrate`) runs this for every service.
 */
export async function applyAuthMigrations({ databaseUrl, timeoutMs = DEFAULT_TIMEOUT_MS }: ApplyAuthMigrationsOptions): Promise<void> {
  const dialect = dialectOf(databaseUrl);
  const config = join(PACKAGE_ROOT, 'prisma', dialect, 'prisma.config.ts');
  // The migration engine only accepts mysql:// for MySQL and MariaDB (the runtime driver is the
  // opposite: it only accepts mariadb://, see prisma-credential-store.ts).
  const engineUrl = dialect === 'mysql' ? withScheme(databaseUrl, 'mysql:') : databaseUrl.trim();
  const output: string[] = [];
  const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli(), 'migrate', 'deploy', '--config', config], {
      cwd: PACKAGE_ROOT,
      env: migrationEnvironment(process.env, engineUrl),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    child.on('error', reject);
    child.on('close', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
  });
  if (code !== 0) {
    const how = signal ? `was stopped by ${signal}${signal === 'SIGKILL' ? ` (timeout of ${timeoutMs} ms?)` : ''}` : `exited with ${code}`;
    const text = redactDatabaseUrl(output.join(''), [engineUrl, databaseUrl]);
    throw new Error(`Auth database migrations failed (prisma migrate deploy ${how}):\n${text}`);
  }
}
