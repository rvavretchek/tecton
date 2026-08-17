# Tecton

Framework React.js + Node.js de uso geral, **modular orientado a microsserviços por domínio**.

> Status: planejamento (pré-código). Este README descreve a visão do produto tal como definida até agora; nada aqui é código funcional ainda.

## O que é

Tecton não é para começar um sistema do zero em microsserviços — a melhor estratégia para um domínio ainda não comprovado continua sendo o monólito. Tecton existe para a etapa seguinte: portar um sistema já maduro para uma arquitetura de microsserviços por domínio, seja porque um monólito documentado está sofrendo com custo/escalabilidade, seja porque um legado sem documentação tem um PO que conhece bem o negócio.

O núcleo do framework é um **manifest declarativo de domínio** (YAML/JSON) que descreve eventos, contratos e dependências e gera a interoperabilidade (mensageria, roteamento) sem código manual de integração — esse mesmo manifest serve como contrato legível por um agente de IA (Claude Code, Codex etc.) antes de qualquer alteração. Sobre um **core genérico de objeto/diretório hierárquico** (schema declarado, gestão por *drag-and-drop*, controle de acesso por herança, inspirado no NDS/NetWare), o framework já traz domínios embutidos comuns a qualquer sistema sério: Gerenciamento de Tenants, Gerenciamento de Usuários e Grupos, e (como extensão de roadmap) Gerenciamento de Custodiantes — custódia de chave de criptografia por limiar e aprovação criptograficamente forçada para operações sensíveis, voltado a LGPD/GDPR/HIPAA.

Projeto open source e gratuito, sem prazo — desenvolvido publicamente como prática e peça de portfólio; adoção real por terceiros é um ganho, não um requisito.

## Objetivos do projeto

1. **Principal**: ser um projeto de portfólio interessante.
2. **Secundário**: reduzir o tempo de desenvolvimento de projetos que precisam migrar para microsserviços por domínio, sendo um framework facilmente manipulável por agentes de IA.

## Documentação

- [`CONSTITUTION.md`](CONSTITUTION.md) — princípios não negociáveis do projeto.
- [`CLAUDE.md`](CLAUDE.md) — guia para agentes de IA trabalhando neste repositório.
- [`_bmad-output/planning-artifacts/briefs/`](_bmad-output/planning-artifacts/briefs/) — Product Brief e histórico de decisões de produto.
- [`Tecton.md`](Tecton.md) — brainstorm inicial, **não vinculante**: material bruto ainda a ser avaliado, não especificação.
- [`docs/aether-tecton-compatibility.md`](docs/aether-tecton-compatibility.md) — notas de compatibilidade com um projeto irmão do autor (único lugar deste repositório que trata desse assunto).

## Convenções de idioma

Conversa e toda documentação em Português do Brasil. Código e identificadores (variáveis, classes, funções etc.), quando a implementação começar, em inglês.
