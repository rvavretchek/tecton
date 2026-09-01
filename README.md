# Tecton

Framework React.js + Node.js de uso geral, **modular orientado a microsserviços por domínio**.

> Status: planejamento (pré-código). Este README descreve a visão do produto tal como definida até agora; nada aqui é código funcional ainda.

## O que é

Tecton não é para começar um sistema do zero em microsserviços — a melhor estratégia para um domínio ainda não comprovado continua sendo o monólito. Tecton existe para a etapa seguinte: portar um sistema já maduro para uma arquitetura de microsserviços por domínio, seja porque um monólito documentado está sofrendo com custo/escalabilidade, seja porque um legado sem documentação tem um PO que conhece bem o negócio.

O núcleo do framework é um **manifest declarativo de domínio** (`tecton.yaml`) que descreve actions, eventos e dependências e gera a interoperabilidade (mensageria, roteamento, OpenAPI/AsyncAPI) sem código manual de integração — esse mesmo manifest serve como contrato legível por um agente de IA (Claude Code, Codex etc.) antes de qualquer alteração. Um **Directory Service** pronto e configurável (schema declarado via `objectClass.attributes`, controle de acesso por herança, inspirado no NDS/NetWare/Active Directory) hospeda os domínios embutidos comuns a qualquer sistema sério — Tenant, Usuário/Grupo — e, como extensão de roadmap, Custodiante: custódia de chave de criptografia por limiar e aprovação criptograficamente forçada para operações sensíveis, voltado a LGPD/GDPR/HIPAA.

Projeto open source e gratuito, sem prazo — desenvolvido publicamente como prática e peça de portfólio; adoção real por terceiros é um ganho, não um requisito.

## Objetivos do projeto

1. **Principal**: ser um projeto de portfólio interessante.
2. **Secundário**: reduzir o tempo de desenvolvimento de projetos que precisam migrar para microsserviços por domínio, sendo um framework facilmente manipulável por agentes de IA.

## Documentação

- [`CONSTITUTION.md`](CONSTITUTION.md) — princípios não negociáveis do projeto.
- [`CLAUDE.md`](CLAUDE.md) — guia para agentes de IA trabalhando neste repositório.
- [`_bmad-output/planning-artifacts/briefs/brief-Tecton-2026-08-10/`](_bmad-output/planning-artifacts/briefs/brief-Tecton-2026-08-10/) — Product Brief e histórico de decisões de produto.
- [`_bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md`](_bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md) — PRD (finalizado): 31 requisitos funcionais, escopo de MVP, métricas de sucesso.
- [`_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md`](_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md) — Arquitetura (finalizada): paradigma, invariantes, stack, convenções. Companion com diagramas UML (Markdown+Mermaid) em [`UML.md`](_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/UML.md) na mesma pasta.
- [`Tecton.md`](Tecton.md) — brainstorm inicial, **não vinculante**: material bruto já totalmente triado (ver Product Brief), mantido só como referência histórica.
- [`docs/aether-tecton-compatibility.md`](docs/aether-tecton-compatibility.md) — notas de compatibilidade com um projeto irmão do autor (único lugar deste repositório que trata desse assunto).

## Convenções de idioma

Três eixos: **conversa e documentação de planejamento** (specs, PRDs, ADRs) em Português do Brasil; **código e toda superfície voltada a dev/agente de IA** (identificadores, comentários, CLI, logs internos) em inglês, sem exceção, quando a implementação começar; **mensagens e superfícies expostas ao usuário final** de um sistema construído com o Tecton (erros de API, UI gerada) em multi-idioma — Português do Brasil como padrão, inglês como secundário, extensível pelo dev. Detalhe completo em [`CONSTITUTION.md`](CONSTITUTION.md) §8.
