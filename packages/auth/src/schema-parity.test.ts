import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const prismaDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma');

/** Models with their fields, types and attributes, ignoring native `@db.*` types and comments. */
function models(dialect: string): Record<string, string[]> {
  const source = readFileSync(join(prismaDir, dialect, 'schema.prisma'), 'utf8');
  const result: Record<string, string[]> = {};
  for (const match of source.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g)) {
    const [, name = '', body = ''] = match;
    result[name] = body
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, '').replace(/@db\.\w+(\([^)]*\))?/g, '').trim().split(/\s+/).join(' '))
      .filter((line) => line !== '');
  }
  return result;
}

// Story 2.2a: one schema per dialect; they must never drift apart.
describe('Prisma schema parity', () => {
  it('declares the same models, fields, types and attributes in PostgreSQL and MySQL', () => {
    const postgresql = models('postgresql');

    expect(Object.keys(postgresql)).toEqual(['Credential', 'RefreshFamily', 'RefreshToken']);
    expect(models('mysql')).toEqual(postgresql);
  });

  it('applies a binary collation to the login column in the MySQL migration', () => {
    const sql = readFileSync(join(prismaDir, 'mysql', 'migrations', '0001_init', 'migration.sql'), 'utf8');

    expect(sql).toMatch(/`login` VARCHAR\(320\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/);
  });

  it('ships the same migrations for both dialects, none creating a PostgreSQL schema (least privilege)', () => {
    const names = (dialect: string) =>
      readdirSync(join(prismaDir, dialect, 'migrations'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

    expect(names('postgresql')).toEqual(['0001_init', '0002_refresh_tokens']);
    expect(names('mysql')).toEqual(names('postgresql'));
    for (const name of names('postgresql')) {
      const sql = readFileSync(join(prismaDir, 'postgresql', 'migrations', name, 'migration.sql'), 'utf8');
      expect(sql.replace(/^--.*$/gm, ''), name).not.toMatch(/CREATE SCHEMA/i);
    }
  });
});
