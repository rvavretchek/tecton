import { defineConfig, devices } from '@playwright/test';

// Playwright covers what crosses service boundaries:
//   - `api`: multi-service API tests through the Gateway (Epic 3 onwards), no browser.
//   - `e2e`: the Directory /admin SPA (Epic 4 onwards), Chromium.
// Unit and integration tests stay in Vitest (see vitest.config.ts).
const baseURL = process.env['BASE_URL'] ?? 'http://localhost:3000';
const isCI = Boolean(process.env['CI']);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  ...(isCI ? { workers: 4 } : {}),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/playwright-junit.xml' }],
  ],
  outputDir: 'test-results/playwright-artifacts',
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure-and-retries',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'api', testMatch: /tests[\\/]api[\\/].*\.spec\.ts$/ },
    { name: 'e2e', testMatch: /tests[\\/]e2e[\\/].*\.spec\.ts$/, use: { ...devices['Desktop Chrome'] } },
  ],
});
