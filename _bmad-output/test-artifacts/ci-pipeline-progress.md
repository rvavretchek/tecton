---
stepsCompleted: ['step-01-preflight', 'step-02-generate-pipeline', 'step-03-configure-quality-gates', 'step-04-validate-and-summary']
lastStep: 'step-04-validate-and-summary'
lastSaved: '2026-10-09'
---

# CI Setup — Progresso (Tecton)

## Step 1 — Preflight

- Git com remoto `github.com/rvavretchek/tecton`; plataforma `github-actions` (workflow já existia, da Story 1.1).
- Stack `fullstack`; framework Vitest + Playwright (Test Framework de 2026-10-09). `pnpm test` verde localmente.
- Decisão: **atualizar** o `ci.yml` existente em vez de criar `test.yml`, para manter um único workflow de PR e nomes de job estáveis para a proteção de branch.

## Step 2 — Pipeline

- `ci.yml` (push e PR, alvo < 15 min): `build-test` (install, build, typecheck, check:deps, test), `containers` (novo: `test:containers`), `persistence (postgres|mariadb|mysql)`. Timeout de 15 min por job, cache do pnpm, upload de `test-results/` em falha (actions/upload-artifact v7).
- `nightly.yml` (06:00 UTC + manual): `burn-in` e `playwright (api|e2e)`, este dormente até a variável `PLAYWRIGHT_ENABLED=true`.
- Vitest grava JUnit em `test-results/vitest-junit.xml` quando `CI` está definido.
- Sem lint dedicado: não há linter configurado; `typecheck` e `check:deps` são os gates estáticos. Sem sharding: a suíte ainda é pequena (revisitar quando o PR passar de ~10 min).
- Input do `workflow_dispatch` (`iterations`) passa por `env:` e é validado como número (sem injeção).

## Step 3 — Quality gates

- Burn-in: 5 iterações, ordem embaralhada (`--sequence.shuffle`), em todas as suítes Vitest; no nightly, não no PR (a suíte ainda não tem UI).
- Gates do Test Design: P0 100%, P1 ≥ 95%, riscos de score 6 mitigados antes de fechar o épico. Checks obrigatórios recomendados: `build-test`, `containers`, os três `persistence (...)`.
- Notificações: o e-mail padrão do GitHub Actions em falha de workflow. Sem Slack (projeto solo).
- Contract testing (Pact): não se aplica (`tea_use_pactjs_utils: false`).

## Step 4 — Validação

- YAML dos dois workflows válido; `pnpm typecheck` e `pnpm test` verdes localmente.
- Correção incluída: o helper de banco usava `executeQuery` do MySQL, que mistura o aviso de senha (stderr) na saída; falhou no CI (`persistence (mysql)`). Agora lê só stdout e passa a senha por `MYSQL_PWD`, sem expô-la na linha de comando (MariaDB e MySQL).
- **Para o Boss:** marcar `build-test`, `containers` e `persistence (postgres|mariadb|mysql)` como required status checks; quando o Epic 3 tiver o workspace rodando, definir `PLAYWRIGHT_ENABLED=true`.
