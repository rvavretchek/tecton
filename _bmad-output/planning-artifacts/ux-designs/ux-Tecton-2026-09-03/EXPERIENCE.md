---
name: 'Tecton Directory Service — Admin Experience'
description: 'Navegação em árvore de objetos e edição de atributos via formulário gerado, escopo restrito ao /admin do Directory Service'
status: final
created: '2026-09-03'
updated: '2026-09-04'
sources:
  - '_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/UML.md'
  - '_bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md'
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-02.md'
---

# Tecton Directory Service — Admin Experience

> Escopo restrito (Proposta D do [Sprint Change Proposal](../../sprint-change-proposal-2026-09-02.md)): navegação de leitura na árvore de objetos + edição de atributo via formulário gerado. **Fora de escopo**: drag-and-drop (roadmap — PRD §6.2, reaproveita implementação do Aether), design de marca/identidade visual arbitrária, telas de domínio de negócio de terceiros. Este documento é a visão de longo prazo (North Star) reduzida ao que o MVP realmente entrega — as seções abaixo marcam claramente o que é MVP vs. roadmap onde a distinção importa.

## Foundation

Web, desktop-first — SPA hospedada em `/admin` e servida pelo próprio `@tecton/directory` (AD-10), sem app nativo. Sem UI system de terceiros herdado: o runtime `@tecton/ui` e seus tokens (`DESIGN.md`) são o sistema. Layout master-detail de dois painéis (árvore + detalhe) — ver Inspiration & Anti-patterns pro racional de por que segue o padrão de consoles de diretório clássicos.

Multi-tenant: cada Tenant é a raiz de uma árvore própria; um usuário autenticado só vê o Tenant ao qual pertence (herdado da Architecture Spine, AD-2/FR-9).

## Information Architecture

| Superfície | Alcançada por | Propósito |
|---|---|---|
| `/admin` (árvore + detalhe) | Login → redirecionamento automático (é a única superfície do MVP) | Navegar a estrutura do Tenant, ver e editar atributos de um objeto |

Superfície única no MVP — sem roteamento interno além de qual objeto está selecionado (estado de UI, não URL própria por objeto — ver Roadmap).

→ Referência de composição: `mockups/directory-admin.html` (gerado no Finalize a partir de `.working/flow-directory-admin-2026-09-03.excalidraw`). Spine vence em conflito.

## Voice and Tone

Microcopy funcional, sem tom de marca (voz/identidade vivem em `DESIGN.md`, que é deliberadamente neutro).

| Do | Don't |
|---|---|
| "Nenhum objeto selecionado" | "Ops! Parece que você ainda não escolheu nada 👀" |
| "Salvo." | "Sucesso! Suas alterações foram salvas com êxito." |
| "Não foi possível salvar. Tentando novamente." | "Erro 500: Internal Server Error" (nunca expor erro técnico cru — RFC 9457 `title`/`detail` já traduzidos, AD-6) |
| Mensagens curtas, sem emoji, sem exclamação | Tom "celebrativo" — isto é um console administrativo, não um produto de consumo |

## Component Patterns

Comportamental — especificação visual vive em `DESIGN.md.Components`.

| Componente | Uso | Regras comportamentais |
|---|---|---|
| Árvore de objetos | Painel esquerdo, única instância por SPA (AD-10: singleton `@tecton/ui`) | Expand/collapse por clique no chevron ou duplo-clique no nó. Clique único seleciona e carrega o painel de detalhe. Ícone por `objectClass` (Tenant, Grupo, Usuário, Custodiante — cada um visualmente distinto). Nó sem permissão de leitura (ACL) é **completamente invisível**, nunca aparece cinza/bloqueado (decisão desta sessão, consistente com Zero Trust — Constitution/AD-7: não revela existência do que o usuário não pode ver). |
| Busca da árvore | Topo do painel de árvore | Filtra por nome enquanto digita (debounce ~250ms). Ao achar, expande a árvore até o nó e faz scroll+destaque. Sem resultado: mensagem "Nenhum objeto encontrado para '{termo}'." — nunca lista vazia sem explicação. |
| Menu de contexto (clique direito) | Sobre qualquer nó da árvore | Mostra só as ações que o MVP tem: "Ver detalhes", "Editar atributos" (some se o usuário não tem permissão de escrita no objeto — nunca aparece esmaecido). **Nenhum item sugere arrastar/mover** — isso é roadmap (drag-and-drop, PRD §6.2). |
| Painel de detalhe (visualização) | Direita, ao selecionar um objeto | Lista de atributos rótulo/valor, somente leitura. Botão "Editar atributos" visível só se o usuário tem permissão de escrita nesse objeto (herança de ACL, FR-7). |
| Formulário de atributo (edição) | Direita, ao clicar "Editar atributos" | Gerado via `@rjsf/core` a partir do JSON Schema de `objectClass.attributes` (FR-8, AD-10) — nenhum campo escrito à mão pelo dev do domínio, reflete automaticamente qualquer atributo novo adicionado ao `objectClass` (FR-8). Rótulos e mensagens de validação são multi-idioma (PT-BR padrão, EN secundário via `Accept-Language`, `i18nKey` — FR-8/FR-24, AD-6). Botões Salvar/Cancelar. Cancelar descarta sem confirmação (objetos do Directory não têm exclusão em cascata acidental por essa tela; se o usuário errar um valor, corrige editando de novo — não há undo automático, mas também não há risco de perda de dado). |

## State Patterns

| Estado | Superfície | Tratamento |
|---|---|---|
| Carregando árvore | `/admin`, primeira carga | Placeholder de linhas (skeleton) no formato de árvore — não spinner genérico, pra já sugerir a estrutura que está vindo. |
| Árvore vazia | `/admin`, Tenant sem objetos além da raiz | "Nenhum objeto neste Tenant ainda." sem ação (criação de objeto por esta tela é roadmap — objetos embutidos nascem via processo de provisionamento do Tenant, fora do escopo desta UX). |
| Nenhum objeto selecionado | Painel de detalhe, estado inicial | "Selecione um objeto na árvore à esquerda." — sem botão, sem ilustração. |
| Busca sem resultado | Painel de árvore | "Nenhum objeto encontrado para '{termo}'." |
| Carregando detalhe | Painel de detalhe, ao trocar seleção | Skeleton de 3-4 linhas no formato rótulo/valor. |
| Falha ao carregar árvore/detalhe | Qualquer painel | Mensagem RFC 9457 (`title`/`detail`, já traduzida via `Accept-Language`) + botão "Tentar novamente". Nunca tela em branco sem explicação. |
| Erro de validação ao salvar | Formulário de atributo | Inline, abaixo do campo (`form-field-error` do DESIGN.md) — nunca só um toast genérico; o campo específico com erro fica visível e com foco. |
| Falha ao salvar (servidor/rede) | Formulário de atributo | Mensagem RFC 9457 acima do formulário + dados do formulário preservados (nunca perde o que o usuário digitou). |
| Somente-leitura (sem permissão de escrita) | Painel de detalhe | Mesmo layout do modo visualização; botão "Editar atributos" simplesmente não aparece — nunca aparece desabilitado com tooltip explicando (evita revelar granularidade de permissão além do necessário). |
| Nó sem permissão de leitura | Árvore | Invisível — não é um "estado" visível, é ausência (ver Component Patterns). |

## Interaction Primitives

**Mouse/teclado, sem drag.** MVP é clique único (seleção), duplo-clique/chevron (expand/collapse), clique direito (menu de contexto). Sem gestos de arrastar em lugar nenhum da árvore — nenhum cursor `grab`/`grabbing`, nenhuma drop-zone destacada ao passar sobre outro nó (racional completo em Inspiration & Anti-patterns).

- `Enter` ou clique — seleciona nó / confirma busca
- `→`/`←` — expande/colapsa nó focado (navegação por teclado na árvore, requisito de acessibilidade)
- `↑`/`↓` — move foco entre nós visíveis
- Clique direito ou tecla de menu de contexto — abre menu com ações disponíveis
- `Esc` — fecha menu de contexto / cancela edição em andamento
- `Tab` — ordem de leitura: busca → árvore → painel de detalhe → ações

**Banido no MVP:** qualquer drag-and-drop (mover objeto, arrastar pra grupo — roadmap explícito), infinite scroll na árvore (usar busca/filtro em vez de rolagem em árvores grandes), menu de contexto com item esmaecido sugerindo função futura.

## Accessibility Floor

Comportamental — contraste visual vive em `DESIGN.md` (paleta já verificada pra WCAG 2.2 AA).

- **WCAG 2.2 AA** em toda a superfície (decisão desta sessão).
- Árvore totalmente navegável por teclado (setas + Enter), sem depender de mouse — requisito direto da meta AA, também serve ao caso de uso "árvore grande" da Marina.
- Cada nó da árvore expõe `aria-expanded`, `aria-level`, `aria-selected`, `aria-posinset` e `aria-setsize` corretos (padrão ARIA Tree View) — leitor de tela anuncia posição na hierarquia e entre irmãos ("item 3 de 12"), não só o rótulo.
- Formulário de atributo: cada campo com `label` associado; erro de validação anunciado via `aria-live` (região polida) no momento em que aparece, não só visualmente.
- Foco visível (anel de foco em `{colors.primary}`) em todo elemento interativo — nó de árvore, botão, campo, item de menu de contexto.
- Menu de contexto abre com foco no primeiro item; `Esc` devolve foco ao nó de origem.

## Key Flows

### Flow 1 — Marina organiza acesso de um novo colaborador (visão MVP)

Marina, gerente de TI de uma empresa que acabou de migrar pra um sistema construído em Tecton, precisa confirmar o acesso de um usuário recém-importado ao grupo "TI".

1. Marina abre `/admin`. A árvore carrega mostrando o Tenant "Acme Corp" na raiz.
2. Ela digita "TI" na busca — a árvore expande até o Grupo "TI" e destaca o nó.
3. Clica no nó "TI" — o painel de detalhe mostra os atributos do grupo (Nome, Descrição, contagem de membros) somente leitura.
4. Ela clica "Editar atributos" — o painel vira formulário gerado via `@rjsf/core`. Ela ajusta a Descrição do grupo.
5. **Clímax:** clica "Salvar" — o painel volta pro modo visualização com o novo valor refletido imediatamente, sem reload de página. Marina confirma visualmente que a mudança pegou, sem precisar navegar pra fora da tela onde ela estava trabalhando.

Falha: se o salvamento falhar (rede/servidor), o formulário permanece com os dados que ela digitou e mostra a mensagem RFC 9457 acima — ela tenta salvar de novo sem perder o trabalho.

### Flow 2 — Busca numa árvore grande (o medo real da Marina)

Marina administra uma árvore com centenas de usuários importados de um sistema legado. Ela precisa achar um usuário específico sem expandir manualmente dezenas de grupos.

1. Ela digita o nome do usuário na busca do painel de árvore.
2. **Clímax:** em vez de precisar adivinhar em qual grupo o usuário está, a árvore se expande automaticamente pelos ancestrais até o nó do usuário e o destaca — ela vê exatamente onde ele vive na hierarquia (contexto que uma busca "plana" perderia) sem esforço manual de navegação.
3. Ela clica no resultado destacado e segue pro fluxo de visualização/edição normal.

Falha: nenhum resultado — mensagem clara ("Nenhum objeto encontrado") em vez de árvore que simplesmente não reage, evitando a sensação de função quebrada que faria Marina desistir (relato original dela sobre a experiência ruim do Active Directory antigo).

## Inspiration & Anti-patterns

- **Lifted from NDS (Novell Directory Services) / Active Directory:** o padrão master-detail (árvore + detalhe), ícone por tipo de objeto, clique direito como ponto de entrada de ação — linguagem visual e de interação que a protagonista já reconhece de experiência anterior.
- **Rejeitado deliberadamente no MVP — qualquer affordance visual de drag-and-drop:** cursor de arraste, drop-zone, item de menu "Mover para..." — tudo isso implica uma capacidade que o MVP não tem (PRD §6.2). Prometer visualmente o que não funciona é exatamente o cenário que faria a Marina desistir, por relato dela mesma sobre a experiência ruim do AD antigo.
- **Rejeitado — nó bloqueado/cinza pra objeto sem permissão:** ver Component Patterns (Árvore de objetos) pro racional de Zero Trust.
- **Rejeitado — confirmação "tem certeza?" ao cancelar edição:** edição de atributo é de baixo risco e reversível; confirmação desnecessária adiciona fricção sem proteger contra nada grave.

## Roadmap (fora do MVP, registrado pra não se perder)

- **Árvore com drag-and-drop ciente de ACL** (criar grupo, arrastar usuário pra dentro, gerenciar acesso visualmente) — visão completa relatada pela Marina; PRD §6.2 já planeja reaproveitar a implementação do Aether em vez de construir do zero.
- **Clique direito com ações completas** (mover, criar objeto filho, excluir) — hoje limitado a Ver detalhes/Editar atributos; expande junto com o drag-and-drop.
- **Deep-linking por objeto** (`/admin?object={id}`) — não solicitado ainda, possível melhoria incremental sem mudança de arquitetura.
