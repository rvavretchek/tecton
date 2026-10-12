---
baseline_commit: ca1f3e56cb401b6c6e3e9b9d6ff2a139ae2d2b5f
---

# Story 1.1: Scaffold do monorepo do framework

Status: review

<!-- Validação opcional: rodar a validação do create-story (checklist.md) antes do dev-story. -->

## Story

Como **contribuidor do framework (humano ou agente de IA)**,
quero um monorepo pnpm com os 8 pacotes e a direção de dependência verificada automaticamente,
para que cada story seguinte tenha onde nascer sem violar o AD-3.

## Acceptance Criteria

1. **Build dos 8 pacotes.** Dado um clone limpo do repositório, quando eu rodo `pnpm install` e `pnpm build`, então os pacotes `@tecton/{manifest,core,providers,auth,directory,service-client,ui,cli}` compilam com TypeScript **6.0.3** (versão exata), com `engines.node` fixado em `>=24.7 <25`.
2. **Só pnpm workspaces.** O repositório do framework usa só pnpm workspaces, **sem Turborepo nem Nx** (Structural Seed). O Turborepo pertence à app gerada por `tecton-admin new` (Story 1.9), não a este repositório.
3. **`check:deps` (AD-3).** Dado um pacote que importa uma dependência interna proibida (ex.: `@tecton/manifest` importando `@tecton/core`), quando a checagem de direção de dependência roda (`pnpm check:deps`), então ela falha e informa **o arquivo, o import e a regra do AD-3** violada.
4. **CI.** Dado um push ou pull request no GitHub, quando o CI roda, então ele executa install, build, test e `check:deps`, e falha se qualquer um deles falhar.
5. **README.** Dado que a story foi concluída, quando eu consulto o README do repositório, então encontro o test runner escolhido e o motivo da escolha, além dos comandos `pnpm build`, `pnpm test` e `pnpm check:deps`.
6. **Matriz de bancos para persistência.** Dado testes marcados como de persistência, a partir do momento em que existirem, quando o CI roda, então um job dedicado executa esses testes em PostgreSQL, MariaDB e MySQL e é obrigatório para merge. E no ciclo local e nos demais jobs, os testes de persistência rodam só em PostgreSQL.

## Tasks / Subtasks

- [x] **T1. Raiz do workspace** (AC: 1, 2)
  - [x] `package.json` raiz: `"private": true`, `"type": "module"`, `"packageManager": "pnpm@12.10.1"` (fixa via Corepack), `"engines": { "node": ">=24.7 <25" }`, scripts `build`, `test`, `test:persistence`, `check:deps`, `typecheck`.
  - [x] `pnpm-workspace.yaml` com `packages: ['packages/*']`.
  - [x] `.npmrc` com `engine-strict=true` (faz o `pnpm install` falhar fora do Node 24) e `link-workspace-packages=true`.
  - [x] `.node-version` contendo `24` (lido por fnm, nvm-windows, volta, setup-node).
  - [x] Dependências de dev na raiz, versões exatas: `typescript@6.0.3`, `@types/node@^24` (alinhado ao Node 24), `vitest@^5.0.3`, `dependency-cruiser@^18.5.0`.
- [x] **T2. Configuração TypeScript compartilhada** (AC: 1)
  - [x] `tsconfig.base.json` com tudo explícito (ver "TypeScript 6.0" em Dev Notes): `strict`, `module`/`moduleResolution: NodeNext`, `target: ES2024`, `types: ["node"]`, `declaration`, `declarationMap`, `sourceMap`, `composite: true`, `verbatimModuleSyntax`, `isolatedModules`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
  - [x] `tsconfig.json` raiz só com `files: []` e `references` para os 8 pacotes (build incremental por `tsc -b`).
  - [x] `pnpm build` = `tsc -b` na raiz.
- [x] **T3. Os 8 pacotes** (AC: 1)
  - [x] Para cada um em `packages/{manifest,core,providers,auth,directory,service-client,ui,cli}`: `package.json` (`name: @tecton/<nome>`, `version: 0.0.0`, `type: module`, `engines.node: ">=24.7 <25"`, `exports` → `./dist/index.js` com `types`, `files: ["dist"]`, `license: Apache-2.0`), `tsconfig.json` (estende a base, `rootDir: src`, `outDir: dist`, `references` só para os pacotes de que depende pelo AD-3) e `src/index.ts`.
  - [x] O `tsconfig.json` de cada pacote exclui `src/**/*.test.ts` do build (testes nunca vão para `dist`). Os testes são transpilados pelo Vitest; o `pnpm typecheck` usa um `tsconfig.test.json` na raiz (`noEmit`, inclui `packages/*/src/**/*.test.ts` e `tools/**/*.ts`) para checar os tipos dos testes, e entra no CI depois do build.
  - [x] `src/index.ts` mínimo e honesto: exporta só uma constante com o nome do pacote (ex.: `export const packageName = '@tecton/manifest';`) e um comentário em inglês de uma linha. **Nada de APIs especulativas** — o conteúdo real nasce nas stories seguintes.
  - [x] `@tecton/cli` declara `"bin": { "tecton-admin": "./dist/bin.js" }` só quando a Story 1.6 criar o binário; **não** criar o `bin` agora.
  - [x] **Não** declarar dependências `workspace:*` entre pacotes nesta story: nenhum pacote importa outro ainda. Cada story que criar o primeiro import acrescenta a dependência e a `reference` do `tsconfig`.
- [x] **T4. `check:deps` com dependency-cruiser** (AC: 3)
  - [x] `.dependency-cruiser.cjs` na raiz com as regras do AD-3 (tabela em Dev Notes), cada uma com `name` começando por `ad-3-` e `comment` citando o AD-3 e a direção permitida.
  - [x] Regra adicional `no-circular` (severidade `error`).
  - [x] Resolução de `@tecton/*` para `packages/*/src/index.ts` via `tsConfig` dedicado (`tsconfig.depcruise.json` com `"paths": { "@tecton/*": ["packages/*/src/index.ts"] }`), para que um import proibido seja detectado **mesmo sem** a dependência declarada no `package.json` (que é justamente o caso de uma violação). Na config, `options.tsConfig.fileName: 'tsconfig.depcruise.json'` **relativo ao diretório corrente**, para que a mesma config sirva à raiz e às fixtures.
  - [x] Script: `"check:deps": "depcruise packages --config .dependency-cruiser.cjs --output-type err-long"`. O formato `err-long` imprime arquivo de origem, módulo importado, nome da regra e o `comment`.
  - [x] Garantir que `dist/`, `node_modules/` e fixtures de teste fiquem fora da análise (`options.exclude`).
- [x] **T5. Teste da checagem** (AC: 3, 4)
  - [x] `tools/check-deps/check-deps.test.ts` (Vitest): roda o `depcruise` com a mesma config contra uma fixture de violação e afirma: código de saída ≠ 0; a saída contém o caminho do arquivo violador, o especificador `@tecton/core` e o nome da regra `ad-3-…`.
  - [x] Fixture em `tools/check-deps/fixtures/violation/packages/{manifest,core}/src/index.ts` (manifest importando `@tecton/core`) e uma fixture `valid/` (ex.: `core` importando `manifest`) que deve passar. Cada fixture tem o **próprio** `tsconfig.depcruise.json` (mesmos `paths`), porque os `paths` resolvem relativos ao tsconfig e, com o da raiz, o import da fixture cairia nos pacotes reais. O teste executa `depcruise packages --config <raiz>/.dependency-cruiser.cjs --output-type err-long` com `cwd` na fixture (regras com caminhos relativos `^packages/...`).
  - [x] Teste rápido: nenhum container, nenhuma rede.
- [x] **T6. Vitest e marcação de persistência** (AC: 4, 6)
  - [x] Um único `vitest.config.ts` na raiz com `include: ['packages/*/src/**/*.test.ts', 'tools/**/*.test.ts']`. **Não** usar `test.projects` por pacote agora: pacotes sem config própria e sem testes só geram ruído. Projetos por pacote entram quando um pacote precisar de ambiente diferente (ex.: `jsdom` no `@tecton/ui`, Epic 4).
  - [x] Convenção de marcação: arquivos de teste de persistência terminam em `*.persistence.test.ts`. `pnpm test` **exclui** esse padrão; `pnpm test:persistence` roda **só** esse padrão.
  - [x] Banco selecionado por variável `TECTON_TEST_DB` (`postgres` | `mariadb` | `mysql`, padrão `postgres`). Documentar a variável; nenhum teste a usa ainda.
  - [x] Ambos os scripts com `--passWithNoTests`, para que o job de matriz rode verde enquanto não houver testes de persistência.
- [x] **T7. CI no GitHub Actions** (AC: 4, 6)
  - [x] `.github/workflows/ci.yml`, gatilhos `push` e `pull_request`.
  - [x] Job `build-test`: checkout → `pnpm/action-setup` (lê `packageManager`) → `actions/setup-node` com `node-version-file: .node-version` e `cache: pnpm` → `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm typecheck` → `pnpm test` → `pnpm check:deps`. Cada passo falha o job.
  - [x] Job `persistence` com `strategy.matrix.db: [postgres, mariadb, mysql]`, `fail-fast: false`, env `TECTON_TEST_DB: ${{ matrix.db }}`, rodando `pnpm test:persistence` (depois de install e build).
  - [x] Nomes de job estáveis (`build-test`, `persistence (postgres)`, `persistence (mariadb)`, `persistence (mysql)`), porque a proteção de branch referencia esses nomes.
  - [x] **Não** subir banco no job ainda: os testes de persistência usarão Testcontainers (FR-31, Test Design). O runner `ubuntu-latest` já tem Docker.
- [x] **T8. README** (AC: 5)
  - [x] Acrescentar ao `README.md` uma seção "Desenvolvimento" com: pré-requisitos (Node 24.7+, Corepack/pnpm, Docker para testes de persistência), comandos `pnpm install`, `pnpm build`, `pnpm test`, `pnpm test:persistence`, `pnpm check:deps`, a convenção `*.persistence.test.ts` + `TECTON_TEST_DB`, e **o test runner escolhido (Vitest) com o motivo**.
  - [x] Atualizar a linha de status ("planejamento (pré-código)") para refletir que o scaffold existe.
  - [x] Manter o idioma atual do README (Português do Brasil) — ver "Questões em aberto".
- [x] **T9. Verificação final**
  - [x] Em Node 24.7+: `pnpm install` limpo, `pnpm build`, `pnpm test`, `pnpm check:deps` verdes.
  - [x] Provar o AC 3 de ponta a ponta além do teste: criar temporariamente em `packages/manifest/src` um import de `@tecton/core`, ver `pnpm check:deps` falhar com arquivo, import e regra, e desfazer.
  - [x] Commitar o `pnpm-lock.yaml`.

## Dev Notes

### Contexto

Primeira story de código do Tecton. O repositório hoje só tem planejamento (`_bmad/`, `_bmad-output/`, `docs/`), `README.md`, `LICENSE` (Apache 2.0), `CONSTITUTION.md`, `CLAUDE.md`, `Tecton.md` e `.gitignore`. **Não existe `package.json`.** Não há starter template: a Spine diz que o scaffold nasce do zero conforme o Structural Seed. [Source: epics.md#Additional Requirements; ARCHITECTURE-SPINE.md#Structural Seed]

Esta story **não** implementa nada de manifest, CLI ou serviço. Ela entrega o esqueleto, a checagem do AD-3, o test runner, o CI e a matriz de bancos. Resistir à tentação de antecipar código das Stories 1.2+.

### AD-3: tabela de dependências permitidas

[Source: ARCHITECTURE-SPINE.md#AD-3, com a emenda de 2026-10-01]

| Pacote | Pode importar (`@tecton/*`) |
|---|---|
| `manifest` | nenhum |
| `providers` | `manifest` |
| `ui` | `manifest` |
| `core` | `manifest`, `providers` |
| `service-client` | `manifest`, `providers` |
| `auth` | `manifest`, `providers`, `core` |
| `directory` | `manifest`, `providers`, `core`, `ui` |
| `cli` | todos |

Nunca o inverso. O grafo é acíclico; a regra `no-circular` protege contra ciclos indiretos.

**Forma recomendada das regras** (uma por pacote restrito, padrão "proibir tudo que não está na lista"):

```js
// .dependency-cruiser.cjs (excerpt)
{
  name: 'ad-3-providers-allowed-deps',
  comment: 'AD-3: @tecton/providers may only depend on @tecton/manifest',
  severity: 'error',
  from: { path: '^packages/providers/' },
  to: { path: '^packages/(?!providers/|manifest/)[^/]+/' },
}
```

Repetir para `manifest` (nenhum outro pacote), `ui`, `core`, `service-client`, `auth` e `directory`. `cli` não tem regra de restrição.

**Por que `tsconfig.depcruise.json` com `paths`:** num import proibido, o pacote importado normalmente **não** está declarado como dependência, então a resolução pelo `node_modules` falharia e o dependency-cruiser veria um import "não resolvido" em vez de uma violação de regra. Com `paths: { "@tecton/*": ["packages/*/src"] }`, o import resolve para `packages/core/src/...` e a regra de caminho dispara com mensagem clara. Acrescente também uma regra `not-to-unresolvable` para pegar typos.

### TypeScript 6.0 (versão fixada pela Spine)

- A Spine fixa **TypeScript 6.0.3** e **não** a 7.0 (sem API pública de compilador até a 7.1; `tsx`/`ts-node` dependem dela). No npm hoje, `latest` é 7.0.2 — **use a versão exata `6.0.3`**, sem `^`. [Source: ARCHITECTURE-SPINE.md#Stack]
- O TypeScript 6.0 mudou vários padrões em preparação para a 7.0 (entre eles `strict` ligado por padrão, `types` vazio por padrão e mudanças no `rootDir` padrão) e deprecou opções antigas (`baseUrl`, `moduleResolution: node10`/`classic`, `target: ES5`). **Não dependa de nenhum padrão:** declare explicitamente `strict`, `types: ["node"]`, `rootDir`, `outDir`, `module` e `moduleResolution`. Não use `baseUrl` (no `tsconfig.depcruise.json`, `paths` funciona sem `baseUrl` desde o TS 4.1). Se o compilador emitir aviso de deprecação, corrija a configuração em vez de silenciar com `ignoreDeprecations`.
- `module`/`moduleResolution: NodeNext` + `"type": "module"`: imports relativos levam extensão `.js` no código-fonte TypeScript.

### Node e ferramentas

- **Node 24.x** (Active LTS; hoje 24.21.0). `engines: ">=24.7 <25"`: o 24.7 é o piso porque a Story 2.1 pode usar `crypto.argon2` nativo. [Source: epics.md#Story 2.1; ARCHITECTURE-SPINE.md#Stack]
- **pnpm 12.10.1** fixado em `packageManager` (Corepack). Versões verificadas no npm em 2026-10-08: pnpm 12.10.1, Vitest 5.0.3 (aceita Node `^22.12 || ^24 || >=26`), dependency-cruiser 18.5.0 (Node `^22 || ^24 || >=26`), `@types/node` 24.19.1.
- Sem ESLint/Prettier nesta story (não é critério de aceite). Se quiser formatação, é story à parte.

### Test runner: Vitest (registrar no README)

Motivo, para o README: ESM e TypeScript nativos sem etapa de build dos testes; `projects` para monorepo; filtro por padrão de arquivo para separar persistência; compatível com Testcontainers e com o Playwright, que o Test Design prevê para testes multi-serviço e E2E; mesma ferramenta para backend e para componentes React (Epic 4). [Source: _bmad-output/test-artifacts/test-design-qa.md#Níveis de teste; test-design-architecture.md#Guia rápido]

### Testes de persistência (AC 6)

- O Test Design (R-08, score 6) exige que **todo** teste que toca Prisma rode nos 3 bancos antes do merge. Esta story cria só o trilho: convenção de nome, variável `TECTON_TEST_DB`, script e job de matriz. O primeiro teste real chega na Story 2.2 (banco do Auth) e a fixture de Testcontainers vem do Test Framework, que roda logo depois desta story.
- **"Obrigatório para merge"** depende da proteção de branch no GitHub (required status checks), que é configuração do repositório, não arquivo. O dev **não** altera configurações do GitHub: deixar no relatório de conclusão a instrução para o Boss marcar `build-test` e os três `persistence (...)` como checks obrigatórios em `main` (e `dev`, se for o fluxo).

### Fluxo de branches

O trabalho acontece em `dev` (branch atual); `main` é a principal. O CI deve rodar em push para qualquer branch e em PR.

### Convenções de idioma

Código, comentários, nomes de arquivo, mensagens de regra do dependency-cruiser e logs: **inglês, sem exceção**. O README atual está em Português do Brasil. [Source: CLAUDE.md#Convenções de idioma; CONSTITUTION.md §8]

### Estrutura final esperada

```text
tecton/
  .github/workflows/ci.yml        # NEW
  .dependency-cruiser.cjs         # NEW
  .node-version                   # NEW
  .npmrc                          # NEW
  package.json                    # NEW
  pnpm-lock.yaml                  # NEW (gerado)
  pnpm-workspace.yaml             # NEW
  tsconfig.base.json              # NEW
  tsconfig.json                   # NEW (só references)
  tsconfig.depcruise.json         # NEW
  tsconfig.test.json              # NEW (typecheck dos testes)
  vitest.config.ts                # NEW
  README.md                       # UPDATE (seção Desenvolvimento + status)
  packages/<8 pacotes>/{package.json,tsconfig.json,src/index.ts}   # NEW
  tools/check-deps/check-deps.test.ts                               # NEW
  tools/check-deps/fixtures/{violation,valid}/{tsconfig.depcruise.json,packages/...}  # NEW
```

Arquivos que **não** devem mudar: `.github/agents/*` (agentes BMAD), `_bmad/**`, `_bmad-output/**` (exceto status da story), `docs/**`, `LICENSE`, `CONSTITUTION.md`. O `.gitignore` já ignora `node_modules/`, `dist`, `*.tsbuildinfo`, `coverage` e `.env*`; não precisa mudar. [Verificado em 2026-10-08]

### Armadilhas a evitar

- Criar `turbo.json` ou `nx.json` (viola o AC 2).
- Usar `^` na versão do TypeScript, ou TypeScript 7.
- Declarar `workspace:*` entre pacotes "para o futuro": cria arestas que ninguém usa e pode mascarar violações.
- Regra do dependency-cruiser que só olha `node_modules/@tecton/...`: não pega a violação real (ver `paths` acima).
- Fixture de teste dentro de `packages/`: o `check:deps` real passaria a falhar. Fixtures ficam em `tools/` e são excluídas da análise principal.
- `--passWithNoTests` esquecido: o job de matriz ficaria vermelho sem testes.
- Gerar código em português (comentários, nomes de regra).

### Ambiente local (verificado em 2026-10-08)

Nesta máquina: **Node 22.11.0** (abaixo do piso 24.7), **pnpm não instalado**, **Docker não encontrado no PATH**. Com `engine-strict=true`, `pnpm install` falha em Node 22, o que é o comportamento correto. Para cumprir o T9 é preciso Node 24 local (ver "Questões em aberto").

### Test Design e próximos passos

- Depois desta story: **Test Framework** (`bmad-testarch-framework`, retomado com `[R] Resume`) e **CI Setup** (`bmad-testarch-ci`), que estendem o `vitest.config.ts` e o `ci.yml` criados aqui (fixtures `clock`, Toxiproxy, TLS do JWKS, Testcontainers). Mantenha os dois arquivos simples e extensíveis. [Source: _bmad-output/test-artifacts/framework-setup-progress.md]
- Riscos do Test Design tocados aqui: R-08 (portabilidade de banco: o trilho da matriz), R-20 (tempo de CI: separação por padrão de arquivo), R-25 (deriva de arquitetura: `check:deps`).

### Project Structure Notes

- Alinhado ao Structural Seed: `packages/{manifest,core,providers,auth,directory,service-client,ui,cli}`, pnpm workspaces, sem Turborepo/Nx no repositório do framework. [Source: ARCHITECTURE-SPINE.md#Structural Seed]
- Nomes: pacotes `@tecton/<nome>` kebab-case, arquivos kebab-case. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions]
- Variação justificada: `tools/` não está no Structural Seed; abriga a verificação de dependências e seus testes, que não pertencem a nenhum pacote publicado.

### Questões em aberto (para o Boss, não bloqueiam a criação da story)

1. **Node 24 local:** instalar Node 24 LTS (ex.: `winget install OpenJS.NodeJS.LTS` ou fnm) e habilitar Corepack (`corepack enable`), ou validar só pelo CI?
2. **Idioma do README do framework:** manter em PT-BR (como hoje) ou passar para inglês, já que é superfície de dev (Constitution §8, eixo 2)? A story mantém PT-BR por padrão.
3. **Proteção de branch:** marcar os checks como obrigatórios no GitHub depois do primeiro run verde.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1]
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements] (AD-3, stack, estrutura do monorepo)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#AD-3, #Stack, #Structural Seed, #Consistency Conventions]
- [Source: _bmad-output/test-artifacts/test-design-architecture.md] (R-08, R-20, R-25)
- [Source: _bmad-output/test-artifacts/test-design-qa.md#Estratégia de execução]
- [Source: _bmad-output/planning-artifacts/implementation-readiness-report-2026-10-08.md] (Epic 1 sem achados bloqueantes)
- [Source: CONSTITUTION.md §8; CLAUDE.md#Convenções de idioma]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Fase vermelha do T5: `pnpm test` falhou (2 testes) antes de existir `.dependency-cruiser.cjs`; verde depois da config.
- O binário do dependency-cruiser 18 é `bin/dependency-cruiser.mjs` (não `dependency-cruise.mjs`); o teste chama o binário direto com `process.execPath`.
- `engine-strict`/`link-workspace-packages` no `.npmrc` eram ignorados pelo pnpm 12 (`pnpm config get engine-strict` → `undefined`; install com `engines: ">=99"` passava). Movidos para `pnpm-workspace.yaml` (`engineStrict`, `linkWorkspacePackages`); com isso o mesmo teste falha com `ERR_PNPM_UNSUPPORTED_ENGINE`.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Ambiente: Node 24.20.0 instalado no sistema via winget (substituiu o 22.11), pnpm 12.10.1 pelo Corepack com shims em `%APPDATA%\npm` (o `corepack enable` padrão exige admin em `C:\Program Files\nodejs`).
- AC 1: instalação limpa (`pnpm install --frozen-lockfile`) + `pnpm build` (`tsc -b`, TypeScript 6.0.3 confirmado por `tsc -v`) compilam os 8 pacotes; `engines.node` `>=24.7 <25` na raiz e em cada pacote.
- AC 2: só pnpm workspaces; nenhum `turbo.json`/`nx.json`.
- AC 3: `pnpm check:deps` com dependency-cruiser e uma regra por pacote restrito (`ad-3-*`), `no-circular` e `not-to-unresolvable`. Saída `err-long` mostra a regra, o arquivo de origem → o módulo importado (caminho resolvido, ex.: `packages/core/src/index.ts`) e o comentário com a direção permitida do AD-3. Coberto por `tools/check-deps/check-deps.test.ts` (fixture de violação e fixture válida) e provado de ponta a ponta num pacote real (import temporário de `@tecton/core` em `@tecton/manifest` → exit 1; desfeito → exit 0).
- AC 4: `.github/workflows/ci.yml` com job `build-test` (install, build, typecheck, test, check:deps). Actions nas versões atuais (checkout v7, pnpm/action-setup v6, setup-node v7). Ainda não executado no GitHub: roda no primeiro push.
- AC 5: README com seção "Desenvolvimento" (pré-requisitos, comandos, Vitest e o motivo, convenção de persistência), em PT-BR por decisão do Boss.
- AC 6: job `persistence (postgres|mariadb|mysql)` com `TECTON_TEST_DB` e `pnpm test:persistence` (`*.persistence.test.ts`, `--passWithNoTests`); `pnpm test` exclui esse padrão. **Pendente do Boss:** marcar `build-test` e os três `persistence (...)` como required status checks na proteção de branch do GitHub depois do primeiro run verde (configuração do repositório, fora do código).
- Desvio do texto do T1: o T1 pedia `.npmrc`; as duas opções foram para `pnpm-workspace.yaml` porque o pnpm 12 não as lê do `.npmrc` (ver Debug Log). Efeito pretendido (install falha fora do Node 24) verificado.
- Testes: 2 testes Vitest (violação e caso válido), verdes; `pnpm typecheck` verde.

### File List

- `.dependency-cruiser.cjs` (novo)
- `.github/workflows/ci.yml` (novo)
- `.node-version` (novo)
- `package.json` (novo)
- `pnpm-lock.yaml` (novo, gerado)
- `pnpm-workspace.yaml` (novo)
- `tsconfig.base.json` (novo)
- `tsconfig.json` (novo)
- `tsconfig.depcruise.json` (novo)
- `tsconfig.test.json` (novo)
- `vitest.config.ts` (novo)
- `README.md` (modificado)
- `packages/{auth,cli,core,directory,manifest,providers,service-client,ui}/package.json` (novos)
- `packages/{auth,cli,core,directory,manifest,providers,service-client,ui}/tsconfig.json` (novos)
- `packages/{auth,cli,core,directory,manifest,providers,service-client,ui}/src/index.ts` (novos)
- `tools/check-deps/check-deps.test.ts` (novo)
- `tools/check-deps/fixtures/valid/tsconfig.depcruise.json` (novo)
- `tools/check-deps/fixtures/valid/packages/{core,manifest}/src/index.ts` (novos)
- `tools/check-deps/fixtures/violation/tsconfig.depcruise.json` (novo)
- `tools/check-deps/fixtures/violation/packages/{core,manifest}/src/index.ts` (novos)

## Change Log

- 2026-10-09: Story 1.1 implementada: monorepo pnpm com 8 pacotes em TypeScript 6.0.3, `check:deps` do AD-3, Vitest, CI com matriz de bancos para persistência e seção de desenvolvimento no README.
