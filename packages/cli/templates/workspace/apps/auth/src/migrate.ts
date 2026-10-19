// Applies the pending migrations of the Auth database (TECTON_AUTH_DATABASE_URL).
// `tecton-admin migrate` (Story 6.1) will run this for every service of the workspace.
import { applyAuthMigrations } from '@tecton/auth';

const databaseUrl = process.env['TECTON_AUTH_DATABASE_URL'];
if (!databaseUrl) {
  console.error('TECTON_AUTH_DATABASE_URL is not set; point it to the Auth database');
  process.exit(1);
}
await applyAuthMigrations({ databaseUrl });
console.log('Auth database migrations applied');
