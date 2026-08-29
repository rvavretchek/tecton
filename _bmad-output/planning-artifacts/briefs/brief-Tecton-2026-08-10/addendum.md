---
title: Addendum — Product Brief: Tecton
status: draft
created: 2026-08-10
updated: 2026-08-11
---

# Addendum: Tecton

Conteúdo levantado na sessão de `bmad-party-mode` de 2026-08-10 que aprofunda o brief mas não cabe nele.

## Correção de framing (histórico)

Uma versão inicial desta sessão confundiu o Tecton com **Aether**, outro projeto do autor, descrevendo por engano um framework *monolítico*. Isso foi corrigido: Tecton é modular orientado a microsserviços por domínio; Aether é um projeto separado (framework monolítico). Não confundir os dois. O Aether é citado apenas uma vez, como referência de UX: o autor já está desenvolvendo lá uma interface *drag-and-drop* estilo Novell NetWare/NDS 4.1 para gestão de usuários/grupos, que inspira (mas não necessariamente compartilha código com) o core de objeto/diretório do Tecton.

## Correção: Valkey no lugar de Redis (achada durante a Arquitetura, 2026-08-28)

Toda menção a **Redis** como dependência de infraestrutura do próprio Tecton (Streams de eventos, rate limiting do gateway, `TokenRevocationStore`, Dev Services) foi substituída por **Valkey** neste brief, no addendum e no PRD. Motivo: em 2024 a Redis Ltd. mudou a licença de BSD-3-Clause para SSPL/RSALv2; a comunidade forkou a última versão BSD como **Valkey**, doado à Linux Foundation, com os mesmos clientes Node (`ioredis`/`node-redis` conectam sem mudança) e sem gap de feature para o uso que o Tecton faz (só primitivos puros — Streams, chave-valor com TTL — nunca módulos do Redis Stack). Mesmo raciocínio já aplicado à troca Vault→OpenBAO: preferir o fork mantido por fundação sem risco de mudança de licença. Menções a "Redis" que descrevem a stack de **concorrentes** (Moleculer.js, NestJS microservices) na seção "O Que Torna Isto Diferente" não foram alteradas — são fatos sobre terceiros, não escolha do Tecton.

## Por que não "monólito primeiro" aqui

A analista (Mary) defendeu, e a mesa validou, a tese "Monolith First": para sistemas greenfield, a melhor estratégia é desenvolver monoliticamente e só migrar para microsserviços por domínio se surgirem problemas reais de escalabilidade. O Tecton assume essa tese como premissa — ele não compete com "comece em microsserviços", ele existe para a etapa seguinte.

## Alternativas de aplicação-demo consideradas e rejeitadas

Antes de o autor esclarecer que não queria construir nenhum sistema de exemplo, a mesa propôs três domínios de referência para um case de portfólio "antes/depois":
- **A — Venda de ingressos com flash sale**: catálogo de leitura pesada + reserva de escrita pesada com controle de concorrência; gargalo clássico de pico ("drop das 10h"), fácil de medir com teste de carga.
- **B — E-commerce (catálogo + estoque + checkout)**: caso clássico (Black Friday), porém batido — todo blog de microsserviços usa esse exemplo.
- **C — Faturamento/billing por uso (metering)**: gargalo de volume de eventos, não de tráfego humano; mostra CQRS/event sourcing na prática; público mais técnico/nichado.

O autor rejeitou construir qualquer um dos três (nem "de brincadeira"): o objetivo é puramente conceitual, e os domínios embutidos do próprio framework (Tenant, Usuário/Grupo, Custodiante) já cumprem o papel de prova de arquitetura. C foi apontado como potencialmente útil como *padrão interno* do framework (ex.: para o próprio módulo de billing/uso, se um dia existir), não como app de demonstração.

## Detalhamento técnico: domínio Custodiante

- Aplica-se a sistemas single- ou multi-tenant, configurável no setup (criptografar tudo ou campos escolhidos — discussão em aberto).
- A chave de criptografia fica com o tenant/empresa, nunca com o fornecedor do framework — decisão de zero-trust explicitamente validada pelo especialista de segurança convidado à sessão (Vex).
- Guarda por limiar entre custodiantes: mínimo de 3, recuperável por quórum configurável (2/3, 3/3, 3/4, 4/4, 3/5, 4/5, 5/5... até um limite razoável).
- Operação normal (indisponibilidade/recuperação) não deve depender de acionar custodiantes a cada incidente — precisa se auto-recuperar, à semelhança do *unseal* do OpenBAO / Vault Enterprise (referência direta do autor).
- Ações sensíveis configuráveis (dump de dados, download de relatórios grandes ou de dados muito sensíveis) exigem aprovação x/n dos custodiantes.
- Decisão de engenharia (Vex + Amelia, confirmada pelo autor): **não reimplementar Shamir's Secret Sharing na unha** — o domínio Custodiante é uma camada de integração + workflow declarativo sobre um cofre auditado existente (candidato inicial: OpenBAO; outros candidatos: Vault Enterprise, HSMs), nunca o cofre em si. A interface (`KeyCustodyProvider`) deve ser agnóstica de fornecedor.
- "Seguro à prova de balas e auditável" (exigência explícita do autor) significa aprovação **criptograficamente forçada** — envelope encryption por recurso/lote, chave de dado embrulhada pela chave mestra do tenant, só desembrulhável combinando o quórum real de fragmentos — mais log de auditoria encadeado/assinado (hash-chain) para que nem um admin com acesso total consiga reescrever o histórico. Um gate de workflow simples (aprovação clicada, sem reforço criptográfico) foi descartado como insuficiente.
- A interceptação da aprovação precisa acontecer no nível de acesso ao dado, não apenas no nível de rota HTTP — alerta do Vex: um middleware só numa rota específica pode ser contornado por outro serviço, script de manutenção, ou acesso direto.
- Confirmado pelo autor: é item de **roadmap**, não MVP — mas o encaixe arquitetural (interface `KeyCustodyProvider`, anotação declarativa de quórum no manifest de domínio) precisa nascer no MVP para não exigir retrabalho do core depois.

## Princípio geral de escopo adotado

"Desenhar o encaixe agora, adiar a dor depois" — para qualquer item complexo do `Tecton.md` (não só Custodiante), o MVP prevê a interface/ponto de extensão declarativo, mas a implementação pesada de integrações externas fica pra roadmap. Confirmado pelo autor como regra geral a aplicar a outros itens complexos, em vez de decidir viabilidade item a item do zero a cada vez.

## Pesquisa competitiva pendente (não fechada nesta sessão)

O PM (John) alertou que o par "manifest declarativo + broker embutido" não é original — Moleculer.js e os *building blocks* do Dapr cobrem território semelhante; NestJS microservices module também é candidato a comparar. Antes de qualquer alegação pública de diferenciação, é preciso um comparativo técnico escrito explicando onde o Tecton diverge (hipótese de trabalho: migração assistida + legibilidade nativa para agentes de IA).

## Triagem completa do `Tecton.md` contra a Constitution (2026-08-10)

### Lista "Must" original

| Item | Veredito | Razão |
|---|---|---|
| API Gateway | MVP | Núcleo do framework, não infra externa — roteador leve embutido. |
| Service Discovery | MVP (leve) | Padrão estático/config por default; interface pluggable pra Consul/Eureka depois. |
| Comunicação Assíncrona | MVP (leve) | Transporte embutido simples por default atrás de um adaptador; Kafka/RabbitMQ via provider no roadmap. |
| Autenticação Centralizada | MVP | JWT/OAuth2 com libs maduras — barato e essencial. |
| DI/IoC | MVP | Container leve (Awilix-like). |
| Persistência por Serviço | MVP | Regra arquitetural, não infra — scaffolding impede import cruzado. |
| Resiliência (Circuit Breaker, Retry, Timeout, Bulkhead) | MVP parcial / roadmap o resto | Retry+timeout básico no MVP; circuit breaker/bulkhead sofisticado é roadmap com seam previsto. |
| Observabilidade Distribuída | MVP | OpenTelemetry maduro e barato; prova o "antes/depois" mesmo sem app de demo. |
| Config Externalizada | MVP (leve) | Env vars/arquivo primeiro; config server tipo Vault é roadmap (mesmo padrão de provider). |
| Deploy Independente | Roadmap (seam) | Serviços já nascem deployáveis separadamente; pipeline CI/CD completo não é prioridade solo. |
| Contract Testing | MVP — de graça | Sai do manifest declarativo: o contrato já existe, testar contra ele é geração, não trabalho novo. |
| Health Checks | MVP | Barato, padrão. |
| Monorepo (Turborepo/Nx) | Depende do repo — ver decisão específica abaixo | |
| TypeScript Full-Stack | MVP, quase inegociável | Tipos servem diretamente o objetivo 2 (IA-friendly). |

### "Should" e "Can"

| Item | Veredito | Razão |
|---|---|---|
| CQRS / Event Sourcing | Roadmap, opcional | Suportado, nunca obrigatório. |
| Saga | Roadmap (seam no MVP) | Importante pro Caso 1; interface de coordenador no MVP, implementação depois. |
| Embedded Servers | MVP | Óbvio (Fastify/Express embutido). |
| Compilação AOT | Roadmap | Não serve nenhum dos dois objetivos com força suficiente agora. |
| Dev Services (auto-provisionar infra) | MVP | Ganho de produtividade real e barato (objetivo 2). |
| Live Reload | MVP | Tooling já existente. |
| Continuous Testing | Roadmap | Legal, não crítico. |
| OpenAPI/AsyncAPI Generation | MVP | Mesma sinergia do Contract Testing — gerado a partir do manifest. |
| API Versioning | Roadmap | Não bloqueia nada agora. |
| MCP | Promovido — prioridade alta de roadmap | Materialização mais literal do objetivo 2 (agente operando o sistema em runtime). |
| Independent Model Evolution | Roadmap, vago | Precisa virar especificação antes de virar item. |
| Single-File Applications | Rejeitado | Contradiz a identidade "modular por domínio" (Constitution §1). |
| Kubernetes Native | Roadmap distante (seam) | Pesado demais pra prioridade solo agora. |
| UI Generation from Contracts | Promovido — sinergia forte | Gerar UI admin a partir do manifest, natural dado o core schema-driven com drag-and-drop. |
| External API Consumption | Roadmap | Genérico, sem urgência. |
| Chaos Engineering | Rejeitado por ora | Prematuro pra projeto solo de portfólio. |

### Monorepo (Turborepo/Nx) — decisão específica

A pergunta "monorepo de quê" tinha duas respostas possíveis com impacto real diferente:

- **Repositório do próprio framework Tecton** (pacotes `core`, `manifest`, `object-directory`, `providers`, `cli`): **fora do MVP**. Poucos pacotes no início, build rápido — pnpm workspaces puro basta. Aplicação do próprio princípio "desenhar o encaixe agora, adiar a dor depois": plugar Turborepo depois é config, não reforma.
- **Apps geradas pelo Tecton** (múltiplos serviços de domínio no mesmo repo do usuário final): **dentro do MVP do scaffold**. Impacto real e imediato — build/teste apenas do que foi afetado — e serve diretamente o objetivo 2: um agente de IA com o grafo de dependência do Nx/Turborepo sabe o raio de impacto real de uma mudança, em vez de rebuildar/testar tudo às cegas ou nada.

## Nota de processo: a "provocação" da Constitution

O aparecimento do arquivo `docs/aether-mvp-vision-decisoes.md` dentro de `docs/`, seguido da descoberta do documento de compatibilidade já criado do lado do Aether, foi uma provocação deliberada do autor — um teste de se a sessão seguiria a própria Constitution (que proíbe referenciar o Aether) ou cederia silenciosamente à conveniência. A mesa tratou como a Constitution manda: discussão explícita e emenda registrada (Constitution §1, exceção única para `docs/aether-tecton-compatibility.md`), não uma exceção silenciosa.

## Teste de mesa: 3 cenários de migração (2026-08-11)

A pedido do autor, antes de fechar o desenho do manifest/core/CLI, a mesa simulou 3 cenários reais contra tudo que havia sido decidido, pra ver se o design se sustenta.

**Cenário 1 (Caso 1) — Catálogo sufocando junto do Checkout**: e-commerce maduro, Catálogo (90% do tráfego, leitura) preso no mesmo processo que Checkout (escrita pesada, ACID forte), forçando escalar os dois juntos. `tecton-admin extract catalog` gera scaffold + fachada de roteamento no gateway (`/api/catalog/*`, `/api/search/*`) + export/import único das tabelas `products`/`categories`/`search_index`. Nenhuma action sensível, auth passa pelo gateway sem trabalho novo. Achado: declarar `objectClass` pro domínio Catálogo não fazia sentido — produto não é objeto de diretório.

**Cenário 2 (Caso 2) — Férias e Ausências**: legado sem documentação, PO conhece bem o domínio. `tecton-admin generate domain leave` (sem `extract` — não há código-fonte a migrar). Achado: pedido de férias precisa de aprovação do gerente — não é custódia de chave (Custodiante), é aprovação de negócio comum, e o framework não tinha nenhum primitivo pra isso. Validação positiva: "gerente aprova gente do seu time" funciona com o ACL aditivo já fechado, desde que a estrutura de equipe esteja representada como contenção na árvore (usuário dentro da OU do departamento).

**Cenário 3 (Caso 1) — Relatórios financeiros sufocando o processamento de transações**: fintech madura. `tecton-admin extract reporting`, `generateFinancialReport` marcada `sensitive.quorum: true` — exercita o Custodiante de verdade. Achado/validação: Relatórios não é dono dos dados que relata (pertencem a Transações/Contas); "persistência por serviço" proíbe acesso direto ao banco alheio — resolvido pelo mecanismo já existente de `events.consumes` + modelo de leitura local (sem precisar de CQRS/Event Sourcing completo no MVP). Isso vira o padrão oficial documentado para acesso cross-domain, em vez de cada dev inventar uma solução.

**Achados que exigiram correção/decisão**:
1. `objectClass` no manifest passou de implicitamente obrigatório para **explicitamente opcional** — só domínios que participam do core de diretório o declaram.
2. Framework ganhou um primitivo nativo de **aprovação simples** (`approval` no manifest, reaproveita ACL/árvore) para fluxos de negócio comuns, distinto do quórum do Custodiante (que é especificamente sobre custódia criptográfica). Processos mais complexos (paralelismo, compensação, espera durável) delegam a um motor externo via `WorkflowEngineProvider` (mesmo padrão de seam de sempre, unifica o antigo encaixe de coordenador de Saga) — candidato inicial **Temporal**, por ter SDK oficial em TypeScript e não prender a nuvem específica (ao contrário de AWS Step Functions) nem ser Java/BPMN-cêntrico (ao contrário de Camunda). Decisão final de motor em aberto.

Exemplos de referência atualizados: `docs/examples/tenant-domain-manifest-v0.yaml` (com `objectClass`, comentário de opcionalidade) e `docs/examples/leave-domain-manifest-v0.yaml` (sem `objectClass`, com `approval`).

## Decisão MCP por domínio (2026-08-11)

Aplicado o próprio critério do projeto ("é essencial? agrega valor real?"): MCP **não é essencial** ao funcionamento do framework — nenhum domínio depende disso pra operar — mas agrega valor real como diferencial ligado ao objetivo 2. Veredito: **100% roadmap, zero escopo de MVP dedicado**, porque o manifest declarativo já contém tudo que a geração futura vai precisar (actions → tools, objectClass → resources) sem nenhuma preparação extra.

Quando implementado (roadmap): tools geradas por padrão **somente leitura**; mutação exige opt-in explícito (`mcp.allowMutations`) — mesmo padrão de servidores MCP sérios de banco/infra. Ações `sensitive.quorum` chamadas via MCP **não executam sincronamente** — criam pedido pendente, o mesmo fluxo de aprovação x/n do Custodiante roda igual, só com mais uma origem possível (agente, não só API/UI) — não é um fluxo novo. Transporte: Streamable HTTP (spec MCP 2026-07-28), autenticação como resource server OAuth 2.1 validando o mesmo token do `AuthProvider`/gateway — um único modelo de segurança, não dois. Hospedagem: voto provisório do autor em **serviço dedicado** (isolamento de risco, coerente com a identidade "microsserviços por domínio" do próprio Tecton), a confirmar com evidência quando chegar a hora.

Motivação real de um agente chamar uma ação sensível via MCP (pergunta levantada pelo autor, respondida sem viés otimista): pedidos rotineiros porém sensíveis (ex.: atender solicitação de exportação de dados sob LGPD/GDPR), assistência de debugging/operação por um dev — e, igualmente importante de admitir, o mesmo vetor que um agente comprometido (prompt injection, jailbreak) tentaria para exfiltrar dado. É exatamente por isso que o quórum do Custodiante vale igual não importa quem chamou a ação.

## Estratégia de migração assistida — Caso 1 (2026-08-11)

Escopo definido com disciplina: a ferramenta **não tenta descobrir limites de domínio automaticamente** (problema de pesquisa não resolvido de forma confiável; prometer isso quebraria a primeira demo real) — assume que o dev já sabe o que extrair (é a premissa do próprio Caso 1) e cuida do **como**, usando o padrão Strangler Fig (Martin Fowler). `tecton-admin extract <domínio>` gera: (1) scaffold do domínio novo a partir de uma descrição fornecida pelo dev; (2) configuração de fachada/roteamento parcial no gateway (por rota, percentual ou flag); (3) script de export/import único (via Prisma) para as tabelas que o dev apontar. Sincronização contínua (dual-write/CDC) para corte sem downtime é roadmap explícito, não MVP — corte único com janela de manutenção é o caminho MVP.

## Formato de resposta e erro de API (fechado em 2026-08-11)

Princípio geral aplicado aqui como em tudo: se existe padrão consolidado, adotar em vez de inventar.

- **Sucesso**: payload puro, sem envelope — exatamente o `output` declarado pela action no manifest. Nenhum campo de metadado misturado no corpo.
- **Correlação**: via header `traceparent` (**W3C Trace Context**), não no corpo — é o mesmo padrão que o OpenTelemetry (já MVP) usa por baixo; o gateway já precisa propagar isso pra observabilidade funcionar, só decidimos expor o mesmo header na API pública em vez de inventar um `requestId` próprio.
- **Erro**: **RFC 9457 "Problem Details for HTTP APIs"** (sucessora da RFC 7807) — `type`, `title`, `status`, `detail`, `instance`, mais a extensão de comunidade `invalid-params` (array de `{name, reason}`) para erro de validação por campo, casando com o `input` tipado das actions no manifest.
- **Pendente de aprovação** (ação `sensitive`/quórum do Custodiante, inclusive via MCP): **não é erro** — `202 Accepted` dedicado, corpo `{ status: "pending_approval", requestId, pollUrl }`, nunca forçado dentro do formato de erro.

Isso fecha a última pergunta que estava em aberto no `docs/aether-tecton-compatibility.md` ("formato de erro, camada de validação") — propagado pros dois lados.

## Backlog do `Tecton.md` — Bloco A: plumbing de interoperabilidade (fechado em 2026-08-13)

### API Gateway

Mérito (Winston): estabelecer um limite claro de responsabilidade. Risco real (apontado pelo autor): garantir que esse limite continue sendo respeitado conforme o sistema evolui — gateways "finos" viram "gordos" com o tempo por acréscimos incrementais, não por decisão única.

**Escopo do gateway**: roteamento gerado das `actions` do manifest, validação de token (primeira linha — não a única, ver Zero Trust acima), rate limiting via Valkey (dependência já padrão, custo marginal baixo), propagação de `traceparent`.

**Explicitamente proibido no gateway** (lista do autor, adotada): circuit breaker; retries automáticos para operações mutáveis; cache de respostas; transformação de payload; agregação de múltiplos serviços; autorização baseada em regras de negócio.

**Mecanismo de enforcement** (não só documentação): `tecton-admin lint:gateway` — script Node/TS portável (agnóstico de CI por natureza, roda em qualquer plataforma via código de saída) que falha se o `package.json` do gateway importar dependência fora de uma allowlist ou um pacote de domínio específico. Template de CI gerado por padrão: **GitHub Actions** (Tecton é projeto público no GitHub). Outras plataformas (GitLab CI, CircleCI, Jenkins) via `tecton-admin generate ci <plataforma>`, roadmap sob demanda — não é caro por item, mas não há evidência de demanda pra cobrir todas dia 1. Extensão futura observada, sem virar escopo agora: `tecton-admin lint` pode virar guarda-chuva de outras checagens arquiteturais (ex.: um domínio nunca importa módulo interno de outro).

### Service Discovery

MVP: estático via variável de ambiente por domínio (`TECTON_SERVICE_<DOMÍNIO>_URL`), gerada pelo `tecton-admin new`/`generate domain` — sem descoberta dinâmica em runtime. **Correção sobre o `Tecton.md` original**: Consul/Eureka são soluções pré-Kubernetes; hoje, deploy em Kubernetes já tem discovery nativo via DNS de Service, sem componente extra. Interface `ServiceDiscoveryProvider` prevista para o roadmap (DNS do k8s), Consul/Eureka não são mais candidatos.

### Comunicação Assíncrona

Transporte: Valkey Streams (já decidido). Envelope de mensagem: **CloudEvents** (spec CNCF: `id`, `source`, `type`, `time`, `data`, `specversion`) em vez de formato próprio — mesmo princípio de adotar padrão existente do RFC 9457/W3C Trace Context. Garantia de entrega real do Valkey Streams: **at-least-once** via consumer groups — todo handler de `events.consumes` no manifest precisa ser **idempotente** por design (regra documentada, não detalhe escondido). Ordem garantida dentro de um stream (por domínio), não entre streams diferentes.

### Config Externalizada

MVP: env vars + `.env`, validado e tipado no startup (falha rápido se config estiver errada). Interface `ConfigProvider` (sem prefixo de projeto). **Correção do autor**: candidato de roadmap é **OpenBAO**, não Vault — mesma lógica já aplicada ao `KeyCustodyProvider` (OpenBAO entrega o mesmo núcleo do Vault Enterprise, de graça, fork open source mantido pela Linux Foundation desde a mudança de licença da HashiCorp em 2023). AWS Parameter Store/Secrets Manager como alternativa opcional pra quem já vive em AWS, atrás da mesma interface.

## Backlog do `Tecton.md` — Bloco B: resiliência e operação (fechado em 2026-08-13)

**Circuit Breaker/Retry/Timeout/Bulkhead**: não moram no gateway (proibido no Bloco A) — moram no `ServiceClient` gerado a partir de `dependencies` no manifest, usado quando um domínio chama outro sincronamente (exceção — o padrão é evento via CloudEvents/Valkey Streams). Retry+timeout são MVP: retry só em ação idempotente por natureza (leitura) ou mutação com `Idempotency-Key` explícito no header (mesmo padrão da API da Stripe) — nunca retry cego. Circuit breaker e bulkhead ficam roadmap, como middleware plugável no `ServiceClient` — candidato de biblioteca real: `opossum` (circuit breaker maduro para Node).

**Health Checks**: MVP, `/health`, `/ready`, `/live` gerados automaticamente por serviço — mesma convenção das probes de liveness/readiness do Kubernetes, então quando o roadmap de k8s chegar os endpoints já existem. `/ready` checa dependências reais (banco, Valkey); `/live` só confirma o processo de pé.

**Deploy Independente**: MVP entrega Dockerfile por domínio (seam, gerado junto com `generate domain`). Pipeline de CI/CD com versionamento/release independente por serviço é roadmap — evolução do template GitHub Actions do Bloco A.

**Kubernetes Native**: roadmap, agora com forma: `tecton-admin generate k8s` geraria Deployment/Service/NetworkPolicy por domínio a partir do que o manifest já declara (`dependencies` já informa quem cada domínio precisa poder chamar).

## Backlog do `Tecton.md` — Bloco C: padrões de dados avançados (fechado em 2026-08-13)

**CQRS/Event Sourcing**: CQRS leve já é nativo, sem feature nova — é o que o teste de mesa já validou com Relatórios: `events.consumes` + modelo de leitura local **é** separação leitura/escrita. Event Sourcing completo (log de eventos como fonte da verdade) é opcional por domínio (`persistence: eventSourced: true`), reservado para quem tem exigência real de reconstrução no tempo/trilha de auditoria imutável — o Custodiante já tem esse requisito por natureza (log encadeado/assinado), mesmo sem chamar de Event Sourcing. Ferramental de replay/snapshot é roadmap.

**Contract Testing — mecânica exata**: do lado de quem publica uma action, teste chama com input válido pelo schema e confere a resposta contra o `output` declarado. Do lado de quem consome evento, teste confere se o schema esperado ainda bate com `events.publishes` de quem publica — pega drift automaticamente. Mais simples que Pact (contract testing tradicional) porque o manifest já é o contrato compartilhado dos dois lados, sem arquivo de contrato separado a manter sincronizado. `tecton-admin test:contracts` roda isso.

**API Versioning / Independent Model Evolution**: os dois são o mesmo problema — resolvido junto. Postura padrão: evolução **aditiva** (nunca remove/renomeia campo existente de uma action, só adiciona opcional), regra barata e MVP. Versionamento explícito (nova action tipo `createTenantV2`, ou path `/api/v2/...`) só quando a mudança é genuinamente incompatível. Roadmap: detector automático de quebra de compatibilidade comparando duas versões do manifest — mesma família de ferramenta do `lint:gateway` (Bloco A), outro alvo.

## Backlog do `Tecton.md` — Bloco D: developer experience (fechado em 2026-08-13, último bloco)

**Embedded Server**: **Fastify**, decisão fechada (não "Fastify/Express"). Motivo: validação de schema JSON nativa, encaixe direto com `input`/`output` tipado do manifest; mais rápido que Express em benchmark (radix tree routing, schema compilado). Contras reais, admitidos sem venda de peixe: ecossistema menor que Express (o mais usado de Node há mais de uma década); modelo de encapsulamento de plugins é um gotcha documentado pra quem vem do Express (precisa de `fastify-plugin` pra furar de propósito); schema-first é mais rígido que a liberdade do Express. Mitigação: como o Tecton **gera** a rota a partir do manifest, o dev raramente escreve Fastify na mão — o argumento de "ecossistema menor" pesa menos que pesaria se fosse escrito à mão.

**OpenAPI, mecânica exata**: `actions` do manifest viram rotas Fastify com schema; `@fastify/swagger` gera o OpenAPI a partir desse mesmo schema de rota — zero gerador próprio, só conectar peça existente do ecossistema Fastify.

**AsyncAPI, mecânica exata**: sem plugin único dominante como o Fastify tem pro OpenAPI. O `events` do manifest (já em envelope CloudEvents) é transformado direto num documento AsyncAPI, validado com `@asyncapi/parser`. Menos automático que o OpenAPI, ainda barato.

**Dev Services**: `docker-compose.dev.yml` gerado por `tecton-admin new` (Valkey + banco escolhido) — simples e transparente, sem mágica escondida.

**Testes/CI (contexto diferente de Dev Services)**: **Testcontainers** (`testcontainers` no npm) — containers efêmeros descartados ao final de cada execução, para isolamento real de `test:contracts`/CI. Um é conveniência de loop de dev; o outro é isolamento de teste — ferramentas certas pros propósitos certos, não a mesma peça reaproveitada por preguiça.

**Live Reload**: `tsx watch` por serviço, orquestrado via `turbo run dev` (Turborepo, já decidido no scaffold gerado) — reaproveita o orquestrador de processos que o Turborepo já resolve, sem inventar um novo.

**Compilação AOT, Continuous Testing**: confirmados como roadmap, sem mudança — não servem os dois objetivos com força suficiente agora.

**UI Generation from Contracts, mecânica exata e honesta**: `objectClass.attributes` tipado gera formulário de edição via **`react-jsonschema-form`** (biblioteca real, gera form React a partir de JSON Schema) — **MVP**, barato. A **árvore com drag-and-drop ciente de ACL** não tem biblioteca de prateleira equivalente — "NDS-style tree" não é um problema resolvido no mercado — fica como **trabalho genuíno, roadmap**, admitido sem maquiagem (crédito à Sally por insistir nessa honestidade em vez de vender tudo como "gerado de graça").

**Correção de 2026-08-15 (achada durante o PRD)**: essa classificação como "trabalho genuíno do Tecton" contradizia uma decisão anterior do mesmo dia que dizia "drag-and-drop é entrega real de MVP". Resolvido com o autor: o Aether é produto mais leve e vai construir a UI *drag-and-drop* primeiro; o MVP do Tecton entrega a árvore só como navegação/leitura, prevendo o encaixe no schema/containment, e **reaproveita a implementação do Aether** num release posterior em vez de duplicar o trabalho. Não é mais "ninguém vai construir isso", é herança planejada entre os dois projetos — candidato de compartilhamento de código real (ver `docs/aether-tecton-compatibility.md`).

## Backlog do `Tecton.md` totalmente varrido (2026-08-13)

Todos os quatro blocos (A: plumbing de interoperabilidade; B: resiliência/operação; C: padrões de dados avançados; D: developer experience) estão fechados e registrados. Nenhum item do `Tecton.md` original ficou sem veredito — MVP, roadmap ou rejeitado, com razão registrada em cada caso. Não há mais bloqueio para avançar aos workflows formais do BMAD Method (PRD/Arquitetura), por decisão explícita do autor de só avançar depois de esgotar essa varredura.

## Zero Trust na comunicação interna (fechado em 2026-08-12/13)

Pergunta trazida pelo autor a partir do Aether: a comunicação interna front-back pode ser segura, e isso se agrava no Tecton (múltiplos saltos internos entre serviços). Existe forma de prever ZTA sem virar "pirâmide de Gizé"?

**Achado real**: a formulação anterior de auth ("cada serviço confia na assinatura sem chamar o Auth de volta") era ambígua — podia significar verificação criptográfica própria por serviço (seguro) ou confiança implícita num header pré-decodificado só por "vir de dentro da rede" (inseguro, o oposto de Zero Trust). Nunca tinha sido esclarecido.

**Decisão MVP (barata, resolve a ambiguidade)**: todo serviço verifica a assinatura do token **ele mesmo**, sempre — nunca aceita header pré-decodificado sem verificação própria. Toda chamada serviço-a-serviço (não só gateway→serviço) carrega uma credencial verificável, inclusive tráfego interno/leste-oeste — nasce de graça a partir do `dependencies` já declarado no manifest. Isso já aplica o princípio central do Zero Trust ("nunca confiar, sempre verificar" — referência: **NIST SP 800-207**) no nível que mais importa, a custo quase zero.

**Decisão roadmap (maturidade avançada, deliberadamente cara)**: mTLS entre todos os serviços via service mesh (Istio/Linkerd) ou identidade de workload (SPIFFE/SPIRE) — criptografia e autenticação no nível de transporte, exige operar um mesh inteiro. Kubernetes NetworkPolicies (contenção de raio de explosão na rede) entra como parte do item já existente "Kubernetes Native: roadmap distante".

Princípio adicionado como Constitution §9 (renumerando "Open source, sem pressa" para §10) — não negociável desde o início mesmo sendo barato, distinto da maturidade avançada que é roadmap.

## Estado ao final da sessão de 2026-08-11

Lista de discussão do dia **fechada por completo**: identidade do projeto (microsserviços por domínio, não monólito/Aether), objetivos, dois casos de uso, princípio "encaixe agora, dor depois", manifest declarativo v0 (com `objectClass` opcional e `approval`), core de objeto/diretório (Closure Table, ACL aditivo simples), domínios embutidos (Tenant, Usuário/Grupo, Custodiante), auth (`AuthProvider`, `TokenRevocationStore` Valkey-backed), ORM (Prisma), CLI v0 (`tecton-admin`), `WorkflowEngineProvider` (roadmap, candidato Temporal), MCP por domínio (roadmap, zero MVP), migração assistida Caso 1 (`extract`), formato de resposta/erro de API (RFC 9457 + Trace Context), e o protocolo de sincronização com o Aether (funcionando de verdade — já recebeu e aplicou uma crítica real). Elenco da sessão salvo como party reutilizável (`tecton-foundation`).

**Próximo passo natural**: não há mais item pendente da lista original — decidir se a sessão continua garimpando o restante do backlog do `Tecton.md` (resiliência avançada, deploy independente, etc.) ou avança para os workflows formais do BMAD Method (PRD/Arquitetura) a partir deste brief.

## Participantes da sessão

Sessão conduzida via `bmad-party-mode`, elenco avulso (sem memória de grupo salva): Mary (Analista), John (PM), Winston (Arquiteto), Sally (UX), Amelia (Dev), com a entrada ad hoc de Vex (Segurança) na discussão de custódia de chave, e Paige (Tech Writer) para consolidação final. Nenhum grupo de party foi salvo como padrão; oferta de salvar o elenco pode ser feita ao usuário no encerramento.
