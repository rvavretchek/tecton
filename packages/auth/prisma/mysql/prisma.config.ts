// Prisma CLI configuration for this dialect (Prisma 7: the database URL lives here, not in the
// schema). The URL is only needed by commands that touch the database (migrate deploy, run by
// applyAuthMigrations); `prisma generate` works without it, so it is not required here.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: './schema.prisma',
  migrations: { path: './migrations' },
  datasource: { url: process.env['TECTON_AUTH_DATABASE_URL'] ?? '' },
});
