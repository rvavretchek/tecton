---
name: 'Tecton Directory Service — Admin UI'
description: 'Tema default (Camada 0) do runtime @tecton/ui, consumido pela SPA administrativa do Directory Service'
status: final
created: '2026-09-03'
updated: '2026-09-04'
colors:
  background: '#FFFFFF'
  foreground: '#1E1E1E'
  muted: '#F4F4F5'
  muted-foreground: '#6B6B6B'
  border: '#D9D9D9'
  primary: '#0F4C81'
  primary-foreground: '#FFFFFF'
  selected-bg: '#DBE9FF'
  destructive: '#B3261E'
  destructive-foreground: '#FFFFFF'
typography:
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.4'
  label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.3'
  heading:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.25'
  mono:
    fontFamily: '"Cascadia Code", "SF Mono", Consolas, monospace'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.4'
rounded:
  sm: 4px
  md: 6px
  DEFAULT: 6px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '6': 24px
components:
  tree-node:
    foreground: '{colors.foreground}'
    fontFamily: '{typography.body.fontFamily}'
  tree-node-selected:
    background: '{colors.selected-bg}'
    radius: '{rounded.sm}'
  context-menu:
    background: '{colors.background}'
    border: '{colors.border}'
    radius: '{rounded.md}'
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.md}'
  button-secondary:
    background: '{colors.muted}'
    foreground: '{colors.foreground}'
    radius: '{rounded.md}'
  input:
    background: '{colors.background}'
    border: '{colors.border}'
    radius: '{rounded.sm}'
  form-field-error:
    foreground: '{colors.destructive}'
    fontFamily: '{typography.label.fontFamily}'
---

# Tecton Directory Service — Admin UI (DESIGN.md)

> Este DESIGN.md documenta a **Camada 0** (tema default) do runtime `@tecton/ui`, fixado pela AD-10 da [ARCHITECTURE-SPINE.md](../../architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md). Não há um design system de terceiros herdado (shadcn/MUI/etc.) — os tokens abaixo *são* o sistema, exportados como CSS custom properties. Qualquer dev/equipe pode sobrescrevê-los (Camada 0) ou substituir componentes inteiros via a porta `UiThemeProvider` (Camada 1) sem tocar neste documento; este é só o ponto de partida que o framework entrega.

## Brand & Style

Ferramenta, não produto de consumo — a mesma postura de um console de diretório clássico (NDS, Active Directory): denso o suficiente pra mostrar estrutura hierárquica sem enfeite, neutro o suficiente pra qualquer equipe sobrescrever com a própria identidade sem lutar contra decisões estéticas fortes do framework.

## Colors

- **`background`/`foreground`** — neutros de alto contraste (branco/quase-preto), base de qualquer tela do admin.
- **`muted`/`muted-foreground`** — cinza claro para chrome secundário (barra de busca, texto de anotação, estados vazios) — nunca para texto principal.
- **`border`** — divisórias entre painel de árvore e painel de detalhe, bordas de input.
- **`primary` (Azul `#0F4C81`)** — única cor de ênfase do tema default. Usada em botões primários (Salvar, Editar atributos) e implicitamente na `selected-bg`. Escolha neutra e amplamente testada para contraste AA — não é declaração de marca, é o que qualquer equipe troca primeiro ao aplicar a própria identidade.
- **`selected-bg`** — tom claro do primary, marca o nó selecionado na árvore. Nunca usado pra indicar erro, sucesso ou estado de permissão — só seleção.
- **`destructive`** — reservado a mensagens de erro de validação (RFC 9457 + `i18nKey`) e ações destrutivas futuras (fora do MVP, sem ação destrutiva hoje).

Modo escuro fora do MVP (decisão desta sessão) — arquitetura de tokens já suporta adicionar depois sem redesenho (bastaria um segundo conjunto `*-dark` ou um DESIGN.md irmão, per convenção do spec).

## Typography

Pilha de fontes do sistema operacional (`system-ui`) — sem custo de carregamento de fonte, consistente com a postura "ferramenta, não produto de marca". `mono` reservado a identificadores técnicos (UUID v7 de objeto, `objectClass` bruto) quando precisarem aparecer na UI — nunca em rótulo ou texto corrido.

## Layout & Spacing

Escala de 4px (`4/8/12/16/24`), suficiente pra um layout de dois painéis (árvore + detalhe) sem grade complexa. Sem breakpoint definido — Foundation em EXPERIENCE.md fixa desktop-first; responsividade mobile não é meta do MVP.

## Shapes

Cantos discretos (`sm` 4px pra inputs e realce de seleção, `md` 6px pra botões e o menu de contexto) — reforça a leitura de "ferramenta densa", não de app de consumo com cantos arredondados largos.

## Components

- **Tree node / tree node selected** — texto simples em `body`; nó selecionado ganha `selected-bg` com `radius.sm`, sem borda adicional.
- **Context menu** — fundo `background`, borda `border`, `radius.md`. Só os itens que o MVP tem (Ver detalhes, Editar atributos) — nenhuma affordance visual de arrastar (sem "grip handle", sem cursor `grab`).
- **Button primary/secondary** — `radius.md`; primary pra ação principal do painel (Salvar, Editar atributos), secondary pra Cancelar.
- **Input** — `radius.sm`, borda `border`; estado de erro substitui a borda por `colors.destructive` e mostra `form-field-error` abaixo do campo.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Usar `primary` só pra ênfase de ação/seleção | Introduzir uma segunda cor de destaque no tema default |
| Manter o menu de contexto restrito às ações que o MVP tem | Mostrar itens de menu esmaecidos/desabilitados sugerindo drag-and-drop futuro |
| Cantos discretos (`sm`/`md`) em toda a superfície | Usar `rounded.full` ou cantos largos — não é essa a leitura pretendida |
| Reservar `mono` pra identificador técnico (UUID, `objectClass`) | Usar `mono` em rótulo ou texto corrido |
| Tratar estes tokens como ponto de partida substituível | Assumir que esta paleta é a identidade visual final de qualquer sistema construído com Tecton |
