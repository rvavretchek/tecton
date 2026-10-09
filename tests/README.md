# Tecton test framework

How tests are organized, run and written in the Tecton framework repository. The test
strategy behind it (risks, priorities, coverage) is in
`_bmad-output/test-artifacts/test-design-qa.md`.

## Setup

1. Node.js 24.7+ (24.x line) and pnpm 12 via Corepack: `corepack enable`, then `pnpm install`.
2. Docker, for container and persistence tests. Without a local Docker, point Testcontainers
   to a remote engine with `DOCKER_HOST` (see `.env.example`).
3. For browser E2E tests (Epic 4 onwards): `pnpm exec playwright install chromium`.

## Running tests

| Command | Runs | Needs |
|---|---|---|
| `pnpm test` | `*.test.ts` (unit and integration without Docker) | nothing |
| `pnpm test:containers` | `*.containers.test.ts` (Valkey, Toxiproxy...) | Docker |
| `pnpm test:persistence` | `*.persistence.test.ts` on the engine in `TECTON_TEST_DB` | Docker |
| `pnpm test:api` | Playwright `tests/api/*.spec.ts` | a running workspace at `BASE_URL` |
| `pnpm test:e2e` | Playwright `tests/e2e/*.spec.ts` (Chromium) | a running workspace + Chromium |
| `pnpm typecheck` | type-checks all test code | nothing |

Useful variants:

```bash
pnpm vitest run -t "@P0"                          # only P0 tests
pnpm vitest packages/manifest                     # watch mode for one package
TECTON_TEST_DB=mariadb pnpm test:persistence      # one engine locally
pnpm exec playwright test --project=e2e --headed  # watch the browser
pnpm exec playwright test --debug                 # step through with the inspector
pnpm exec playwright show-report test-results/playwright-report
```

## Layout

```text
packages/<name>/src/**/*.test.ts   unit/integration tests next to the code they test
tools/check-deps/                  test of the AD-3 dependency check
tests/support/                     shared fixtures, imported as `#test-support`
tests/api/                         Playwright multi-service API tests (through the Gateway)
tests/e2e/                         Playwright tests of the Directory /admin SPA
vitest.config.ts                   Vitest config and file-name conventions
playwright.config.ts               Playwright projects `api` and `e2e`
```

Tests never go to `dist/`: every package `tsconfig.json` excludes `*.test.ts`.

## Shared support (`#test-support`)

| Export | Purpose | Test Design link |
|---|---|---|
| `createTestClock()` | Controllable clock (`now`, `advance`, `set`) for every expiry; no real waiting | ASR-1, R-14 |
| `startDatabase()` | Ephemeral PostgreSQL / MariaDB / MySQL per `TECTON_TEST_DB`, with `url` for Prisma and `query()` | R-08 |
| `startValkey()` | Ephemeral Valkey 9.1 | — |
| `startFaultLab()` + `withDependencyDown()` | Toxiproxy between service and dependency; takes the dependency down inside a callback | ASR-2, R-09 |
| `assertNoSecretsLeaked()` | Fails when a password, Pepper, key or token shows up in captured output | P0-003 |
| `uniqueSuffix()`, `kebabName()`, `fakeEmail()` | Synthetic, collision-free data | — |

Planned additions, delivered by the stories that need them:

- `jwksTls` (self-signed TLS for JWKS in tests): Story 2.4 (ASR-4).
- `tokenFactory` (valid and forged tokens): Story 2.2 / 2.4.
- Relay and consumer crash seams: Stories 3.11 / 3.12 (ASR-3).
- `tectonStack()` (Auth + Directory + Gateway with registered keys): start of Epic 4 (ASR-5).
- Domain factories (credentials, tenants, users, manifests): with each entity's story.

## Writing tests

- **Priority tags in the title:** `@P0`, `@P1`, `@P2`, `@P3`, plus a type tag where useful
  (`@Security`, `@API`). Priority comes from the risk register, not from when a test runs.
- **Given/When/Then** in the test name or structure, matching the story's acceptance criteria.
- **Isolation:** every test creates its own data (own Tenant once the Directory exists);
  containers are per suite and discarded afterwards. No shared mutable state between tests.
- **No waiting for real time:** use the test clock for expiries. No `sleep`; poll a
  condition with a timeout when something is genuinely asynchronous.
- **Failure postures are tested, not assumed:** fail-closed and fail-open behaviors are
  checked with `withDependencyDown()`.
- **Secrets:** tests that handle passwords, keys or tokens assert the captured logs with
  `assertNoSecretsLeaked()`.
- **Selectors (E2E):** ARIA roles first; `data-testid` only where no semantic role exists.
- **Size:** keep a test under ~1.5 minutes and a file under ~500 lines.
- **Language:** test code, names and messages in English (Constitution §8).

## CI

GitHub Actions (`.github/workflows/ci.yml`):

- `build-test`: install, build, typecheck, `pnpm test`, `check:deps`.
- `persistence (postgres|mariadb|mysql)`: `pnpm test:persistence` with `TECTON_TEST_DB`
  set per job; required before merge.

Container, API and E2E jobs are wired by the CI setup workflow as those suites gain tests.

## Troubleshooting

- **"This test needs Docker"**: container and persistence tests found no Docker engine.
  Start Docker, or set `DOCKER_HOST` to a reachable engine. `pnpm test` never needs Docker.
- **`ERR_PNPM_UNSUPPORTED_ENGINE`**: the active Node is outside 24.7–24.x; switch with the
  version in `.node-version`.
- **API tests show "skipped"**: `BASE_URL` is not set; they need a running workspace.
- **`Executable doesn't exist` (Playwright)**: install the browser with
  `pnpm exec playwright install chromium`.
- **Slow first container run**: images are pulled once (`postgres:18-alpine`,
  `mariadb:11.8`, `mysql:8.4`, `valkey/valkey:9.1-alpine`, Toxiproxy 2.12).

## Knowledge base

The practices above follow the BMAD TEA knowledge base: `test-quality.md`,
`test-levels-framework.md`, `risk-governance.md`, `data-factories.md`,
`fixture-architecture.md` and `nfr-criteria.md`.
