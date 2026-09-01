---
title: Review — ARCHITECTURE-SPINE.md vs. good-spine checklist
reviewed: ARCHITECTURE-SPINE.md (Tecton, initiative altitude, MVP completo FR-1..FR-31)
date: 2026-08-31
---

# Review: Architecture Spine — Tecton

## Veredito geral

A spine é sólida no núcleo (paradigma DOMA+Hexagonal, direção de dependência entre pacotes, formato de ID, eixo de i18n, Zero Trust são invariantes claras e verificáveis), mas o Capability → Architecture Map contém mapeamentos incorretos de "Governed by" em duas linhas, falta um AD para o divergence point mais explicitamente cobrado pelo PRD (limite do Gateway, FR-19/`lint:gateway`), e duas capacidades explicitamente "MVP in scope" no PRD (§6.1 — OpenTelemetry, container de DI) não aparecem em lugar nenhum da spine, nem como decisão nem como deferred.

---

## Achados, por severidade

### CRÍTICO — nenhum encontrado
Não há contradição de fato entre a spine e o PRD/Constitution, nem regra que quebre um invariante não-negociável (Zero Trust, persistência-por-serviço, etc. estão todos presentes em algum nível).

### ALTO

**H-1. Falta um AD para "Gateway nunca contém lógica de negócio/resiliência" (FR-19).**
FR-19 é um dos poucos requisitos do PRD com CI dedicado (`tecton-admin lint:gateway`, allowlist de dependência) justamente porque é um divergence point real: o gateway é gerado *dentro do repo do dev* (`apps/gateway/`, Structural Seed) e, ao contrário dos pacotes `@tecton/*`, é código editável pelo dev depois de gerado. Nada em AD-1..AD-7 impede um dev (ou um agente de IA) de adicionar circuit breaker, cache de resposta ou autorização por regra de negócio direto no gateway gerado — que é exatamente a lista de "nunca" do FR-19. AD-4 ("código gerado importa, nunca copia") só cobre pacotes do framework, não o conteúdo que o dev escreve dentro do app gerado.
Isso deveria virar um AD próprio (ex.: "AD-8 — Gateway é fino por regra arquitetural, não só por convenção") com Rule enforçável (a mesma allowlist do `lint:gateway`, elevada a invariante da spine, não só a uma feature de CLI).

**H-2. Duas linhas do Capability → Architecture Map citam um AD que não governa de fato a capacidade.**
- **4.6 Interoperabilidade** → "Governed by: AD-7, Consistency Conventions". AD-7 é Zero Trust; não diz nada sobre o limite do gateway (FR-19), sobre service discovery estático (FR-20) ou sobre "um stream por domínio" (FR-21, consequence explícita do PRD que preserva ordem causal — e que também não vira regra em lugar nenhum da spine, só aparece de passagem na tabela de Consistency Conventions como "CloudEvents sobre Valkey Streams", sem o "um stream por domínio, não por tipo de evento").
- **4.8 Resiliência e Operação** → "Governed by: AD-3". AD-3 é direção de dependência entre pacotes do framework — não tem relação nenhuma com FR-26 (retry seguro, nunca retry cego) nem FR-27 (health checks). Isso é citação por padrão de preenchimento, não mapeamento real.
Efeito prático: quem for implementar por essas duas features vai procurar a regra no AD errado e não vai achar — a spine não erra o conteúdo (que existe em algum grau no PRD), mas erra o apontamento de onde a regra vinculante mora.

### MÉDIO

**M-1. OpenTelemetry e DI/IoC (Awilix) — MVP in scope no PRD §6.1, ausentes da spine inteira.**
O PRD lista explicitamente, fora da numeração de features mas dentro do MVP scope: "Observabilidade distribuída via OpenTelemetry" e "DI/IoC leve: container de injeção de dependência tipo Awilix dentro de cada serviço de domínio". Nenhum dos dois aparece na tabela Stack, no Structural Seed, em nenhum AD ou em Deferred. Não é um caso de "safe to defer" — o PRD já decidiu que entra no MVP; a spine simplesmente não tem onde pousar essa decisão. Sem isso, dois domínios podem divergir em qual biblioteca de tracing/DI usar, ou se usam alguma.

**M-2. Valkey sem versão pinada, e não tratado como Deferred.**
A tabela Stack pina exatamente Node 24.x, TypeScript 6.0.3, Fastify 5.12.x, Prisma 7.8.x — mas Valkey aparece como "latest stable", sem número de versão e sem nota "verificar no início da implementação" (que é exatamente o tratamento dado ao React, movido para Deferred). Isso quebra a disciplina de pin da própria tabela sem justificativa equivalente — ou pina uma versão, ou move para Deferred com a mesma nota do React.

### BAIXO

**L-1. "Persistência por serviço / nunca acesso direto a banco de outro domínio"** é um dos invariantes mais fundamentais do produto (glossário do PRD, Constitution implícita), mas vive só como uma linha da tabela de Consistency Conventions, não como AD com Rule formal — inconsistente com o tratamento dado a invariantes de peso comparável (AD-1 a AD-7). Não é um gap de conteúdo (a regra existe e é razoavelmente clara), só de forma/proeminência.

---

## Itens do checklist que passam sem ressalva

- **Divergence points do núcleo** (paradigma, direção de dependência, formato de ID, i18n, Zero Trust) — fixados com Rules claras e verificáveis (AD-1, AD-3, AD-5, AD-6, AD-7).
- **Deferred é seguro**: todos os 7 itens deferidos (orquestração de deploy, topologia física de banco, `KeyCustodyProvider`/`WorkflowEngineProvider` reais, hosting de MCP, patch do React, circuit breaker/bulkhead) já têm a interface/ponto de extensão fixado onde importa (ex.: hexagonal já garante plugabilidade do `ServiceClient`) — nenhum deles deixaria duas implementações divergirem de forma incompatível se ficar em aberto.
- **Stack table plausível para ago/2026** (à parte M-2): Node 24 LTS, TS 6.0.3, Fastify 5.12.x, Prisma 7.8.x são plausíveis para a linha do tempo; nenhuma versão obviamente descontinuada ou inventada.
- **Greenfield/pré-código**: N/A, não há brownfield a ratificar.
- **Envelope operacional/deployment**: adequadamente coberto — não está silencioso. Dockerfile por domínio (FR-28) e health checks (FR-27) estão decididos; orquestração além disso (K8s, pipeline de release independente) está explicitamente em Deferred, espelhando o PRD §6.2 que já trata isso como roadmap deliberado. Isso satisfaz o critério do checklist mesmo sem uma seção dedicada de "Environments".

---

## Recomendação

Antes de promover esta spine além de `draft`:
1. Adicionar um AD para o limite do Gateway (H-1) — é o gap de maior risco prático, porque é o único caso em que código gerado permanece livremente editável pelo dev/agente e tem um "nunca" explícito no PRD.
2. Corrigir as duas linhas mal mapeadas do Capability → Architecture Map (H-2), inclusive adicionando a regra "um stream por domínio" nas Consistency Conventions.
3. Decidir onde pousam OpenTelemetry e o container de DI (M-1) — mesmo que seja só uma linha na Stack table com "biblioteca de referência, trocável via Provider".
4. Pinar ou deferir Valkey com a mesma disciplina do React (M-2).
