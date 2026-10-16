import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dialectOf } from './dialect.js';

// src/adapters/prisma (tests) and dist/adapters/prisma (published) are both three levels below
// the package root, where prisma/<dialect>/ ships.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The Prisma CLI of this package, found through its package.json "bin" field. */
function prismaCli(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('prisma/package.json');
  const bin = (JSON.parse(readFileSync(packageJson, 'utf8')) as { bin: { prisma: string } }).bin.prisma;
  return join(dirname(packageJson), bin);
}

export interface ApplyAuthMigrationsOptions {
  databaseUrl: string;
}

/**
 * Applies the pending migrations of the Auth database (prisma migrate deploy) for the dialect of
 * `databaseUrl`. The URL goes only to the child process environment and never into errors.
 * Story 6.1 (`tecton-admin migrate`) runs this for every service.
 */
export async function applyAuthMigrations({ databaseUrl }: ApplyAuthMigrationsOptions): Promise<void> {
  const config = join(PACKAGE_ROOT, 'prisma', dialectOf(databaseUrl), 'prisma.config.ts');
  // The migration engine only accepts mysql:// for MySQL and MariaDB (the runtime driver is the
  // opposite: it only accepts mariadb://, see prisma-credential-store.ts).
  const engineUrl = databaseUrl.startsWith('mariadb:') ? `mysql:${databaseUrl.slice('mariadb:'.length)}` : databaseUrl;
  const output: string[] = [];
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli(), 'migrate', 'deploy', '--config', config], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, TECTON_AUTH_DATABASE_URL: engineUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (code !== 0) {
    const text = output.join('').split(engineUrl).join('<TECTON_AUTH_DATABASE_URL>').split(databaseUrl).join('<TECTON_AUTH_DATABASE_URL>');
    throw new Error(`Auth database migrations failed (prisma migrate deploy exited with ${code}):\n${text}`);
  }
}
