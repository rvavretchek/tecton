# E2E tests (Playwright, Chromium)

Tests for the Directory `/admin` SPA. They start in Epic 4 (Stories 4.7 to 4.12).

- File names: `*.spec.ts` in this folder.
- Selectors: ARIA roles first (`getByRole('tree')`, `getByRole('treeitem', { name })`), then
  `data-testid` only where there is no semantic role (`tree-skeleton`, `detail-skeleton`,
  `detail-panel`, `form-error-summary`, `search-results-count`).
- Accessibility: every screen state is checked with axe (WCAG 2.2 AA).
- Install the browser once with `pnpm exec playwright install chromium`.
