# Tecton

Framework React.js + Node.js de uso geral, **modular orientado a microsserviços por domínio**.

> Status: início da implementação. O planejamento está concluído e o monorepo com os 8 pacotes existe (Story 1.1), mas os pacotes ainda não têm funcionalidade; ela chega story a story.

## O que é

Tecton não é para começar um sistema do zero em microsserviços — a melhor estratégia para um domínio ainda não comprovado continua sendo o monólito. Tecton existe para a etapa seguinte: portar um sistema já maduro para uma arquitetura de microsserviços por domínio, seja porque um monólito documentado está sofrendo com custo/escalabilidade, seja porque um legado sem documentação tem um PO que conhece bem o negócio.

O núcleo do framework é um **manifest declarativo de domínio** (`tecton.yaml`) que descreve actions, eventos e dependências e gera a interoperabilidade (mensageria, roteamento, OpenAPI/AsyncAPI) sem código manual de integração — esse mesmo manifest serve como contrato legível por um agente de IA (Claude Code, Codex etc.) antes de qualquer alteração. Um **Directory Service** pronto e configurável (schema declarado via `objectClass.attributes`, controle de acesso por herança, inspirado no NDS/NetWare/Active Directory) hospeda os domínios embutidos comuns a qualquer sistema sério — Tenant, Usuário/Grupo — e, como extensão de roadmap, Custodiante: custódia de chave de criptografia por limiar e aprovação criptograficamente forçada para operações sensíveis, voltado a LGPD/GDPR/HIPAA.

Projeto open source e gratuito, sem prazo — desenvolvido publicamente como prática e peça de portfólio; adoção real por terceiros é um ganho, não um requisito.

## Objetivos do projeto

1. **Principal**: ser um projeto de portfólio interessante.
2. **Secundário**: reduzir o tempo de desenvolvimento de projetos que precisam migrar para microsserviços por domínio, sendo um framework facilmente manipulável por agentes de IA.

## Desenvolvimento

Monorepo com **pnpm workspaces** (sem Turborepo nem Nx; o Turborepo é usado só nos workspaces gerados por `tecton-admin new`). Os pacotes ficam em `packages/`: `@tecton/manifest`, `core`, `providers`, `auth`, `directory`, `service-client`, `ui` e `cli`.

### Pré-requisitos

- **Node.js 24.7 ou superior, na linha 24** (`engines: >=24.7 <25`; o `pnpm install` falha fora dessa faixa). O arquivo `.node-version` indica a linha para fnm, nvm-windows, volta e o CI.
- **pnpm 12**, fixado no campo `packageManager` do `package.json`. O jeito mais simples é o Corepack: `corepack enable`.
- **Docker**, para os testes de persistência (usam Testcontainers).

### Comandos

| Comando | O que faz |
|---|---|
| `pnpm install` | Instala as dependências |
| `pnpm build` | Compila todos os pacotes com TypeScript 6.0.3 (`tsc -b`, build incremental por project references) |
| `pnpm typecheck` | Checa os tipos dos testes, que não entram no build |
| `pnpm test` | Roda os testes, exceto os de persistência |
| `pnpm test:persistence` | Roda só os testes de persistência, no banco indicado por `TECTON_TEST_DB` |
| `pnpm check:deps` | Verifica a direção de dependência entre os pacotes `@tecton/*` (AD-3 da Architecture Spine) com o dependency-cruiser |

### Test runner: Vitest

Escolhido porque roda TypeScript e ESM nativamente, sem etapa de build dos testes; filtra arquivos por padrão de nome, o que separa os testes de persistência sem configuração extra; convive com o Testcontainers e com o Playwright, previstos no Test Design para testes multi-serviço e E2E; e serve tanto ao backend quanto aos componentes React do `@tecton/ui`.

### Testes de persistência

- Todo teste que toca banco de dados se chama `*.persistence.test.ts`.
- O banco é escolhido por `TECTON_TEST_DB` (`postgres`, `mariadb` ou `mysql`; padrão `postgres`). No dia a dia, rode só em PostgreSQL.
- No CI, o job `persistence` roda esses testes nos três bancos, e o job `build-test` roda build, typecheck, testes e `check:deps`.

## Documentação

- [`CONSTITUTION.md`](CONSTITUTION.md) — princípios não negociáveis do projeto.
- [`CLAUDE.md`](CLAUDE.md) — guia para agentes de IA trabalhando neste repositório.
- [`_bmad-output/planning-artifacts/briefs/brief-Tecton-2026-08-10/`](_bmad-output/planning-artifacts/briefs/brief-Tecton-2026-08-10/) — Product Brief e histórico de decisões de produto.
- [`_bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md`](_bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md) — PRD (finalizado): 31 requisitos funcionais, escopo de MVP, métricas de sucesso.
- [`_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md`](_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md) — Arquitetura (finalizada): paradigma, invariantes, stack, convenções. Companion com diagramas UML (Markdown+Mermaid) em [`UML.md`](_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/UML.md) na mesma pasta.
- [`_bmad-output/planning-artifacts/ux-designs/ux-Tecton-2026-09-03/`](_bmad-output/planning-artifacts/ux-designs/ux-Tecton-2026-09-03/) — UX do admin do Directory Service (`DESIGN.md`, `EXPERIENCE.md`, mockup).
- [`_bmad-output/planning-artifacts/epics.md`](_bmad-output/planning-artifacts/epics.md) — 61 stories em 6 épicos cobrindo os 31 requisitos funcionais.
- [`Tecton.md`](Tecton.md) — brainstorm inicial, **não vinculante**: material bruto já totalmente triado (ver Product Brief), mantido só como referência histórica.
- [`docs/aether-tecton-compatibility.md`](docs/aether-tecton-compatibility.md) — notas de compatibilidade com um projeto irmão do autor (único lugar deste repositório que trata desse assunto).

## Convenções de idioma

Três eixos: **conversa e documentação de planejamento** (specs, PRDs, ADRs) em Português do Brasil; **código e toda superfície voltada a dev/agente de IA** (identificadores, comentários, CLI, logs internos) em inglês, sem exceção, quando a implementação começar; **mensagens e superfícies expostas ao usuário final** de um sistema construído com o Tecton (erros de API, UI gerada) em multi-idioma — Português do Brasil como padrão, inglês como secundário, extensível pelo dev. Detalhe completo em [`CONSTITUTION.md`](CONSTITUTION.md) §8.
