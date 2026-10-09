import { defineConfig } from 'vitest/config';

// Single root config for now. Per-package projects come in when a package needs a
// different environment (e.g. jsdom for @tecton/ui).
//
// Persistence tests are named `*.persistence.test.ts`. `pnpm test` excludes them and
// `pnpm test:persistence` runs only them, against the database chosen by
// TECTON_TEST_DB (postgres | mariadb | mysql; default postgres).
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tools/**/fixtures/**'],
  },
});
