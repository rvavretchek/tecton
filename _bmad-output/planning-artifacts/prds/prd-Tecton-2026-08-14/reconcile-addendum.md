---
title: Reconciliação — addendum.md (brief) vs. PRD Tecton
status: draft
created: 2026-08-27
---

# Reconciliação: `brief-Tecton-2026-08-10/addendum.md` → `prd-Tecton-2026-08-14/prd.md`

Verificação item a item de que toda decisão substantiva do addendum do brief chegou ao PRD em alguma forma (FR, Non-Goal, item de MVP Scope, Open Question, ou decisão explícita registrada).

## Método

Percorri o addendum seção por seção (framing/Aether, "monólito primeiro", apps-demo rejeitadas, domínio Custodiante, princípio de escopo geral, pesquisa competitiva pendente, triagem completa Must/Should/Can do `Tecton.md`, decisão de monorepo, nota de processo Constitution, teste de mesa dos 3 cenários, decisão MCP, estratégia de migração Caso 1, formato de resposta/erro de API, Blocos A–D fechados, Zero Trust) e cruzei cada decisão com o texto do PRD (Glossário, FRs 1–31, Non-Goals, MVP Scope in/out, Success Metrics, API Contracts, Open Questions).

**Conclusão geral**: cobertura é boa e, em vários pontos, o PRD é mais rigoroso que o mínimo esperado — nomeia bibliotecas reais em FRs (`@fastify/swagger`, `@asyncapi/parser`, `react-jsonschema-form`, `Testcontainers`, `tsx watch`/`turbo run dev`), preserva a correção tardia de 2026-08-15 sobre drag-and-drop/Aether, e reflete corretamente os 3 achados do teste de mesa (objectClass opcional, primitivo `approval`, padrão `events.consumes` + read model local para acesso cross-domain). Mas há lacunas reais, listadas abaixo.

## Itens confirmados como bem cobertos (não repetir análise)

- Framing Aether/monólito-primeiro → §2.2, §5 Non-Goals.
- Apps-demo rejeitadas → §5 Non-Goals.
- Zero Trust (decisão MVP + roadmap mTLS/mesh) → FR-12–14, Constitution §9 referenciada, §6.2 out-of-scope.
- `objectClass` opcional (achado do Cenário 1) → FR-2.
- Primitivo `approval` vs. quórum do Custodiante (achado do Cenário 2, ACL aditiva para "gerente aprova time") → FR-3, FR-7, FR-10, Glossário.
- Padrão `events.consumes` + read model local para acesso cross-domain (achado do Cenário 3, evita CQRS/ES completo no MVP) → FR-4, §4.9.
- `WorkflowEngineProvider`/Temporal → Non-Goals, Open Question 4, §6.2.
- Formato de resposta/erro de API (RFC 9457, `traceparent`, `202 Accepted`) → FR-23–25, fielmente reproduzido.
- Blocos A–D do `Tecton.md`: gateway fino + `lint:gateway` (FR-17, FR-19), service discovery estático (FR-20), CloudEvents/Redis Streams at-least-once + idempotência (FR-21), health checks (FR-27), Dockerfile por domínio (FR-28), `opossum` como candidato de circuit breaker (nota da FR-28), CQRS leve nativo (§4.9), evolução aditiva de contrato (FR-29), Dev Services/Testcontainers (FR-30–31), Fastify/OpenAPI/AsyncAPI/UI generation com nomes de biblioteca corretos (FR-5, FR-8).
- Correção de 2026-08-15 (drag-and-drop herdado do Aether, não mais "trabalho genuíno") → FR-8 Out of Scope, §6.2.
- Decisão de monorepo (framework vs. apps geradas) → §6.1 última linha.
- Custodiante como seam de MVP (interface `KeyCustodyProvider`, `sensitive.quorum` no manifest, sem implementação real) → FR-11, §6.2 com nota emocional preservada.

## Gaps encontrados

### Gap 1 — DI/IoC container (Awilix-like) ausente do PRD

A tabela de triagem "Must" do addendum lista **DI/IoC — MVP — "Container leve (Awilix-like)"** como item decidido e fechado, no mesmo nível de prioridade que Auth, Persistência por Serviço e Autenticação Centralizada (todos com FR dedicada no PRD). Busquei no PRD inteiro (Glossário, FRs 1–31, §6.1 In Scope) e **não há nenhuma menção a container de DI/IoC** — nem como FR, nem como linha de MVP Scope, nem como Provider na lista de interfaces (§8 Public Surface). É uma decisão MVP "Must" do addendum sem representação alguma no PRD. Deveria virar uma FR nova (provavelmente na Feature 4.1 Manifest ou numa feature de "Core/Runtime" ainda não nomeada) ou, no mínimo, uma linha explícita em §6.1.

### Gap 2 — Correção do ConfigProvider roadmap (OpenBAO, não Vault) desaparecida

O addendum registra uma correção específica do autor: "candidato de roadmap [para `ConfigProvider`] é **OpenBAO**, não Vault... AWS Parameter Store/Secrets Manager como alternativa opcional". O PRD trata o `KeyCustodyProvider` com esse mesmo cuidado (Non-Goals §5 cita OpenBAO explicitamente), mas **FR-22 (`ConfigProvider`) não menciona nenhum candidato de roadmap**, e §6.2 (Out of Scope) também não tem nenhuma linha sobre "config server externo" como item de roadmap — ao contrário de praticamente todo outro item triado no Bloco A, que ganhou uma linha própria em Out of Scope. Essa correção de mecanismo (Vault→OpenBAO) é boa candidata a **addendum.md desta PRD** já que é decisão de biblioteca, mas hoje não está em lugar nenhum, nem como nota de roadmap.

### Gap 3 — Alerta de Vex sobre interceptação no nível de acesso a dado (não só rota HTTP) ausente

Decisão de arquitetura levantada pelo especialista de segurança (Vex) durante o detalhamento do Custodiante: "a interceptação da aprovação precisa acontecer no nível de acesso ao dado, não apenas no nível de rota HTTP — um middleware só numa rota específica pode ser contornado por outro serviço, script de manutenção, ou acesso direto." Esse é um requisito não-funcional real para a futura implementação do `KeyCustodyProvider`/`sensitive.quorum`, mas **não aparece em FR-11, nem em Open Questions, nem em Out of Scope**. Como é mecanismo de uma feature que já é 100% roadmap (não MVP), é candidato natural para o **addendum.md desta PRD** (a ser criado) em vez do corpo do PRD — mas hoje não está registrado em lugar nenhum, e corre risco real de se perder antes da Arquitetura revisitar o Custodiante.

### Gap 4 — Pesquisa competitiva pendente (Moleculer.js/Dapr/NestJS) sumiu

O addendum registra explicitamente um item **não fechado**: o PM (John) alertou que "manifest declarativo + broker embutido" não é original (Moleculer.js, Dapr building blocks, NestJS microservices module) e que, antes de qualquer alegação pública de diferenciação, é preciso um comparativo técnico escrito. Isso é literalmente um item em aberto do processo de descoberta — mas **não aparece em §9 Open Questions do PRD**, nem em nenhum outro lugar. Diferente dos outros itens "em aberto" do addendum (todos os 4 que sobreviveram foram corretamente promovidos a Open Questions 1–4), este ficou pra trás. Deveria virar uma 5ª Open Question ou, no mínimo, uma nota em §7 Success Metrics (já que toca SM-3/portfólio).

### Gap 5 (menor) — "External API Consumption" não aparece no Out of Scope

Item do triage "Should/Can" do addendum, veredito "Roadmap — genérico, sem urgência". Todos os outros itens dessa mesma tabela (CQRS/ES, Saga, AOT, Continuous Testing, API Versioning, MCP, Independent Model Evolution, Single-File, Kubernetes Native, UI Generation, Chaos Engineering) têm representação explícita em FR ou em §6.2 Out of Scope / §5 Non-Goals. "External API Consumption" é o único que não tem nenhuma menção no PRD. Baixa severidade (item vago mesmo no addendum), mas quebra a cobertura 1:1 que o resto da tabela tem.

## Recomendação sobre addendum.md desta PRD

Este workspace de PRD (`prd-Tecton-2026-08-14/`) ainda não tem `addendum.md`. Pelo menos três blocos de conteúdo do addendum de origem são mecanismo-pesados demais para o corpo do PRD mas importantes o bastante para não desaparecer antes da Arquitetura:

1. Mecânica completa do MCP por domínio (leitura-só por padrão, `mcp.allowMutations`, fluxo de pending-approval via MCP reaproveitando quórum do Custodiante, transporte Streamable HTTP, OAuth 2.1 resource server) — hoje só a hospedagem (Open Question 3) sobreviveu no PRD; o resto do desenho mecânico de 2026-08-11 ficaria perdido se não for preservado em algum artefato.
2. Detalhamento do Custodiante (Gap 3 acima: interceptação no nível de dado; mínimo de 3 custodiantes e menu de quóruns 2/3...5/5; auto-recuperação estilo unseal do OpenBAO/Vault Enterprise; envelope encryption + hash-chain).
3. Correção do `ConfigProvider` (Gap 2 acima).

Sugiro criar `prd-Tecton-2026-08-14/addendum.md` com essas três seções antes de avançar para `bmad-architecture`, para que Winston não precise garimpar o addendum do brief original em busca de decisões já fechadas.

## Resumo executivo (para reply)

- Cobertura geral: sólida — 4 dos 4 achados do teste de mesa, os 3 formatos de resposta de API, e a quase totalidade da triagem Must/Should/Can dos 4 blocos do `Tecton.md` estão refletidos em FRs específicas.
- 4 gaps reais + 1 menor: (1) DI/IoC (Awilix-like) ausente por completo; (2) correção ConfigProvider→OpenBAO (não Vault) sumiu; (3) alerta de Vex sobre interceptação no nível de dado (não só rota HTTP) para o Custodiante ausente; (4) pesquisa competitiva pendente (Moleculer/Dapr/NestJS) não virou Open Question; (5, menor) "External API Consumption" não tem linha no Out of Scope.
- Recomendação: seed de um novo `addendum.md` para esta PRD com mecânica do MCP, detalhamento do Custodiante e correção do ConfigProvider, antes de seguir para Arquitetura.
