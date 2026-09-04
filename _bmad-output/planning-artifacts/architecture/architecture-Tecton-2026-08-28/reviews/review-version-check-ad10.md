---
name: 'review-version-check-ad10'
type: architecture-review
target: '_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#AD-10'
scope: 'AD-10 apenas — Node/Fastify/Prisma/Valkey/TypeScript já verificados em review-version-check.md, não repetidos aqui'
method: 'verificação web de tecnologia nomeada/implícita em AD-10'
created: '2026-09-02'
note: 'Executado inline pelo agente principal após duas tentativas de subagent em background falharem por rate-limit de sessão sem produzir achado.'
---

# Version Check — AD-10 (`@tecton/ui`)

## Achado 1 — `react-jsonschema-form` (nome usado no PRD/spine original) é o pacote npm ERRADO — abandonado desde ~2019

O pacote npm literal `react-jsonschema-form` está em v1.8.1, sem publicação há anos — abandonado. O projeto está vivo e ativamente mantido pelo `rjsf-team` sob o namespace `@rjsf/*`: `@rjsf/core`, `@rjsf/utils`, `@rjsf/validator-ajv8` (+ temas: `@rjsf/mui`, `@rjsf/chakra-ui` etc.), atualmente em v6.1.2 (upgrade pra v6 em 13/01/2026).

**Ação:** corrigido nesta sessão em `ARCHITECTURE-SPINE.md` e `UML.md` — toda referência trocada de `react-jsonschema-form` (nome do pacote abandonado) para `@rjsf/core` (pacote ativo), com nota explicando a diferença. **Pendência sinalizada ao usuário:** o PRD (`FR-8`, §4.10) e o Brief (Bloco D) ainda usam o nome antigo — como são fontes upstream da spine, a correção foi oferecida ao usuário em vez de aplicada silenciosamente.

## Achado 2 — Compatibilidade com React 19 não formalmente confirmada pelo mantenedor

`@rjsf/core` v6 declara `peerDependencies: { react: ">=18" }` — tecnicamente permite React 19 (`>=18` sem teto), mas o v6 upgrade em si foi sobre dropar suporte a React <18, não sobre validar contra o 19. Relatos da comunidade indicam uso sem problemas com React 19, mas não há anúncio formal do mantenedor. Risco baixo (peer dependency já permite instalar), mas real o suficiente pra não travar como certeza.

**Ação:** adicionado ao item "Versão exata de patch do React" em Deferred, já existente na spine — reconfirmar no início real da implementação.

## Achado 3 — CSS custom properties como mecanismo de tema

Segue padrão corrente e amplamente adotado para bibliotecas de componente tematizáveis (mesma abordagem usada por design systems maduros como Radix/shadcn) — nada a sinalizar, sem alternativa claramente superior para o caso de uso (tokens sobrescrevíveis sem exigir build step ou runtime CSS-in-JS).

## Achado 4 — Registro de slots substituíveis como padrão de customização

Padrão razoável e corrente para um framework de geração de código que precisa de um "escape hatch" estrutural sem forçar rewrite total — análogo a slots/render props já comuns no ecossistema React. Nenhuma convenção claramente superior identificada para esse caso de uso específico (framework code-gen, não app único).

## Veredito

Nenhum bloqueador de fundo — mas o Achado 1 era real e potencialmente custoso se não corrigido antes da implementação (instalar o pacote errado early on). Corrigido na spine/UML; PRD/Brief pendentes de decisão do usuário.
