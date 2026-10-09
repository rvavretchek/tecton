import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Single root config for now. Per-package projects come in when a package needs a
// different environment (e.g. jsdom for @tecton/ui).
//
// File-name conventions (see tests/README.md):
//   *.test.ts             - unit/integration without Docker      -> pnpm test
//   *.containers.test.ts  - needs Docker (Valkey, Toxiproxy...)   -> pnpm test:containers
//   *.persistence.test.ts - needs a database, engine from TECTON_TEST_DB
//                           (postgres | mariadb | mysql; default postgres) -> pnpm test:persistence
export default defineConfig({
  resolve: {
    alias: {
      '#test-support': fileURLToPath(new URL('./tests/support/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tools/**/*.test.ts', 'tests/support/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tools/**/fixtures/**'],
    hookTimeout: 180_000,
  },
});
