---
name: 'review-rubric'
type: ux-spine-review
target: ['DESIGN.md', 'EXPERIENCE.md']
method: 'rubric walker contra o good-spine checklist (references/validate.md), executado inline pelo agente principal'
created: '2026-09-04'
---

# Spine Pair Review — Tecton (Directory Service Admin UX)

## Overall verdict

Par de spines coerente e de escopo propositalmente pequeno (só a experiência do Directory Service, per Sprint Change Proposal). Duas quebras mecânicas de referência foram achadas e corrigidas durante esta própria passada (ver Mechanical notes) — nenhum achado de fundo (Pass 2) sobrevive além disso.

## 1. Flow coverage — strong

Fontes (Architecture Spine, UML, PRD, Sprint Change Proposal) não têm nenhuma UJ nomeada para o admin do Directory Service — UJ-1/2/3 do PRD são todas dev-facing (extract, generate domain, agente de IA lendo manifest), fora do escopo desta UX. Marina é uma protagonista nova, trazida pelo usuário nesta sessão, não um UJ pré-existente a mapear. Os 2 Key Flows (organizar acesso de colaborador; busca em árvore grande) têm protagonista nomeado, passos numerados, clímax e caminho de falha — nenhuma lacuna.

## 2. Token completeness — strong

Todos os 8 tokens de `colors`, 4 de `typography`, 2 de `rounded` e 5 de `spacing` no frontmatter são referenciados por pelo menos um componente ou seção de prosa; toda referência `{path.to.token}` em `components` resolve contra o frontmatter (conferido token a token). Sem hex faltando, sem par claro/escuro necessário (modo escuro fora do MVP, decisão registrada).

## 3. Component coverage — strong

Todo componente citado (árvore, busca, menu de contexto, painel de detalhe, formulário de atributo) tem linha em `DESIGN.md.Components` (spec visual) e `EXPERIENCE.md.Component Patterns` (regra comportamental) — nomes idênticos nos dois arquivos.

## 4. State coverage — strong

Superfície única (`/admin`) com 9 estados cobertos: carregando árvore, árvore vazia, nenhuma seleção, busca sem resultado, carregando detalhe, falha ao carregar, erro de validação, falha ao salvar, somente-leitura, nó sem permissão. Cobre os casos que a categoria de produto (console de diretório) tipicamente exige.

## 5. Visual reference coverage — adequate

Wireframe (`​.working/flow-directory-admin-2026-09-03.excalidraw`) existe e é referenciado pela IA ("→ Referência de composição"), mas o mock HTML de tela-chave (`mockups/`) ainda não foi gerado — pendente do próximo passo do Finalize (Key-screen mocks), não uma lacuna desta revisão.

## 6. Bloat & overspecification — adequate

EXPERIENCE.md mantém prosa funcional sem voz editorial (correto para o arquivo). Seção Roadmap é uma escolha deliberada (não é bloat) — mantém a visão de longo prazo da Marina registrada sem confundir com o escopo MVP, o que documentos-fonte não fariam por si.

## 7. Inheritance discipline — strong (após correção)

**Achado corrigido durante esta passada:** `EXPERIENCE.md` § Accessibility Floor citava `colors.primary` entre crases (prosa solta) em vez da sintaxe `{colors.primary}` exigida pelo spec pra cross-reference de token — corrigido inline antes deste relatório.

Nomes de componente idênticos entre os dois arquivos; `sources` do frontmatter resolvem todos (Architecture Spine, UML, PRD, Sprint Change Proposal existem e foram lidos).

## 8. Shape fit — strong

DESIGN.md: todas as 8 seções canônicas presentes, ordem correta (Elevation & Depth omitida deliberadamente — tema é MVP-simples, sem hierarquia de sombra, decisão implícita defensável). EXPERIENCE.md: todas as seções obrigatórias-por-padrão presentes; Inspiration & Anti-patterns incluída (correto — há referência de produto explícita, NDS/AD, e rejects registrados); Responsive & Platform omitida (correto — Foundation já declara desktop-first, sem breakpoint multi-superfície no MVP).

## Mechanical notes

- **Corrigido:** `EXPERIENCE.md` § Accessibility Floor — `colors.primary` entre crases → `{colors.primary}` (sintaxe de cross-reference).
- **Corrigido:** `EXPERIENCE.md` § Component Patterns, linha "Formulário de atributo" — faltava restatement do requisito i18n de FR-8/FR-24 (rótulos/validação multi-idioma) e do "reflete atributo novo sem código escrito à mão" (consequência testável de FR-8) — ambos adicionados.
- Nenhuma referência cruzada quebrada encontrada além das duas acima.
