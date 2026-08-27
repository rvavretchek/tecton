# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado do projeto

Este repositório está em **fase de planejamento/pré-código**: não há `package.json`, código-fonte, testes ou pipeline de build ainda. Não existem comandos de build/lint/test para documentar até que a stack seja escolhida e o scaffolding inicial seja criado — não invente comandos, verifique o que existe antes de assumir qualquer tooling.

O que existe hoje é uma instalação do **BMAD Method** (`_bmad/`) usada para conduzir o processo de descoberta, design e planejamento do produto antes da implementação.

## Objetivo do produto

**Tecton** é um framework React.js + Node.js de uso geral, **modular orientado a microsserviços por domínio**, com dois objetivos que guiam toda decisão de escopo:

1. **Principal**: ser um projeto de portfólio interessante.
2. **Secundário**: reduzir o tempo de desenvolvimento de migrações para microsserviços por domínio — e ser um framework facilmente manipulável por agentes de IA (Claude Code, Codex, etc.).

Ver [`CONSTITUTION.md`](CONSTITUTION.md) (10 princípios, incluindo Zero Trust na comunicação interna) para os princípios não negociáveis do projeto e o [Product Brief](_bmad-output/planning-artifacts/briefs/brief-Tecton-2026-08-10/brief.md) (+ `addendum.md`, com o `.memlog.md` como histórico completo de decisões) para a visão completa. O backlog inteiro do `Tecton.md` original foi varrido e fechado em 2026-08-13 (manifest declarativo, core de diretório, domínios embutidos, auth/Zero Trust, CLI, migração assistida, formato de API, gateway/discovery/mensageria, resiliência, dados avançados e developer experience) — sem item pendente. Próximo passo em aberto: avançar para os workflows formais do BMAD Method (PRD/Arquitetura) a partir deste brief. Resumo: Tecton não é para começar um domínio do zero (monólito primeiro continua sendo a melhor estratégia greenfield) — é para portar um sistema já maduro, seja um monólito documentado sofrendo com escalabilidade, seja um legado sem documentação cujo PO conhece bem o domínio.

`Tecton.md` na raiz é um **brainstorm inicial não vinculante** — ponto de partida a podar/adaptar, nunca especificação fechada; itens dele ainda não triados contra os dois objetivos continuam em aberto (ver "Escopo" no Product Brief).

**Nota histórica**: uma versão anterior desta sessão descreveu por engano o produto como um framework monolítico chamado "Aether" — isso pertence a outro projeto do autor (framework monolítico, repositório irmão `../Aether`), e nunca deve ser confundido com o framing do Tecton. Os dois projetos compartilham autor e convergiram, de forma independente, em várias decisões de subsistema — isso é legítimo e está documentado em `docs/aether-tecton-compatibility.md`, o **único lugar sancionado** neste repositório para referenciar o Aether (ver `CONSTITUTION.md` §1). Não mencionar o Aether em nenhum outro arquivo do Tecton além de um ponteiro para esse documento.

## Convenções de idioma

- **Conversa e toda documentação de planejamento** (specs, PRDs, ADRs, comentários de planejamento, artefatos BMAD): **Português do Brasil**. Isso já está fixado em `_bmad/config.toml` (`document_output_language = "Português do Brasil"`) — não altere esse arquivo diretamente (é gerenciado pelo instalador BMAD); ajustes duráveis vão em `_bmad/custom/config.toml` ou `_bmad/custom/config.user.toml`.
- **Todo código e todo artefato gerado**: **inglês**, sem exceção, quando a implementação começar. Isso inclui identificadores (variáveis, constantes, classes, funções, nomes de arquivo de código), comentários no código, mensagens de log/erro, texto de ajuda de CLI, e documentação gerada automaticamente (ex.: OpenAPI/AsyncAPI a partir do manifest). O corte é "documentação de planejamento" vs. "qualquer coisa que vira parte do repositório de código/artefato entregável" — não "identificador vs. resto do código". Erro conhecido a evitar (já ocorreu em projeto paralelo do autor): comentário/log/texto gerado em PT-BR só porque a conversa que o produziu foi em português.

## Estrutura do repositório

- `_bmad/` — instalação do BMAD Method (agentes, skills, config). Gerenciado pelo instalador; não editar `_bmad/config.toml` diretamente.
- `_bmad-output/planning-artifacts/briefs/brief-Tecton-2026-08-10/` — Product Brief atual (`brief.md`, `addendum.md`, `.memlog.md` append-only com o histórico de decisões).
- `_bmad-output/{implementation,test}-artifacts/` — saída dos workflows BMAD ainda não executados (épicos/histórias, evidência de testes). Vazio até o primeiro workflow rodar.
- `design-artifacts/{A-Product-Brief,B-Trigger-Map,C-UX-Scenarios,D-Design-System,E-Development}/` — pipeline do módulo WDS (design de produto/UX). Vazio até o primeiro workflow rodar.
- `docs/` — base de conhecimento do projeto referenciada pelos módulos BMAD (`project_knowledge`). Contém `aether-tecton-compatibility.md` (único lugar sancionado para referenciar o Aether — ver nota histórica acima) e `aether-mvp-vision-decisoes.md` (cópia de referência do documento de visão do Aether, mantida pelo autor).
- `CONSTITUTION.md` — princípios não negociáveis do projeto.
- `Tecton.md` — brainstorm inicial não vinculante (ver acima).

## Fluxo de trabalho

O planejamento deste produto é conduzido através dos agentes e skills do BMAD Method (ex.: `bmad-agent-analyst`/Mary, `bmad-agent-pm`/John, `bmad-agent-architect`/Winston, `bmad-agent-ux-designer`/Sally, `bmad-agent-dev`/Amelia) e por sessões de `bmad-party-mode` reunindo múltiplas personas para decidir o que entra no MVP vs. roadmap. Ao decidir o que incluir no MVP, avalie cada funcionalidade candidata contra os dois objetivos do produto (portfólio + redução de tempo de desenvolvimento/fricção para agentes de IA) antes de aceitar algo só porque está listado em `Tecton.md`.
