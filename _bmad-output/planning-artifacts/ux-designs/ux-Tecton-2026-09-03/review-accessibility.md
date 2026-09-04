---
name: 'review-accessibility'
type: ux-spine-review
target: ['DESIGN.md', 'EXPERIENCE.md']
method: 'lente de acessibilidade ad-hoc (WCAG 2.2 AA), executada inline pelo agente principal'
created: '2026-09-04'
---

# Accessibility Review — Tecton (Directory Service Admin UX)

## Veredito geral

**Adequado, com uma correção aplicada durante esta revisão.** A meta WCAG 2.2 AA declarada em `EXPERIENCE.md` está tecnicamente sustentável pela paleta de `DESIGN.md` (contraste verificado abaixo) e pelas regras de navegação por teclado já especificadas. Um padrão ARIA de árvore incompleto foi encontrado e corrigido inline.

## Contraste de cor (SC 1.4.3 / 1.4.11)

Calculado (relative luminance, fórmula WCAG) para as combinações carregadas de texto/UI da paleta `DESIGN.md`:

| Combinação | Contraste | Limiar aplicável | Resultado |
|---|---|---|---|
| `foreground` (#1E1E1E) sobre `background` (#FFFFFF) | 13.6:1 | 4.5:1 (texto normal) | ✅ |
| `muted-foreground` (#6B6B6B) sobre `background` | 5.33:1 | 4.5:1 (texto normal) | ✅ — no limite de folga, mas passa |
| `primary-foreground` (#FFFFFF) sobre `primary` (#0F4C81) — texto de botão | 8.86:1 | 4.5:1 | ✅ |
| `destructive` (#B3261E) sobre `background` — mensagem de erro | 6.53:1 | 4.5:1 | ✅ |
| `foreground` sobre `selected-bg` (#DBE9FF) — nó selecionado da árvore | 13.6:1 | 4.5:1 | ✅ |
| `primary` como anel de foco sobre `background`/`selected-bg` | 8.86:1 / 7.23:1 | 3:1 (SC 1.4.11, componente não-textual) | ✅ |

Nenhuma combinação carregada fica abaixo do limiar AA. `muted-foreground` é a mais próxima da margem (5.33:1 vs. 4.5:1 exigido) — folga pequena mas real; não recomendo escurecer mais só por precaução, já que qualquer ajuste futuro de marca (Camada 0 é substituível, per `DESIGN.md`) precisa reverificar esse token especificamente.

## Padrão ARIA de árvore (SC 4.1.2, 2.1.1)

**Achado corrigido durante esta revisão:** a especificação original de `EXPERIENCE.md` § Accessibility Floor citava `aria-expanded`, `aria-level` e `aria-selected` mas omitia `aria-posinset`/`aria-setsize` — sem eles, um leitor de tela anuncia o nó mas não a posição entre irmãos ("item 3 de 12"), informação padrão do ARIA Tree View Pattern (W3C APG) que usuários de leitor de tela esperam numa árvore de profundidade variável como a do Directory Service. Corrigido inline.

Navegação por teclado (`→`/`←`/`↑`/`↓`) já especificada corretamente cobre SC 2.1.1 (tudo operável sem mouse) para a árvore.

## Menu de contexto (SC 2.1.1, 2.4.3)

Equivalente de teclado pro clique direito já especificado ("Clique direito ou tecla de menu de contexto"), foco move pro primeiro item ao abrir e retorna ao nó de origem ao fechar (`Esc`) — cobre o requisito de operabilidade total por teclado e ordem de foco previsível.

## Formulário de atributo (SC 3.3.1, 3.3.2, 4.1.3)

Rótulo associado a cada campo, erro de validação anunciado via `aria-live` no momento em que aparece, foco move pro campo com erro — cobre identificação de erro (3.3.1), rótulos/instruções (3.3.2) e mensagens de status (4.1.3). Nenhum achado adicional.

## Fora de escopo desta lente

Movimento/animação (SC 2.3.3, `prefers-reduced-motion`) não se aplica — a spine não descreve nenhuma animação além de transição de estado padrão (skeleton → conteúdo), sem motion decorativo a avaliar. Modo escuro (contraste em tema escuro) fora do MVP por decisão já registrada — reavaliar quando o segundo conjunto de tokens for adicionado.
