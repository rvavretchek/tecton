---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted: ['step-01-detect-mode', 'step-02-load-context', 'step-03-risk-and-testability', 'step-04-coverage-plan', 'step-05-generate-output']
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-10-08'
workflowType: 'testarch-test-design'
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad/tea/config.yaml
  - .claude/skills/bmad-testarch-test-design/resources/knowledge/adr-quality-readiness-checklist.md
  - .claude/skills/bmad-testarch-test-design/resources/knowledge/nfr-criteria.md
  - .claude/skills/bmad-testarch-test-design/resources/knowledge/test-levels-framework.md
  - .claude/skills/bmad-testarch-test-design/resources/knowledge/risk-governance.md
  - .claude/skills/bmad-testarch-test-design/resources/knowledge/test-quality.md
---

# Test Design para Arquitetura: Tecton (MVP completo)

**Propósito:** preocupações de arquitetura, lacunas de testabilidade e requisitos de NFR que precisam estar resolvidos antes de escrever os testes de integração. Funciona como contrato entre o plano de testes e a implementação.

**Data:** 2026-10-08
**Autor:** Murat (Master Test Architect, BMAD TEA) para o Boss
**Status:** Revisão de arquitetura pendente
**Projeto:** Tecton
**Referência do PRD:** `_bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md`
**Referência das ADs:** `_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md` (AD-1 a AD-10)

---

## Resumo executivo

**Escopo:** MVP inteiro do framework: 31 FRs, 8 NFRs, 61 stories em 6 épicos (Manifest, Auth/Zero Trust, Interoperabilidade, Directory, Formato de API, CLI/DX).

**Contexto de negócio (PRD):**

- **Impacto:** projeto de portfólio (SM-3) e redução do tempo de migração de monólitos para microsserviços por domínio, validada pelas migrações do Arandu e do Tupã (SM-1, SM-2).
- **Problema:** cada migração reinventa interoperabilidade, identidade e Zero Trust; o Tecton entrega isso pronto a partir de um manifest declarativo.
- **Prazo:** sem data (Constitution §10); a implementação começa pela Story 1.1.

**Arquitetura (Spine):**

- **AD-7 (Zero Trust):** EdDSA + JWKS, verificação local em todo serviço, token de serviço em toda chamada leste-oeste, CloudEvents assinados pelo publicador, refresh opaco com rotação.
- **AD-1/AD-3 (Hexagonal + direção de pacotes):** núcleo depende só de portas; Awilix por serviço.
- **AD-2/AD-9 (Directory e isolamento):** Directory é serviço pronto com Closure Table e bag JSON; nenhum domínio lê banco nem código de outro.
- **Stack:** Node 24, TypeScript 6.0.3, Fastify 5.12, Prisma 7 (PostgreSQL, MariaDB, MySQL), Valkey 9.1, React 19, `@rjsf/core` 6, OpenTelemetry, Testcontainers.

**Escala esperada:** não definida. O PRD deixou orçamentos de desempenho para a Arquitetura (§9 OQ1), e a Spine não os fixou. A única pista de escala é "centenas de usuários importados" na árvore do Directory (Story 4.9).

**Resumo de riscos:**

- **Total:** 27 riscos
- **Score ≥ 6:** 14 riscos com mitigação obrigatória (nenhum com score 9)
- **Esforço de teste:** ~430–500 cenários, ~140–230 h (~3,5–6 semanas de tempo integral) para um dev solo com apoio de agente, distribuídas pelos épicos

---

## Guia rápido

### 🚨 BLOQUEIOS — decisões necessárias antes de prosseguir

**Caminho crítico pré-implementação.** Sem estes itens, os testes de integração dos épicos afetados não têm como ser escritos de forma determinística.

1. **ASR-1: porta `Clock` injetável.** `@tecton/providers` expõe uma porta de tempo, resolvida pelo Awilix, usada por todo cálculo de expiração (tokens, lockout, Idempotency-Key, pendência, retenção, cache). Necessária antes da Story 2.2. (Dono: Boss, no Test Framework e na Story 2.1.)
2. **ASR-6: canonicalização da assinatura de CloudEvent.** Definir a forma canônica (recomendação: JCS, RFC 8785) que o publicador assina e o consumidor verifica, com vetores de teste fixos. Necessária antes da Story 3.10. (Dono: Boss, no Create Story da 3.10.)
3. **ASR-7: semântica de ordem e completude do outbox.** O relay seleciona linhas pendentes ordenadas por sequência, nunca avança um watermark; o lock do relay tem fencing token. Necessária antes da Story 3.11. (Dono: Boss, no Create Story da 3.10/3.11.)

**O que se espera:** esses 3 itens decididos e registrados nas stories correspondentes (via Create Story) antes de implementá-las.

---

### ⚠️ ALTA PRIORIDADE — recomendação pronta, aprovação sua

1. **ASR-2: Toxiproxy como padrão de injeção de falha.** Uma fixture única para derrubar Valkey, JWKS, Directory ou monólito no meio do teste, cobrindo as três posturas do NFR-6. Aprovar no Test Framework.
2. **ASR-4: TLS do JWKS em teste.** Certificado autoassinado gerado na fixture, com CA confiável só no processo de teste; teste dedicado prova que `http` falha fora do modo dev. Aprovar no Create Story da 2.4.
3. **ASR-5: fábricas de dados + `tectonStack()`.** Fábricas por pacote que gravam via Prisma só em código de teste, e uma fixture que sobe Auth, Directory e Gateway com chaves e credenciais prontas, resolvendo a dependência cíclica Auth↔Directory. Aprovar antes do Epic 4.
4. **ASR-3: costuras de queda no relay e no consumidor.** Decompor em passos chamáveis isoladamente (preferível a hooks de teste no código de produção). Aprovar no Create Story da 3.11/3.12.
5. **R-16: single-flight do refresh na SPA.** Duas requisições paralelas que recebem 401 não podem disparar dois refresh, ou a detecção de reuso desloga o usuário. Aprovar no Create Story da 4.7.
6. **R-18: tabela de regras de compatibilidade.** Decidir como `test:contracts` trata enum estreitado, mudança de `format`, `nullable` e campo de `output` que vira opcional. Aprovar no Create Story da 5.8.

---

### 📋 SÓ INFORMAÇÃO — solução já definida

1. **Divisão de níveis:** Unit para lógica pura (manifest, ACL, compatibilidade, canonicalização); Integration com Testcontainers para tudo que toca Prisma, Valkey ou Fastify; API multi-serviço contra `tectonStack()` só para fluxos que atravessam serviços; Component e E2E só na SPA `/admin`.
2. **Ferramentas:** Vitest (unit, integration, component), Playwright + Playwright Utils (API multi-serviço e E2E), Testcontainers + Toxiproxy, axe para acessibilidade. Decisão final no Test Framework e na Story 1.1.
3. **CI em camadas:** PR em < 15 min (PostgreSQL); matriz de 3 bancos para testes `persistence`; nightly com E2E de UI, geração completa de workspace, Toxiproxy completo e imagens Docker.
4. **Cobertura:** ~430–500 cenários P0–P3 priorizados por risco.
5. **Quality gates:** P0 100%; P1 ≥ 95%; riscos de score 6 mitigados antes de fechar o épico; cobertura ≥ 80% nos pacotes de backend e ≥ 90% nos módulos de segurança e mensageria.

---

## Para arquitetura e dev — tópicos em aberto 👷

### Avaliação de riscos

**Total:** 27 riscos (14 com score ≥ 6, 10 médios, 3 baixos).

#### Alta prioridade (score ≥ 6)

| Risco | Cat | Descrição | P | I | Score | Mitigação | Dono | Prazo |
|---|---|---|---|---|---|---|---|---|
| **R-01** | **SEC** | Alguma borda pula a verificação Zero Trust (`/pending/*`, API da SPA, adaptador legado, consumidor de evento, endpoint dev) ou confia em header repassado | 2 | 3 | **6** | Varredura P0 gerada do manifest: toda action não pública sem token → 401; header forjado em cada borda | Boss | Epics 2–3 |
| **R-02** | **SEC** | Verificação de JWT falha: `alg` confusion (`none`/HS256), `kid` desconhecido forçando refetch em loop, JWKS por http ou redirecionado, `iss`/`aud` | 2 | 3 | **6** | Testes negativos com tokens forjados; refetch limitado | Boss | Epic 2 |
| **R-03** | **SEC** | Vazamento entre Tenants (listagem, busca, detalhe, export, pendência) | 2 | 3 | **6** | Suíte de isolamento com 2 Tenants em todo endpoint; 404 em vez de 403 | Boss | Epic 4 |
| **R-04** | **SEC** | ACL efetiva errada (grupos, containment aninhado) ou revogação que não alcança todos os afetados | 2 | 3 | **6** | Testes por propriedade contra oráculo de referência | Boss | Epic 4 |
| **R-05** | **DATA** | Outbox sob concorrência: sequência fora da ordem de commit (inversão ou perda, se houver watermark); líder antigo do relay enviando com lock expirado | 2 | 3 | **6** | ASR-7; teste com N transações paralelas; fencing token | Boss | Stories 3.10–3.11 |
| **R-06** | **DATA** | At-least-once/dedupe incorretos: chave antes do efeito, poison message travando o stream, dead-letter não acionada | 2 | 3 | **6** | ASR-3; testes de queda e de poison message | Boss | Story 3.12 |
| **R-07** | **SEC** | Canonicalização divergente: eventos válidos descartados em silêncio por ACK, ou bypass | 2 | 3 | **6** | ASR-6; vetores fixos | Boss | Story 3.10 |
| **R-08** | **TECH** | Portabilidade PG/MariaDB/MySQL (JSON como texto no MariaDB, isolamento padrão diferente, move na Closure Table, adapter-mariadb) | 3 | 2 | **6** | Job de matriz obrigatório para testes `persistence` | Boss | Desde a Story 1.1 |
| **R-09** | **SEC** | Postura de falha trocada (NFR-6): abre onde deveria fechar ou o rate limit fecha | 2 | 3 | **6** | Matriz Toxiproxy dependência × comportamento | Boss | Epics 2–4 e 6 |
| **R-10** | **SEC** | Registro automático do modo dev ou `auth bootstrap` alcançável em produção | 2 | 3 | **6** | Auth sem flag dev → endpoint 404; bootstrap sem banco local falha | Boss | Story 3.13 |
| **R-11** | **DATA** | `createUser` distribuído deixa usuário sem credencial ou credencial órfã | 2 | 3 | **6** | Falha injetada em cada etapa, verificando a compensação | Boss | Story 4.3 |
| **R-12** | **BUS** | `approval`: autoaprovação, `reportingChain`, permissão reconferida, decisão dupla concorrente, expiração | 2 | 3 | **6** | Testes de autorização + concorrência na decisão | Boss | Story 5.6 |
| **R-13** | **TECH** | Dependência cíclica Auth↔Directory e ordem de bootstrap; Directory como ponto único de falha do login | 3 | 2 | **6** | ASR-5; teste de ordem de subida | Boss | Epic 4 |
| **R-14** | **TECH** | Sem relógio injetável, testes de TTL lentos ou instáveis | 3 | 2 | **6** | ASR-1 | Boss | Stories 2.1–2.3 |

#### Média prioridade (score 3–5)

| Risco | Cat | Descrição | P | I | Score | Mitigação | Dono |
|---|---|---|---|---|---|---|---|
| R-15 | SEC | Idempotency-Key: corrida em andamento, escopo por sujeito, hash do corpo | 2 | 2 | 4 | Requisições paralelas no teste | Boss |
| R-16 | SEC | Refresh concorrente legítimo tomado como reuso | 2 | 2 | 4 | Single-flight na SPA; teste de refresh concorrente | Boss |
| R-17 | SEC | Enumeração de login por tempo ou pelo bloqueio | 2 | 2 | 4 | Paridade comportamental (hash fictício verificado) | Boss |
| R-18 | TECH | `test:contracts` com falso negativo | 2 | 2 | 4 | Tabela de regras, um caso por regra | Boss |
| R-19 | BUS | `extract`: drenagem, retomada sem duplicar, contagem | 2 | 2 | 4 | Monólito sintético | Boss |
| R-20 | OPS | Tempo de CI explode e o dev solo pula testes | 2 | 2 | 4 | Tags, paralelismo, geração completa só no nightly | Boss |
| R-21 | PERF | Sem SLO de latência nem orçamento de overhead | 2 | 2 | 4 | Definir limites; baseline no Epic 3 | Boss |
| R-22 | SEC | `X-Forwarded-For` falsificado contorna o rate limit | 2 | 2 | 4 | Teste com proxy confiável e não confiável | Boss |
| R-23 | SEC | XSS na SPA ou CSP quebrada | 1 | 3 | 3 | Payload de script + verificação de headers | Boss |
| R-24 | SEC | Retry cego de mutação no `ServiceClient` | 1 | 3 | 3 | Teste de "nenhum retry" | Boss |

#### Baixa prioridade (score 1–2)

| Risco | Cat | Descrição | P | I | Score | Ação |
|---|---|---|---|---|---|---|
| R-25 | TECH | Deriva de arquitetura (AD-1, AD-3, AD-8) | 1 | 2 | 2 | Monitorar (`check:deps`, checagem hexagonal, `lint:gateway`) |
| R-26 | OPS | Regressão de acessibilidade | 2 | 1 | 2 | Monitorar (axe no nightly) |
| R-27 | TECH | Colisão ou fallback errado de i18n | 1 | 2 | 2 | Monitorar (teste de consolidação) |

#### Legenda de categorias

- **TECH:** técnica/arquitetura · **SEC:** segurança · **PERF:** desempenho · **DATA:** integridade de dados · **BUS:** regra de negócio · **OPS:** operação

---

### Requisitos de testabilidade de NFR

| Categoria | Limite / requisito | Suporte no design | Lacuna / decisão | Evidência planejada |
|---|---|---|---|---|
| Segurança — autenticação | EdDSA, `exp`/`iss`/`aud`, access 15 min, service 5 min, refresh 7 d com rotação | Suportado (AD-7, Stories 2.2–2.7) | TLS do JWKS em teste (ASR-4) | Suíte `security` + varredura gerada |
| Segurança — autorização | `auth.requires`, `call:<domínio>`, ACL aditiva, isolamento de Tenant | Suportado (Stories 2.4, 2.7, 4.2, 4.4) | Oráculo de ACL para teste por propriedade | Suíte `security` + testes por propriedade |
| Segurança — segredos | Pepper ≥ 32 bytes, chave privada, hash, tokens nunca em log/span/erro | Suportado (2.1, 2.2, 3.1, 3.3) | — | Fixture global de varredura de saída |
| Segurança — posturas de falha | fail-closed (revogação, lockout, idempotência, JWKS, Directory no login, ponte legada); fail-open (rate limit); fail-fast (config) | Suportado (NFR-6) | Mecanismo de injeção de falha (ASR-2) | Suíte `failure-modes` |
| Confiabilidade — mensageria | At-least-once, dedupe após efeito, dead-letter após 5, ordem por stream | Parcial | Canonicalização (ASR-6), semântica do outbox (ASR-7), costuras de queda (ASR-3) | Suíte `messaging` com concorrência e queda |
| Confiabilidade — chamadas síncronas | Timeout 5000 ms, 3 tentativas com backoff, retry só seguro | Suportado (3.8, 3.9) | — | Suíte do `ServiceClient` |
| Portabilidade | PG, MariaDB, MySQL sem mudança de código | Suportado (job de matriz, Story 1.1) | — | JUnit por banco |
| Observabilidade | `traceparent` de ponta a ponta, `trace_id` em log | Suportado (3.3, 3.9, 3.10, 3.12) | — | InMemorySpanExporter |
| Desempenho | — | **UNKNOWN** | P95 por action via Gateway, overhead da verificação por requisição, vazão do relay, tempo de propagação da revogação, tamanho máximo de árvore na busca | Baseline sem gate até existir limite |
| Acessibilidade | WCAG 2.2 AA na SPA | Suportado (4.8–4.12) | — | Relatório axe |
| Manutenibilidade | AD-1, AD-3, AD-8 automatizados; cobertura | Suportado | Orçamento de tempo de CI | `check:deps`, checagem hexagonal, cobertura |

**Limites desconhecidos:** P95 de action via Gateway; overhead de verificação por requisição; vazão do relay e do consumidor; tempo de propagação da revogação; tamanho máximo de árvore para busca com ACL; orçamento de tempo de CI. Viraram o risco R-21. Não chutei valores.

**Fronteira da avaliação:** o PASS/CONCERNS/FAIL final fica com o `bmad-testarch-nfr`, quando houver evidência de implementação.

---

### Preocupações de testabilidade e lacunas de arquitetura

#### 1. Bloqueios ao feedback rápido

| Preocupação | Impacto | O que a arquitetura precisa entregar | Dono | Prazo |
|---|---|---|---|---|
| **Sem relógio injetável** (TC-1) | Testes de expiração esperam tempo real ou ficam instáveis | Porta `Clock` (ASR-1) | Boss | Antes da Story 2.2 |
| **Sem mecanismo de injeção de falha** (TC-2) | 9 stories com critério de fail-closed/fail-open sem teste determinístico | Fixture Toxiproxy (ASR-2) | Boss | Test Framework |
| **Pontos de queda inalcançáveis** (TC-3) | At-least-once não comprovável | Relay e consumidor decompostos (ASR-3) | Boss | Stories 3.11–3.12 |
| **JWKS só por https** (TC-4) | Testes de integração exigem TLS | Estratégia de certificado em teste (ASR-4) | Boss | Story 2.4 |
| **Sem semeadura de estado** (TC-5) | Ordem de bootstrap rígida e dependência cíclica tornam cada teste multi-serviço caro | Fábricas + `tectonStack()` (ASR-5) | Boss | Antes do Epic 4 |

#### 2. Melhorias de arquitetura necessárias

1. **Canonicalização da assinatura de CloudEvent (TC-6, ASR-6)**
   - **Problema atual:** a Spine (AD-7, decisão E1) e a Story 3.10 dizem "assinatura cobrindo envelope e dados", sem forma canônica.
   - **Mudança:** fixar o algoritmo de canonicalização (JCS, RFC 8785) e o conjunto exato de atributos assinados (excluindo o próprio `tectonsig`).
   - **Impacto se não corrigir:** como assinatura inválida vira ACK e descarte (FR-21), qualquer divergência de serialização entre publicador e consumidor apaga eventos em silêncio.
   - **Dono:** Boss · **Prazo:** Create Story da 3.10

2. **Semântica do outbox sob concorrência (ASR-7)**
   - **Problema atual:** a Story 3.11 diz "envia na ordem da sequência". Com transações concorrentes, a sequência é atribuída no insert e o commit pode chegar fora de ordem.
   - **Mudança:** o relay seleciona `WHERE published = false ORDER BY seq` a cada ciclo (nunca "maior que o último enviado"); documentar que a ordem garantida é a de commit visível ao relay; fencing token no lock do relay para que um líder antigo não marque nem envie depois de perder o lock.
   - **Impacto se não corrigir:** perda de evento (com watermark) ou inversão não documentada.
   - **Dono:** Boss · **Prazo:** Create Story da 3.10/3.11

3. **Single-flight do refresh na SPA (R-16)**
   - **Problema atual:** a Story 4.7 diz "chama `/auth/refresh` uma vez", mas não exige coordenação entre requisições paralelas nem entre abas.
   - **Mudança:** uma única promessa de refresh compartilhada por todas as requisições pendentes da aba; documentar o comportamento com várias abas.
   - **Impacto se não corrigir:** a detecção de reuso (Story 2.3) revoga a família e desloga o usuário.
   - **Dono:** Boss · **Prazo:** Create Story da 4.7

---

### Resumo da avaliação de testabilidade

#### O que já funciona bem

- ✅ Hexagonal + Awilix: toda infraestrutura atrás de porta; adaptador falso é natural.
- ✅ Tudo é headless: regra de negócio é action HTTP ou comando de CLI com `--format json`.
- ✅ Contratos são dados (JSON Schema draft-07, OpenAPI, AsyncAPI): oráculos determinísticos.
- ✅ Multi-tenant por construção: cada teste ganha o próprio Tenant, o que permite paralelismo.
- ✅ Observabilidade nativa (`traceparent`, `trace_id`, OTel).
- ✅ Testcontainers como requisito (FR-31) e job de matriz de bancos já previsto (Story 1.1).
- ✅ Abstração única de erro (Story 1.7): a troca para RFC 9457 é verificável num ponto só.
- ✅ Enforcement automático das fronteiras (`check:deps`, checagem hexagonal, `lint:gateway`).

#### Trade-offs aceitos (sem ação)

- **Bloqueio de conta alheia por senha errada** (Story 2.6): custo conhecido de contar por identificador; `auth unlock` mitiga.
- **Reuso de token de usuário por serviço comprometido** até expirar (Story 2.7): inerente à propagação; `call:<domínio>` limita o alcance.
- **Directory como ponto único de falha do login** (Story 4.4): consequência aceita da decisão de 2026-10-02.
- **Sem DR, failover, SLA de disponibilidade nem blue/green:** o Tecton é framework, não operação; esses critérios do checklist pertencem a quem opera o sistema construído.
- **`test:contracts` compara schemas, sem provedor rodando:** `--verify-providers` é roadmap (PRD §6.2).

---

### Planos de mitigação (score ≥ 6)

#### R-01: Borda pulando Zero Trust (score 6) — ALTO

1. Gerar, a partir dos manifests, uma suíte que chama toda action não pública de todo serviço sem token, com token de outro `aud` e com header de identidade forjado.
2. Testar explicitamente as bordas fora do manifest: `/pending/<id>`, API da SPA, adaptador legado, consumidor de evento, endpoint de registro dev.
3. Rodar a suíte em todo PR.

**Dono:** Boss · **Prazo:** Epics 2–3 · **Status:** planejado · **Verificação:** suíte gerada cobre 100% das actions dos manifests do repositório.

#### R-02: Verificação de JWT (score 6) — ALTO

1. Fábrica de tokens forjados: `alg: none`, HS256 com a chave pública como segredo, RS256, `kid` desconhecido, `exp` vencido, `iss`/`aud` errados.
2. Contar as buscas ao JWKS com `kid` desconhecido em rajada (no máximo uma por janela).
3. JWKS por `http` e com redirecionamento para outro host fora do modo dev → startup falha ou busca recusada.

**Dono:** Boss · **Prazo:** Story 2.4 · **Status:** planejado · **Verificação:** todos os tokens forjados → 401.

#### R-03: Vazamento entre Tenants (score 6) — ALTO

1. Fixture com dois Tenants e usuários administradores em cada um.
2. Cada endpoint do Directory (listar, buscar, detalhe, editar, export, pendência) chamado com o usuário do Tenant B sobre um objeto do Tenant A → 404.
3. Busca nunca retorna nem conta objetos de outro Tenant.

**Dono:** Boss · **Prazo:** Epic 4 · **Status:** planejado · **Verificação:** matriz endpoint × Tenant 100% verde.

#### R-04: ACL efetiva (score 6) — ALTO

1. Oráculo simples (soma de concessões no caminho até a raiz, direto e por grupos) escrito à parte da implementação.
2. Teste por propriedade (fast-check) com árvores, grupos aninhados e concessões aleatórias, comparando implementação e oráculo.
3. Remoção de permissão concedida via grupo aninhado revoga os tokens de todos os membros efetivos.

**Dono:** Boss · **Prazo:** Story 4.4 · **Status:** planejado · **Verificação:** 0 divergências em ≥ 1.000 casos gerados.

#### R-05: Outbox sob concorrência (score 6) — ALTO

1. Decidir ASR-7 no Create Story.
2. Teste com N transações paralelas, algumas desfeitas, comparando o conjunto publicado com o conjunto confirmado (completude).
3. Teste de troca de líder com lock expirado: o líder antigo não consegue marcar linhas.

**Dono:** Boss · **Prazo:** Stories 3.10–3.11 · **Status:** planejado · **Verificação:** nenhum evento confirmado fica sem publicar; nenhum evento desfeito é publicado.

#### R-06: At-least-once e dedupe (score 6) — ALTO

1. Costuras de queda (ASR-3) nos dois pontos críticos.
2. Poison message não trava as seguintes; vai para a dead-letter após 5 tentativas.
3. Schema inválido vai direto para a dead-letter.

**Dono:** Boss · **Prazo:** Story 3.12 · **Status:** planejado · **Verificação:** cenários de queda reprocessam sem perda e sem efeito duplicado.

#### R-07: Canonicalização (score 6) — ALTO

1. Decidir ASR-6.
2. Vetores fixos (evento → bytes canônicos → assinatura conhecida).
3. Ida e volta: evento serializado, gravado no outbox, lido do stream e verificado.

**Dono:** Boss · **Prazo:** Story 3.10 · **Status:** planejado · **Verificação:** vetores fixos verdes nos 3 bancos.

#### R-08: Portabilidade de banco (score 6) — ALTO

1. Tag `persistence` em todo teste que toca Prisma.
2. Job de matriz obrigatório para merge (Story 1.1).
3. Casos dirigidos às diferenças conhecidas: JSON como texto no MariaDB, isolamento padrão, move na Closure Table, transação do outbox.

**Dono:** Boss · **Prazo:** contínuo desde a Story 1.1 · **Status:** planejado · **Verificação:** JUnit verde nos 3 bancos.

#### R-09: Posturas de falha (score 6) — ALTO

1. Fixture Toxiproxy (ASR-2).
2. Matriz: Valkey fora × {revogação, lockout, Idempotency-Key, rate limit, relay}; JWKS fora × {serviço, consumidor}; Directory fora × login/refresh; monólito fora × ponte.
3. Cada célula afirma o comportamento esperado (rejeita, passa com aviso, reprocessa).

**Dono:** Boss · **Prazo:** Epics 2–4 e 6 · **Status:** planejado · **Verificação:** matriz 100% verde.

#### R-10: Endpoint dev em produção (score 6) — ALTO

1. Auth sobe sem a flag de modo dev → endpoint de registro automático responde 404.
2. Com a flag, o startup registra aviso.
3. `auth bootstrap` sem acesso ao banco do Auth falha; não existe rota HTTP equivalente.

**Dono:** Boss · **Prazo:** Story 3.13 · **Status:** planejado · **Verificação:** testes P0 verdes.

#### R-11: `createUser` distribuído (score 6) — ALTO

1. Falha injetada em cada etapa (antes de chamar o Auth, Auth fora, falha ao gravar no Directory depois da credencial criada).
2. Afirmar o estado final: nenhum usuário sem credencial, nenhuma credencial órfã.
3. Senha inicial nunca aparece em log nem no banco do Directory.

**Dono:** Boss · **Prazo:** Story 4.3 · **Status:** planejado · **Verificação:** todas as etapas cobertas.

#### R-12: `approval` (score 6) — ALTO

1. Aprovador resolvido no Directory na hora da decisão; autoaprovação → 403.
2. Quem pediu perde a permissão antes da aprovação → action não executa.
3. Duas decisões concorrentes → uma vence, a outra recebe 409.

**Dono:** Boss · **Prazo:** Story 5.6 · **Status:** planejado · **Verificação:** testes P0 verdes, incluindo a corrida.

#### R-13: Auth↔Directory e bootstrap (score 6) — ALTO

1. Fixture `tectonStack()` (ASR-5) encapsula a ordem de subida documentada.
2. Teste da ordem errada: `auth bootstrap` falha com mensagem clara se o Directory ou a credencial dele não estiverem prontos.
3. Directory fora → login e refresh falham (fail-closed) e `/ready` do Auth indica.

**Dono:** Boss · **Prazo:** Epic 4 · **Status:** planejado · **Verificação:** testes verdes.

#### R-14: Relógio (score 6) — ALTO

1. Porta `Clock` (ASR-1).
2. Fixture de relógio controlável; nenhum teste usa espera real para expiração.
3. TTLs do Valkey configuráveis para valores curtos em teste.

**Dono:** Boss · **Prazo:** Stories 2.1–2.3 · **Status:** planejado · **Verificação:** nenhum `sleep` maior que 1 s na suíte.

---

### Premissas e dependências

#### Premissas

1. Dev solo (Boss) com apoio de agentes de IA; não há equipe de QA separada. "QA" neste documento é papel, não pessoa.
2. Docker está disponível localmente e no CI (GitHub Actions), condição para Testcontainers e Toxiproxy.
3. O test runner (Vitest) e o Playwright se confirmam no Test Framework e na Story 1.1.
4. Os testes nascem junto com cada story (ATDD/Dev Story), não numa fase separada.

#### Dependências

1. ASR-1, ASR-2 e ASR-4 — necessários no início do Epic 2.
2. ASR-6 e ASR-7 — necessários no Create Story das 3.10 e 3.11.
3. ASR-5 — necessário no início do Epic 4.
4. Monólito sintético para o `extract` — necessário no Epic 6 (plano B do SM-1).

#### Riscos ao próprio plano

- **Risco:** o tempo de CI cresce e passa a ser pulado (R-20).
  - **Impacto:** regressões de segurança passam sem ser vistas.
  - **Contingência:** mover E2E e matriz completa para o nightly; manter P0 sempre no PR.
- **Risco:** a varredura gerada vira falsa sensação de cobertura.
  - **Impacto:** bordas fora do manifest ficam sem teste.
  - **Contingência:** lista explícita de bordas fora do manifest no R-01, revisada a cada épico.

---

**Fim do documento de arquitetura**

**Próximos passos (arquitetura/dev):**

1. Revisar o guia rápido e decidir os 3 bloqueios (ASR-1, ASR-6, ASR-7).
2. Levar os itens de alta prioridade para o Create Story das stories citadas.
3. Validar premissas e dependências.

**Próximos passos (testes):**

1. Configurar o framework de teste (`bmad-testarch-framework`) com as fixtures ASR-1, ASR-2 e ASR-4.
2. Usar o documento companheiro `test-design-qa.md` como receita de cenários.
3. Montar a infraestrutura de teste (fábricas, fixtures, ambientes).
