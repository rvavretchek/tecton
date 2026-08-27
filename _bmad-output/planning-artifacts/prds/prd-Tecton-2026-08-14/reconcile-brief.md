---
title: Reconciliação Brief → PRD (Tecton)
created: 2026-08-27
purpose: Verificar se todo ponto substantivo do Product Brief (2026-08-10) está representado no PRD (2026-08-14), em qualquer forma (FR, Non-Goal, MVP Scope, Success Metric, Open Question, ou decisão explícita).
---

# Reconciliação Brief → PRD

Método: leitura integral de `brief.md` seção a seção, cruzando cada afirmação substantiva contra o PRD; confirmação por `grep` de termos-chave ausentes.

## Cobertura geral

A esmagadora maioria do brief está bem representada no PRD — manifest declarativo (FR-1–5), Core de Diretório (FR-6–8), domínios embutidos (FR-9–11), Auth/Zero Trust (FR-12–14), CLI (FR-15–18), interoperabilidade (FR-19–22), formato de API (FR-23–25), resiliência (FR-26–28), evolução de contrato (FR-29), DX (FR-30–31), toda a tabela "Fora por ora/Roadmap" do brief (consolidada em §6.2), e os dois `[ASSUMPTION]` do brief resolvidos em §10. O `.memlog.md` do PRD confirma que cada seção foi percorrida e validada com o autor.

Os gaps abaixo são os pontos que não encontrei representados em nenhuma forma no PRD — nem como FR, nem como Non-Goal, nem como item de MVP Scope/Out of Scope, nem como Open Question.

## Gaps encontrados

### 1. Seção inteira "O Que Torna Isto Diferente" — ausente do PRD (gap mais significativo)

O brief dedica uma seção completa (linhas 30-44) à pesquisa comparativa contra Moleculer.js, Dapr e NestJS microservices module, com fontes citadas e duas conclusões importantes:

- **Achado que confirma a tese**: nenhum dos três concorrentes oferece (1) ferramental de migração assistida a partir de monólito real, (2) core de diretório hierárquico com drag-and-drop, ou (3) domínio de custódia de chave por limiar — mais o framing de "agente de IA como consumidor de primeira classe do manifest", que nenhum concorrente adota.
- **Achado que valida a premissa do projeto**: o debate 2026 monólito-vs-microsserviços citando fontes externas (Encore/NestJS) sobre times revertendo para "modular monolith" — evidência externa pra tese "Monolith First" da Constitution §2.

Busquei `Moleculer`, `Dapr`, `NestJS` no PRD inteiro — zero ocorrências. Essa seção não vira uma FR (é framing de posicionamento, não requisito funcional), mas também não aparece em nenhum outro lugar esperado — não está na Vision (§1), não está nos Non-Goals (§5), não está em Open Questions (§9). O roadmap do brief menciona explicitamente "pesquisa formal de diferenciação competitiva vs. Moleculer/Dapr/NestJS microservices (feita em nível inicial, ver acima)" como item de roadmap — mas o "ver acima" aponta pra uma seção que o PRD não herdou, então o leitor do PRD isolado não tem como saber que essa pesquisa inicial já foi feita nem o que ela concluiu.

**Por que importa**: é exatamente o tipo de conteúdo qualitativo/competitivo que a estrutura de FRs tende a descartar silenciosamente — não é um requisito, é a resposta a "por que isso e não uma alternativa existente", que normalmente mora na Vision ou num Non-Goal ("Tecton não reinventa o que Moleculer/Dapr já fazem bem, mas preenche X que nenhum dos três cobre"). Recomendação: pelo menos uma frase de ponte na Vision (§1) ou um Non-Goal citando a pesquisa comparativa, com pointer pro brief pra detalhe.

### 2. Framing de compliance e mecanismo criptográfico do Custodiante — diluído a genérico

Brief (Solução, item 3): "Gerenciamento de Custodiantes — este último cuida de custódia de chave de criptografia **por limiar (estilo Shamir)**, com aprovação x/n criptograficamente forçada para operações sensíveis (dumps, relatórios grandes/sensíveis), **voltado a LGPD/GDPR/HIPAA**."

PRD (FR-11): "custódia de chave por limiar, integração com OpenBAO, aprovação x/n criptograficamente forçada, log de auditoria encadeado" — mantém "por limiar" e "x/n" mas **derruba a referência a Shamir** (o algoritmo/técnica específica) e **derruba inteiramente a motivação regulatória (LGPD/GDPR/HIPAA)**.

Busquei `Shamir`, `LGPD`, `GDPR`, `HIPAA` no PRD inteiro — zero ocorrências, em nenhuma seção (nem FR-11, nem Non-Goals §5, nem Open Questions §9, onde a Open Question #2 sobre "escopo de criptografia do Custodiante" seria o lugar natural de reancorar isso).

**Por que importa**: a motivação regulatória é o "porquê" de negócio do domínio Custodiante existir — sem ela, um leitor do PRD não sabe por que esse domínio embutido é considerado importante o suficiente pra reservar interface desde o MVP mesmo sem implementação real. Não é uma feature nova a adicionar, é contexto de justificativa que deveria sobreviver em pelo menos uma frase (FR-11 description ou Open Question #2).

### 3. "DI/IoC leve" — item de escopo MVP do brief sem representação no PRD

O brief lista, na seção Escopo (linha 58), como item explicitamente dentro do MVP: "...autenticação centralizada (libs maduras), **DI/IoC leve**, regra de persistência por serviço, observabilidade distribuída (OpenTelemetry), contract testing..."

Busquei `DI/IoC`, `IoC leve`, `injeção de dependência` no PRD inteiro — zero ocorrências. Não há FR, não aparece na lista consolidada de §6.1 MVP In Scope, não aparece em §6.2 Out of Scope, não aparece no Glossário.

**Por que importa**: é um item concreto do "Escopo (trilha MVP)" do brief — não uma nuance qualitativa, mas um compromisso de escopo que simplesmente não foi carregado nem para dentro nem para fora do MVP no PRD. Pode ter sido considerado "decisão de mecanismo, não comportamento observável" (como o PRD fez explicitamente com Fastify em §4.10), mas nesse caso falta a mesma nota explícita dizendo isso — hoje é um silêncio, não uma decisão registrada.

### 4. Nuance sobre compartilhamento de código Aether↔Tecton — comprimida

Brief (linha 68): "Compartilhamento de código real entre os dois só ocorre quando não gerar impacto arquitetural e trouxer ganho real (redução de esforço/padronização) — **decisão concreta fica para quando houver código suficiente dos dois lados para avaliar**."

PRD (§5 Non-Goals): "Tecton não é o Aether... nenhuma decisão de identidade ou framing do Tecton se apoia ou se confunde com o Aether, exceto os subsistemas explicitamente listados em `docs/aether-tecton-compatibility.md`."

O PRD preserva a distinção de identidade (correto, é o ponto principal), mas derruba o critério futuro de decisão sobre compartilhamento de código (quando/como essa avaliação vai acontecer). Severidade baixa — é uma decisão de processo futuro, não de escopo de produto — mas é um ponto concreto do brief sem eco no PRD.

### 5. (Baixa severidade, nota apenas) Exemplo ilustrativo do domínio "Relatórios" — perdido, mas sem perda de substância

Brief usa o domínio hipotético "Relatórios" como exemplo concreto de "domínio sem dados próprios que consome eventos de outros e mantém modelo de leitura local, em vez de acessar banco alheio" (linha 22). PRD FR-4 mantém a regra genérica ("Consumo de evento de outro domínio nunca acessa o banco desse domínio diretamente") mas sem o exemplo nomeado. Isso é compressão normal de FR (regra > exemplo) e não um gap de conteúdo — mencionado aqui só por completude, não requer ação.

## Itens verificados e confirmados como cobertos (não gaps)

- Fastify como servidor embutido e o trade-off explícito vs. Express — omitido do PRD **com nota explícita** em §4.10 ("Fastify é decisão de mecanismo, não comportamento observável novo") — decisão registrada, não um silêncio. Contraste com o item 3 acima (DI/IoC), que não tem essa mesma nota.
- Dois caminhos de adoção (Caso 1/Caso 2) — no Glossário §3 e nos JTBD/UJs de §2.
- Critérios de Sucesso `[ASSUMPTION]` do brief — resolvido em §7 Success Metrics.
- Visão de longo prazo `[ASSUMPTION]` do brief — resolvido em §10 Assumptions Index (aspiração mantida no brief, não virou meta do PRD, com justificativa).
- Toda a tabela extensa "Fora por ora/Roadmap" do brief — consolidada em §6.2 Out of Scope for MVP, item a item.
- Rejeitados (Single-File Applications, Chaos Engineering) — presentes em §5 e §6.2.

## Conclusão

O PRD é fiel ao brief na estrutura FR/Non-Goal/MVP Scope. Os gaps reais são pontualmente qualitativos: (1) a seção de diferenciação competitiva inteira (Moleculer/Dapr/NestJS) não tem eco em lugar nenhum do PRD, o que é o gap mais sério porque é "o que torna isto diferente" — exatamente o tipo de conteúdo que costuma se perder na tradução pra FRs; (2) a motivação regulatória (LGPD/GDPR/HIPAA) e o mecanismo nomeado (Shamir) do domínio Custodiante foram generalizados a ponto de perder a justificativa de negócio; (3) "DI/IoC leve" é um item de escopo MVP do brief que desapareceu sem registro explícito de inclusão ou exclusão; (4) a nuance sobre quando decidir compartilhamento de código com o Aether foi comprimida.
