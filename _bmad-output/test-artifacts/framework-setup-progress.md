---
stepsCompleted: ['step-01-preflight', 'step-02-select-framework', 'step-03-scaffold-framework', 'step-04-docs-and-scripts', 'step-05-validate-and-summary']
lastStep: 'step-05-validate-and-summary'
lastSaved: '2026-10-09'
status: 'completed'
---

# Test Framework — Progresso (Tecton)

## Step 1 — Preflight

- Primeira tentativa (2026-10-08): parada por falta de `package.json`.
- Retomada (2026-10-09), depois da Story 1.1: `package.json` existe (monorepo pnpm, TypeScript 6.0.3, Vitest 5.0.3), sem framework de teste conflitante.
- **Stack:** `fullstack` (Node 24 + Fastify/Prisma/Valkey no backend; React 19 na SPA `/admin`, Epic 4). Sem bundler ainda (a ferramenta da SPA é decidida na Story 4.6).
- **Ambiente local:** Node 24.20.0, pnpm 12.10.1; **sem Docker**.

## Step 2 — Framework

- **Vitest 5** (já da Story 1.1): unit e integration, com convenção de nomes por necessidade de infraestrutura.
- **Playwright 1.64 + Playwright Utils 4.4**: projetos `api` (multi-serviço via Gateway, a partir do Epic 3) e `e2e` (SPA `/admin`, Chromium, a partir do Epic 4). Escolhido sobre Cypress por paralelismo, API + UI no mesmo runner e o que o Test Design previu.
- **Testcontainers 12.2 + Toxiproxy**: bancos, Valkey e injeção de falha (FR-31, ASR-2).
- Pact desligado (`tea_use_pactjs_utils: false`): o `test:contracts` do Tecton compara schemas (Story 5.7).

## Step 3 — Scaffold

- `tests/support/` (alias `#test-support`): `clock.ts` (ASR-1), `containers.ts` (`startDatabase` por `TECTON_TEST_DB`, `startValkey`, mensagem clara sem Docker), `network-faults.ts` (`startFaultLab`, `withDependencyDown`), `secrets.ts` (P0-003), `factories.ts` (faker).
- Testes dos próprios fixtures: `clock`, `secrets`, `factories` (unit, verdes); `containers.persistence.test.ts` (SELECT 1 no banco da matriz) e `network-faults.containers.test.ts` (Valkey atrás do Toxiproxy), que precisam de Docker.
- `playwright.config.ts` (timeouts 15/30/60 s, `BASE_URL`, trace/screenshot/video, HTML + JUnit + list, retries e workers no CI), `tests/api/health.api.spec.ts` (pulado sem `BASE_URL`), `tests/e2e/README.md`.
- Convenção: `*.test.ts` (sem Docker) → `pnpm test`; `*.containers.test.ts` → `pnpm test:containers`; `*.persistence.test.ts` → `pnpm test:persistence`.
- `pnpm-workspace.yaml`: `allowBuilds` nega os 4 scripts de instalação bloqueados pelo pnpm 12 (o postinstall do Playwright Utils roda `git submodule update` no repositório consumidor).
- `.env.example` (`TEST_ENV`, `TECTON_TEST_DB`, `BASE_URL`, `DOCKER_HOST`); `.gitignore` ganha `test-results/`.

## Step 4 — Docs e scripts

- `tests/README.md` (inglês): setup, comandos, layout, fixtures, boas práticas, CI, troubleshooting, base de conhecimento.
- Scripts: `test`, `test:containers`, `test:persistence`, `test:api`, `test:e2e`.
- README raiz (PT-BR): comandos novos e link para `tests/README.md`.

## Step 5 — Validação

Verde localmente: `pnpm typecheck`, `pnpm test` (4 arquivos, 13 testes), `pnpm check:deps`, `pnpm test:api` (1 pulado sem `BASE_URL`). `pnpm test:containers` falha com a mensagem de Docker esperada (sem Docker local).

**Desvios conscientes do checklist** (o checklist é voltado a app web; o Tecton é framework sem app até o Epic 3):

- Sem fixture Playwright com `mergeTests` nem exemplo E2E com `data-testid`: não há UI nem serviço ainda. Entram com `tectonStack()` (Epic 4) e a Story 4.7.
- Fábricas sem `cleanup()`: o isolamento é por container descartável por suíte e por Tenant próprio por teste.
- `jwksTls`, `tokenFactory`, costuras de queda e `tectonStack()` ficam para as stories que criam o que eles testam (lista em `tests/README.md`).

**Próximo:** `bmad-testarch-ci` para ligar `pnpm test:containers` no CI e preparar os jobs de API/E2E.
