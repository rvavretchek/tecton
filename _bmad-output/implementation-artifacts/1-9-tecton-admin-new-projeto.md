---
baseline_commit: bf4d9c3d951f560dab5da6b200dc0b2e970dfc46
---

# Story 1.9: `tecton-admin new <projeto>`

Status: review

## Story

Como **dev começando a migrar um sistema para o Tecton**,
quero criar um workspace com um único comando,
para ter a estrutura pronta e as dependências do framework declaradas, sem copiar código do framework.

## Acceptance Criteria

1. **Workspace.** Dado um diretório de destino inexistente e um nome em kebab-case, quando eu rodo `tecton-admin new <projeto>`, então é criado um workspace com Turborepo e pnpm workspaces, `turbo.json` com tarefas `build` e `dev`, `tsconfig` base e a pasta `apps/domains/` vazia. E `pnpm install` e `turbo run build` terminam com sucesso nesse workspace vazio.
2. **AD-4.** Dado o workspace gerado, quando eu inspeciono os `package.json`, então os pacotes `@tecton/*` aparecem como dependências versionadas. E nenhum arquivo de código-fonte do framework foi copiado para o workspace.
3. **Checkout local.** Dada a opção de apontar para um checkout local do framework (para testes ponta a ponta do próprio framework), quando eu a uso, então as dependências `@tecton/*` apontam para o checkout local como link de dependência, nunca como cópia.
4. **Destino ocupado.** Dado um diretório de destino que já existe e não está vazio, quando eu rodo `tecton-admin new`, então o comando falha sem sobrescrever nada.
5. **Nome inválido.** Dado um nome fora de kebab-case, quando eu rodo `tecton-admin new`, então o comando falha e explica o formato esperado.
6. **Inglês.** Dado o texto de ajuda e as mensagens do comando, quando eu rodo `tecton-admin new --help`, então todo o texto está em inglês.
7. **Sementes de documentação.** Dado um workspace novo, quando eu rodo `tecton-admin new`, então são criadas sementes curtas de `AGENTS.md` e `README.md`, em inglês, que dizem ao agente de IA que os documentos ainda não foram escritos e que ele deve escrevê-los seguindo o guia do Tecton e substituir a semente. E é criado um `CLAUDE.md` que só aponta para o `AGENTS.md`.
8. **Guia para agentes.** Dado o guia de documentação para agentes, distribuído no pacote `@tecton/cli` em inglês, quando eu o leio, então ele define a estrutura recomendada do `AGENTS.md`, incluindo uma seção marcada com a lista de domínios e dependências em formato verificável e uma seção de regras invioláveis (nunca acessar o banco de outro domínio, nunca editar `@tecton/*`, nunca desligar a verificação de token). E orienta que o documento seja escrito e mantido só por agentes, no idioma escolhido pelo dev, preservando o máximo do conteúdo existente a cada atualização. E determina que as regras invioláveis nunca sejam removidas nem enfraquecidas, só ampliadas, e que mudanças no `AGENTS.md` passem por revisão de PR como código. E nenhum trecho dos documentos é bloqueado contra edição.
9. **README guiado.** Dada a semente do `README.md`, quando o agente faz a primeira tarefa no workspace, então o guia o orienta a entrevistar o dev sobre o produto e escrever o README no idioma escolhido pelo dev.

> `apps/gateway` entra no Epic 3, `apps/directory` no Epic 4 e `docker-compose.dev.yml` na Story 1.11. Cada épico estende o `new`.

## Tasks / Subtasks

- [x] **T1. Templates** (AC: 1, 2, 7)
  - [x] `packages/cli/templates/workspace/` com os arquivos do workspace (bf4d9c3d951f560dab5da6b200dc0b2e970dfc46s `{{name}}`, `{{tectonVersion}}`, `{{tectonCli}}`): `package.json` (privado, `packageManager: pnpm@12.10.1`, `engines.node >=24.7 <25`, scripts `build: turbo run build`, `dev: turbo run dev`, `lint: tecton-admin lint`; dev dependencies `turbo` ^2.11.7, `typescript` 6.0.3, `@tecton/cli`), `pnpm-workspace.yaml` (`apps/*`, `apps/domains/*`; `engineStrict: true`), `turbo.json` (`build` com `dependsOn: ["^build"]` e `outputs: ["dist/**"]`; `dev` com `cache: false`, `persistent: true`), `tsconfig.base.json` (mesmas opções do framework), `.gitignore` (`node_modules`, `dist`, `.turbo`, `.env*` com `!.env.example`), `.node-version` (`24`), `apps/domains/.gitkeep`, `AGENTS.md`, `README.md`, `CLAUDE.md`.
  - [x] Os arquivos que começam com ponto ficam no pacote com nome sem ponto (ex.: `_gitignore`) e são renomeados na geração, porque o npm descarta `.gitignore` ao publicar.
  - [x] `package.json` do `@tecton/cli`: `files` inclui `templates` e `docs`.
- [x] **T2. Comando** (AC: 1–6)
  - [x] `src/commands/new.ts`: `newCommand(name, { framework? }, io)`. Valida o nome (kebab-case, mesma regra do `domain`), recusa destino existente e não vazio sem escrever nada, copia os templates substituindo bf4d9c3d951f560dab5da6b200dc0b2e970dfc46s.
  - [x] Versão das dependências `@tecton/*`: `^<versão do @tecton/cli em execução>` (lida do próprio `package.json`).
  - [x] `--framework <path>`: caminho de um checkout local do framework; as dependências `@tecton/*` viram `link:<caminho relativo>/packages/<pacote>` (link do pnpm, nunca cópia). Falha se o caminho não tiver `packages/cli/package.json` com `name: @tecton/cli`.
  - [x] Saída: lista os próximos passos (`cd <name>`, `pnpm install`, `tecton-admin generate domain <name>`) em inglês. `--help` com descrição e exemplo.
- [x] **T3. Guia para agentes** (AC: 8, 9)
  - [x] `packages/cli/docs/agents-guide.md` (inglês) com: propósito; estrutura recomendada do `AGENTS.md`; a seção marcada `<!-- tecton:domains:start -->`/`<!-- tecton:domains:end -->` com a lista de domínios e dependências em formato verificável (lista YAML) — a Story 1.10 a usa no aviso do lint; regras invioláveis (as três do AC 8); manutenção só por agentes, no idioma do dev, preservando conteúdo; regras invioláveis só ampliadas; mudanças no `AGENTS.md` por PR; nenhum trecho bloqueado; e a orientação de README (entrevistar o dev, escrever no idioma dele).
  - [x] As sementes de `AGENTS.md` e `README.md` dizem que ainda não foram escritas e apontam para `node_modules/@tecton/cli/docs/agents-guide.md`. O `CLAUDE.md` só aponta para o `AGENTS.md`.
- [x] **T4. Testes**
  - [x] `src/commands/new.test.ts` (rápidos, sem rede): estrutura gerada, bf4d9c3d951f560dab5da6b200dc0b2e970dfc46s substituídos, nenhum arquivo de código do framework copiado (nenhum `.ts` fora de templates conhecidos; nenhuma pasta `packages/`), versões `^x.y.z`, `--framework` com `link:` relativo, destino não vazio sem efeito, destino vazio existente aceito, nome inválido, `.gitignore` renomeado, `--help` em inglês, sementes e `CLAUDE.md`.
  - [x] `src/commands/new.generation.test.ts` (lento, precisa de rede): gera com `--framework` apontando para este repositório, roda `pnpm install` e `pnpm exec turbo run build` no workspace e espera sucesso. Convenção nova `*.generation.test.ts` → `pnpm test:generation`, excluída do `pnpm test` e rodada no nightly (Test Design, execução).
- [x] **T5. Verificação final:** `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:deps`, `pnpm lint:examples`, `pnpm validate:asyncapi`, `pnpm test:generation`.

## Dev Notes

- AD-4: código gerado importa, nunca copia. O workspace só declara `@tecton/*` em `package.json`; nada de `packages/` dentro dele.
- Turborepo 2.11.7 (npm, 2026-10-09). O repositório do framework continua sem Turborepo (Story 1.1); ele só aparece no workspace gerado.
- O `@tecton/*` ainda não está publicado no npm: `pnpm install` num workspace gerado sem `--framework` só funciona depois da publicação. O teste de geração usa `--framework`.
- Idioma: tudo que o comando escreve e imprime em inglês; os documentos que o dev mantém (AGENTS.md, README.md) ficam no idioma que o dev escolher (Constitution §8, esclarecimento de 2026-10-07), escritos por agente.
- [Source: epics.md#Story 1.9; ARCHITECTURE-SPINE.md#AD-4, #Structural Seed; CONSTITUTION.md §8]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Uma falha do teste parecia indicar `.gitkeep` gravado fora do workspace. Reproduzido fora do Vitest: o comando grava certo; o bug era do helper do teste, que relativizava caminhos já relativos a partir do diretório do processo. Helper corrigido.
- O guia tinha travessões (não ASCII); trocados por dois-pontos.
- `addHelpText` quebrou de novo por `\n` virar quebra real numa edição por script; corrigido pelo editor.
- O teste de geração usava `spawnSync` com array de argumentos e `shell: true` (aviso DEP0190 do Node 24); passou a usar um comando fixo em string.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- `tecton-admin new <name> [--framework <path>]`: valida kebab-case (mesma regra do `domain`), recusa destino existente e não vazio sem escrever nada (diretório vazio é aceito), gera o workspace a partir de `packages/cli/templates/workspace/` e imprime os próximos passos em inglês.
- Workspace gerado: `package.json` (pnpm 12.10.1, Node >=24.7 <25, scripts `build`/`dev` via Turborepo e `lint`), `pnpm-workspace.yaml` (`apps/*`, `apps/domains/*`, `engineStrict`), `turbo.json` (`build` com `^build` e `dist/**`; `dev` persistente sem cache), `tsconfig.base.json`, `.gitignore`, `.node-version`, `apps/domains/.gitkeep`, sementes `AGENTS.md`/`README.md` e `CLAUDE.md` apontando para o `AGENTS.md`.
- AD-4: `@tecton/cli` declarado como `^<versão do CLI>`; com `--framework`, `link:<caminho relativo>/packages/cli` (link do pnpm). Placeholders `{{tecton:<pacote>}}` permitem que os próximos épicos acrescentem `@tecton/*` sem mudar a lógica.
- Templates com ponto inicial ficam no pacote sem o ponto (`_gitignore` etc.) e são renomeados na geração (o npm descarta `.gitignore` ao publicar). `files` do `@tecton/cli`: `dist`, `templates`, `docs`.
- Guia `packages/cli/docs/agents-guide.md` (inglês): manutenção só por agentes, no idioma do dev, preservando conteúdo; nada bloqueado; mudanças no `AGENTS.md` por PR; estrutura em 5 seções; regras invioláveis só ampliadas; seção verificável entre `<!-- tecton:domains:start -->` e `<!-- tecton:domains:end -->` com YAML (base do aviso da 1.10); orientação de README (entrevistar o dev) e de `extract`.
- Convenção nova `*.generation.test.ts` → `pnpm test:generation` (fora do `pnpm test`, dentro do nightly). O teste gera um workspace ligado a este checkout, roda `pnpm install` e `turbo run build`: passa localmente.
- Testes: 15 novos (14 rápidos + 1 de geração); suíte rápida 245 verde; build, typecheck, `check:deps`, `lint:examples`, `validate:asyncapi` e `test:generation` verdes.

### File List

- `packages/cli/src/commands/new.ts`, `new.test.ts`, `new.generation.test.ts` (novos)
- `packages/cli/src/cli.ts`, `packages/cli/package.json` (modificados)
- `packages/cli/templates/workspace/**` (novos: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `_gitignore`, `_node-version`, `apps/domains/_gitkeep`, `AGENTS.md`, `README.md`, `CLAUDE.md`)
- `packages/cli/docs/agents-guide.md` (novo)
- `package.json` (modificado: `test:generation` e exclusão no `test`)
- `vitest.config.ts`, `tests/README.md`, `.github/workflows/nightly.yml` (modificados)

## Change Log

- 2026-10-09: Story 1.9 implementada: `tecton-admin new` gera workspace pnpm + Turborepo com dependências versionadas (ou link local), sementes de documentação e guia para agentes.
