---
baseline_commit: c9823da0bd92635f21dffefb1dc2330176e60b36
---

# Story 1.10: `tecton-admin generate domain <nomes...>`

Status: done
## Story

Como **dev ou agente de IA estruturando os domínios de um sistema**,
quero gerar um ou vários domínios numa chamada, cada um já com manifest válido,
para começar a declarar actions e events imediatamente.

## Acceptance Criteria

1. **Vários domínios.** Dado um workspace criado pela Story 1.9, quando eu rodo `tecton-admin generate domain finance inventory sales`, então são criados `apps/domains/finance`, `apps/domains/inventory` e `apps/domains/sales`, cada um com `tecton.yaml` e `package.json` (FR-15). E cada `tecton.yaml` traz o `manifestVersion` atual, `domain`, `version: 0.1.0`, `description` de exemplo, `actions: []`, `events` vazio e `dependencies: []`. E `tecton-admin lint` passa logo em seguida, sem nenhuma edição (FR-1).
2. **`--from`.** Dado um arquivo de texto com um nome de domínio por linha (linhas vazias e linhas começando com `#` são ignoradas), quando eu rodo `tecton-admin generate domain --from <arquivo>`, então o resultado é o mesmo de passar os nomes na linha de comando.
3. **Atomicidade.** Dada uma lista com algum nome inválido (fora de kebab-case) ou que já existe no workspace, quando eu rodo o comando, então nenhum domínio é criado e o erro lista todos os nomes com problema.
4. **Fora de workspace.** Dado que eu rodo o comando fora de um workspace Tecton, quando ele procura o workspace, então falha com mensagem que indica `tecton-admin new`.
5. **Walking skeleton.** Dado um domínio recém-gerado, quando eu o inicio pelo script do próprio pacote, então ele sobe um servidor Fastify com as rotas da Story 1.7, e cada action responde 501 até ser implementada.
6. **Lembrete do `AGENTS.md`.** Dados domínios gerados, quando o comando termina, então a saída lembra o agente de atualizar a seção marcada do `AGENTS.md`.
7. **Divergência do `AGENTS.md`.** Dado um `AGENTS.md` cuja seção marcada não bate com os manifests do workspace, quando eu rodo `tecton-admin lint` (Story 1.6), então aparece um aviso, sem falha, indicando os domínios ou dependências divergentes, também na saída `--format json`.

> A estrutura hexagonal do domínio (AD-1) chega no Epic 3 (Story 3.4). Os nomes seguem identificador em inglês (`finance inventory sales`).

## Tasks / Subtasks

- [x] **T1. `startDomainServer` no `@tecton/core`** (AC: 5)
  - [x] `src/domain-server.ts`: `startDomainServer({ manifestPath, port?, host?, handlers? })` lê e valida o manifest (erro claro listando os problemas se inválido), cria o servidor (`createTectonServer`), registra as rotas (`registerActionRoutes`), escuta na porta (padrão 3000, `host` padrão `0.0.0.0`) e devolve o `FastifyInstance`. `loadDomainManifest(path)` exportada para testes.
- [x] **T2. Templates do domínio** (AC: 1, 5)
  - [x] `packages/cli/templates/domain/`: `tecton.yaml`, `package.json` (nome `@<workspace>/<domínio>`; privado; `type: module`; scripts `build: tsc -p tsconfig.json`, `start: node dist/main.js`; dependências `@tecton/core` e `@tecton/manifest` no mesmo modo do workspace; dev `typescript` 6.0.3 e `@types/node` ^24), `tsconfig.json` (estende `../../../tsconfig.base.json`, `rootDir: src`, `outDir: dist`), `src/main.ts` (chama `startDomainServer` com o `tecton.yaml` do pacote e `PORT`).
- [x] **T3. Comando** (AC: 1–4, 6)
  - [x] `src/workspace.ts`: `findWorkspace(cwd)` sobe diretórios até um `package.json` que declare `@tecton/cli` (dependência ou dev) e tenha `apps/domains/`; devolve raiz, nome e o modo das dependências (`^versão` ou `link:` derivado da especificação do `@tecton/cli` da raiz).
  - [x] `src/commands/generate-domain.ts`: nomes da linha de comando e/ou de `--from` (sem duplicatas); valida todos antes de escrever (kebab-case até 63, inexistente em `apps/domains`, sem repetição na lista); se algum falhar, lista todos e não cria nada. Gera cada domínio e imprime a lista criada e o lembrete do `AGENTS.md` (seção `tecton:domains`).
  - [x] `tecton-admin generate domain <names...> [--from <file>]` com ajuda e exemplo em inglês.
- [x] **T4. Aviso de divergência no lint** (AC: 7)
  - [x] `lintWorkspace` lê `AGENTS.md` na raiz do lint (se existir e tiver os marcadores), parseia o bloco YAML (`domains: [{ name, dependencies }]`) e compara com os manifests do workspace: domínio ausente no `AGENTS.md`, domínio listado sem manifest, dependências diferentes. Um aviso `agents-md-divergence` (arquivo `AGENTS.md`, linha do marcador) por divergência, com mensagem que nomeia o domínio. YAML inválido dentro dos marcadores também é aviso.
- [x] **T5. Testes**
  - [x] Rápidos: `generate-domain.test.ts` (workspace criado por `new` num diretório temporário; AC 1–4 e 6, incluindo `lint` passando logo depois; `--from` com comentários e linhas vazias; modo `link:`); `domain-server.test.ts` no core (manifest com action → 501 via `inject`; manifest inválido → erro claro); testes do aviso do `AGENTS.md` no lint (texto e JSON).
  - [x] Lento (`*.generation.test.ts`): workspace com `--framework`, `generate domain finance`, acrescentar uma action ao manifest, `pnpm install`, `turbo run build`, iniciar o domínio com `pnpm start` numa porta livre, `POST /finance/<action>` → 501, encerrar o processo.
- [x] **T6. Verificação final:** `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:deps`, `pnpm lint:examples`, `pnpm validate:asyncapi`, `pnpm test:generation`.

### Review Findings (code review do Epic 1, 2026-10-13)

- [x] [Review][Patch] P21 (baixa) Entradas repetidas na seção do AGENTS.md somem em silêncio (Map) [packages/manifest/src/lint/agents-document.ts:332]
- [x] [Review][Patch] P28 (baixa) `--from` apontando para diretório lança EISDIR; BOM UTF-8 não é removido [packages/cli/src/commands/generate-domain.ts]
- [x] [Review][Patch] P30 (baixa) `main.ts` gerado: `PORT` vazio vira porta aleatória e `abc` vira NaN; sem SIGTERM/SIGINT para fechar o servidor [packages/cli/templates/domain/src/main.ts]
- [x] [Review][Patch] P45 (baixa) 'Tudo ou nada' do `generate domain` (e do `new`) só vale na validação: falha de disco no meio deixa domínios parciais, sem desfazer [packages/cli/src/commands/generate-domain.ts:65]
- [x] [Review][Patch] P46 (média) Domínios gerados recebem `^<versão do CLI em execução>`, não a versão que o workspace fixou; um CLI global de outra versão gera dependências desalinhadas [packages/cli/src/workspace.ts]

## Dev Notes

- Mesmo modo de dependência do workspace: se o `@tecton/cli` da raiz é `link:<rel>/packages/cli`, os domínios recebem `link:` para `packages/core` e `packages/manifest` do mesmo checkout (caminho relativo a partir do domínio); senão, `^<versão do CLI>`.
- `src/main.ts` do domínio lê `PORT` direto por enquanto; o `ConfigProvider` (Story 3.1) e o esqueleto hexagonal (3.4) substituem.
- A seção marcada do `AGENTS.md` é a da Story 1.9 (YAML entre `<!-- tecton:domains:start -->` e `<!-- tecton:domains:end -->`).
- Código novo: aviso `agents-md-divergence` (união de códigos).
- Editar código TypeScript só pelo editor, nunca por script com `\n` (lição das Stories 1.6 e 1.9).
- [Source: epics.md#Story 1.10; PRD FR-1, FR-15; ARCHITECTURE-SPINE.md#AD-4]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Na verificação final, o teste do `check:deps` (Story 1.1) estourou o limite padrão de 5 s do Vitest com a suíte em paralelo (8,5 s; isolado leva 2,2 s, porque executa o dependency-cruiser num processo filho). Ganhou limite próprio de 30 s, com comentário; a asserção não mudou.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- `@tecton/core`: `startDomainServer({ manifestPath, port, host, handlers, logger })` (lê e valida o manifest, cria o servidor, registra as rotas e escuta) e `loadDomainManifest(path)` (erro com todos os problemas e linhas). É o walking skeleton de todo domínio gerado.
- Templates `packages/cli/templates/domain/`: `tecton.yaml` (versão atual do manifest, `version: 0.1.0`, descrição de exemplo, `actions: []`, `events` vazio, `dependencies: []`), `package.json` (`@<workspace>/<domínio>`, scripts `build`/`start`, `@tecton/core` e `@tecton/manifest`), `tsconfig.json` e `src/main.ts` (chama `startDomainServer`; `PORT` lido direto até o `ConfigProvider` da 3.1).
- Renderização de templates extraída para `src/templates.ts` (compartilhada por `new` e `generate`), com `versionSpec`/`linkSpec`.
- `findWorkspace(cwd)` sobe diretórios até um `package.json` que declare `@tecton/cli` e tenha `apps/domains`; os domínios seguem o modo de dependência do workspace (versão ou `link:` para o mesmo checkout).
- `tecton-admin generate domain <names...> [--from <file>]`: valida tudo antes de escrever (kebab-case, repetição na lista, já existente) e lista todos os problemas sem criar nada; funciona de subdiretórios do workspace; fora de workspace aponta para `tecton-admin new`; a saída lembra o agente de atualizar a seção marcada do `AGENTS.md`.
- Lint: aviso `agents-md-divergence` (código novo) para domínio sem entrada na seção, entrada sem manifest, dependências diferentes ou YAML inválido; arquivo `AGENTS.md`, linha do marcador; também no `--format json`; não muda o código de saída.
- Testes: 23 novos (3 do `startDomainServer`, 12 do `generate domain`, 6 da seção do `AGENTS.md`, +1 de JSON pelo CLI, +1 lento); suíte rápida 264 verde. O teste lento gera um workspace ligado a este checkout, gera `finance`, acrescenta uma action, instala, builda com Turborepo, sobe o serviço numa porta livre e recebe 501. Build, typecheck, `check:deps`, `lint:examples`, `validate:asyncapi` e `test:generation` verdes.

### File List

- `packages/core/src/domain-server.ts`, `domain-server.test.ts` (novos); `packages/core/src/index.ts` (modificado)
- `packages/cli/templates/domain/{tecton.yaml,package.json,tsconfig.json,src/main.ts}` (novos)
- `packages/cli/src/templates.ts`, `workspace.ts`, `commands/generate-domain.ts`, `commands/generate-domain.test.ts` (novos)
- `packages/cli/src/cli.ts`, `commands/new.ts`, `commands/new.generation.test.ts` (modificados)
- `packages/manifest/src/lint/agents-document.ts`, `agents-document.test.ts` (novos); `lint/lint-workspace.ts`, `types.ts` (modificados)
- `tools/check-deps/check-deps.test.ts` (modificado: limite de tempo próprio)

## Change Log

- 2026-10-12: Story 1.10 implementada: `tecton-admin generate domain` (vários nomes ou `--from`, tudo ou nada), walking skeleton executável e aviso de divergência do `AGENTS.md` no lint.
- 2026-10-15: Code review do Epic 1 — 5 correção(ões) aplicada(s) (ver Review Findings); status → done.
