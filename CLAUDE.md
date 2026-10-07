# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado do projeto

Este repositório está em **fase de planejamento/pré-código**: não há `package.json`, código-fonte, testes ou pipeline de build ainda. Não existem comandos de build/lint/test para documentar até que a stack seja escolhida e o scaffolding inicial seja criado — não invente comandos, verifique o que existe antes de assumir qualquer tooling.

O que existe hoje é uma instalação do **BMAD Method** (`_bmad/`) usada para conduzir o processo de descoberta, design e planejamento do produto antes da implementação.

**Onde o planejamento está (atualizado em 2026-10-01):** Product Brief (2026-08-10), PRD final com 31 FRs/8 NFRs (2026-08-14), Architecture Spine final com AD-1 a AD-10 + `UML.md` (2026-08-28; AD-10 de frontend `@tecton/ui` adicionado via Sprint Change Proposal de 2026-09-02), UX contract restrito ao admin do Directory Service (2026-09-03) e `epics.md` com 6 épicos cobrindo os 31 FRs (2026-09-04). **Ainda não há stories.** Sequência acordada: (1) quebrar os épicos em stories (step 3 do `bmad-create-epics-and-stories`, começando pelo Epic 1); (2) `bmad-check-implementation-readiness`; (3) `bmad-sprint-planning`; (4) implementação a partir da Story 1.1.

## Objetivo do produto

**Tecton** é um framework React.js + Node.js de uso geral, **modular orientado a microsserviços por domínio**, com dois objetivos que guiam toda decisão de escopo:

1. **Principal**: ser um projeto de portfólio interessante.
2. **Secundário**: reduzir o tempo de desenvolvimento de migrações para microsserviços por domínio — e ser um framework facilmente manipulável por agentes de IA (Claude Code, Codex, etc.).

Ver [`CONSTITUTION.md`](CONSTITUTION.md) (10 princípios, incluindo Zero Trust na comunicação interna) para os princípios não negociáveis do projeto e o [Product Brief](_bmad-output/planning-artifacts/briefs/brief-Tecton-2026-08-10/brief.md) (+ `addendum.md`, com o `.memlog.md` como histórico completo de decisões) para a visão completa. O backlog inteiro do `Tecton.md` original foi varrido e fechado em 2026-08-13 (manifest declarativo, core de diretório, domínios embutidos, auth/Zero Trust, CLI, migração assistida, formato de API, gateway/discovery/mensageria, resiliência, dados avançados e developer experience) — sem item pendente. Os workflows formais derivados do brief (PRD, Arquitetura, UX, épicos) já foram executados — ver "Onde o planejamento está" acima. Resumo: Tecton não é para começar um domínio do zero (monólito primeiro continua sendo a melhor estratégia greenfield) — é para portar um sistema já maduro, seja um monólito documentado sofrendo com escalabilidade, seja um legado sem documentação cujo PO conhece bem o domínio.

`Tecton.md` na raiz é um **brainstorm inicial não vinculante** — ponto de partida a podar/adaptar, nunca especificação fechada; itens dele ainda não triados contra os dois objetivos continuam em aberto (ver "Escopo" no Product Brief).

**Nota histórica**: uma versão anterior desta sessão descreveu por engano o produto como um framework monolítico chamado "Aether" — isso pertence a outro projeto do autor (framework monolítico, repositório irmão `../Aether`), e nunca deve ser confundido com o framing do Tecton. Os dois projetos compartilham autor e convergiram, de forma independente, em várias decisões de subsistema — isso é legítimo e está documentado em `docs/aether-tecton-compatibility.md`, o **único lugar sancionado** neste repositório para referenciar o Aether (ver `CONSTITUTION.md` §1). Não mencionar o Aether em nenhum outro arquivo do Tecton além de um ponteiro para esse documento.

## Convenções de idioma

- **Conversa e toda documentação de planejamento** (specs, PRDs, ADRs, comentários de planejamento, artefatos BMAD): **Português do Brasil**. Isso já está fixado em `_bmad/config.toml` (`document_output_language = "Português do Brasil"`) — não altere esse arquivo diretamente (é gerenciado pelo instalador BMAD); ajustes duráveis vão em `_bmad/custom/config.toml` ou `_bmad/custom/config.user.toml`.
- **Código e toda superfície voltada a dev/agente de IA**: **inglês**, sem exceção, quando a implementação começar. Isso inclui identificadores (variáveis, constantes, classes, funções, nomes de arquivo de código), comentários no código, texto de ajuda de CLI (`tecton-admin --help`, saída de terminal), logs internos/de operação, e documentação gerada automaticamente (ex.: OpenAPI/AsyncAPI a partir do manifest). O corte é "documentação de planejamento" vs. "qualquer coisa que vira parte do repositório de código/artefato entregável" — não "identificador vs. resto do código". Erro conhecido a evitar (já ocorreu em projeto paralelo do autor): comentário/log/texto gerado em PT-BR só porque a conversa que o produziu foi em português. Esse eixo rege o que o **Tecton** escreve ou gera; documentos que pertencem ao dev de um sistema construído com o Tecton (ex.: o `AGENTS.md` e o `README.md` do workspace dele, escritos por agente a partir de semente do framework) ficam no idioma que o dev escolher (Constitution §8, esclarecimento de 2026-10-07).
- **Mensagens e superfícies expostas ao usuário final de um sistema construído com o Tecton** (corpo de erro RFC 9457 `title`/`detail`, UI gerada — formulários, telas do Directory Service): **multi-idioma**, decidido na sessão de Arquitetura de 2026-08-28. O framework entrega Português do Brasil como padrão e inglês como secundário nas próprias superfícies (Directory Service, boilerplate de erro), e fornece a infraestrutura de i18n (catálogo de mensagens, negociação por `Accept-Language`, campo de extensão `i18nKey`) para o dev que usa o framework estender a domínios e idiomas próprios — nunca obrigatório para código de domínio de terceiros, só possível. Distinto do eixo anterior: a CLI fica de fora dessa regra (público é dev/agente de IA, não usuário final).

## Estrutura do repositório

- `_bmad/` — instalação do BMAD Method (agentes, skills, config). Gerenciado pelo instalador; não editar `_bmad/config.toml` diretamente.
- `_bmad-output/planning-artifacts/briefs/brief-Tecton-2026-08-10/` — Product Brief atual (`brief.md`, `addendum.md`, `.memlog.md` append-only com o histórico de decisões).
- `_bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/` — PRD final (`prd.md`, `addendum.md`, reviews e reconciliações).
- `_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/` — Architecture Spine final (`ARCHITECTURE-SPINE.md`, AD-1 a AD-10), `UML.md` (Markdown+Mermaid) e `reviews/`.
- `_bmad-output/planning-artifacts/ux-designs/ux-Tecton-2026-09-03/` — UX contract do admin do Directory Service (`DESIGN.md`, `EXPERIENCE.md`, `mockups/`).
- `_bmad-output/planning-artifacts/epics.md` — 6 épicos com mapa de cobertura de FRs; stories ainda não criadas. `sprint-change-proposal-2026-09-02.md` registra a correção que gerou o AD-10.
- `_bmad-output/party-mode/` — sessões e memória da mesa `tecton-foundation` (`bmad-party-mode`).
- `_bmad-output/{implementation,test}-artifacts/` — stories, sprint status e evidência de testes. Vazio até as stories serem criadas.
- `design-artifacts/{A-Product-Brief,B-Trigger-Map,C-UX-Scenarios,D-Design-System,E-Development}/` — pipeline do módulo WDS (design de produto/UX). Vazio até o primeiro workflow rodar.
- `docs/` — base de conhecimento do projeto referenciada pelos módulos BMAD (`project_knowledge`). Contém `aether-tecton-compatibility.md` (único lugar sancionado para referenciar o Aether — ver nota histórica acima) e `aether-mvp-vision-decisoes.md` (cópia de referência do documento de visão do Aether, mantida pelo autor). Também tem `examples/` (manifests `tecton.yaml` de exemplo) e `Novell NDS/` (referência visual do ConsoleOne para a árvore do Directory admin, citada no `EXPERIENCE.md`). `docs/Laboratório/` inteiro (documentação via symlink para a pasta irmã compartilhada entre projetos + script de reconstrução) é material do ambiente de desenvolvimento **do autor**: fica fora do Git de propósito (`.gitignore`), serve para consulta e uso durante o desenvolvimento aqui e nunca deve ser publicado. Quem usar ou alterar o Tecton no futuro monta o próprio ambiente e escreve a própria documentação de laboratório.
- `CONSTITUTION.md` — princípios não negociáveis do projeto.
- `Tecton.md` — brainstorm inicial não vinculante (ver acima).

## Fluxo de trabalho

O planejamento deste produto é conduzido através dos agentes e skills do BMAD Method (ex.: `bmad-agent-analyst`/Mary, `bmad-agent-pm`/John, `bmad-agent-architect`/Winston, `bmad-agent-ux-designer`/Sally, `bmad-agent-dev`/Amelia) e por sessões de `bmad-party-mode` reunindo múltiplas personas para decidir o que entra no MVP vs. roadmap. Ao decidir o que incluir no MVP, avalie cada funcionalidade candidata contra os dois objetivos do produto (portfólio + redução de tempo de desenvolvimento/fricção para agentes de IA) antes de aceitar algo só porque está listado em `Tecton.md`.
