---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted: ['step-01-detect-mode', 'step-02-load-context', 'step-03-risk-and-testability', 'step-04-coverage-plan', 'step-05-generate-output']
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-10-08'
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad/tea/config.yaml
  - knowledge/adr-quality-readiness-checklist.md
  - knowledge/nfr-criteria.md
  - knowledge/test-levels-framework.md
  - knowledge/risk-governance.md
  - knowledge/test-quality.md
---

# Test Design — Progresso (Tecton)

## Step 1 — Modo e pré-requisitos

- **Modo:** System-Level (intenção explícita do usuário + PRD/ADR presentes; `sprint-status.yaml` ainda não existe).
- **PRD:** `_bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md` (31 FRs, 8 NFRs) ✅
- **ADRs:** Architecture Spine AD-1 a AD-10 ✅
- **Arquitetura:** `ARCHITECTURE-SPINE.md` + `UML.md` ✅
- **Complementares:** UX contract (Directory admin), `epics.md` (61 stories, 6 épicos) ✅

## Step 2 — Contexto carregado

- **Config:** `tea_use_playwright_utils: true`, `tea_use_pactjs_utils: false`, `tea_pact_mcp: none`, `tea_browser_automation: auto`, `test_stack_type: auto`.
- **Stack detectada:** `fullstack` pela arquitetura (Node 24 + Fastify 5 + Prisma 7 + Valkey 9 no backend; React 19 + `@rjsf/core` 6 na SPA `/admin`). Não há código nem testes ainda, então o perfil de Playwright Utils é **API-only** por enquanto; o perfil UI entra no Epic 4.
- **Contract testing:** Pact desligado. O Tecton tem `test:contracts` próprio, que compara schemas do manifest (FR-18, Story 5.7); `--verify-providers` é roadmap.
- **Pontos de integração:** Gateway → serviços (HTTP + token original); serviço → serviço (`ServiceClient`, token de serviço + `Tecton-On-Behalf-Of`); eventos (outbox → relay → Valkey Streams → consumidor, CloudEvents assinados Ed25519); Auth ↔ Directory (dependência cíclica: `createUser` e preenchimento de `perms`); JWKS; Prisma × 3 bancos; Testcontainers; `LegacyAuthBridge` → monólito.
- **NFRs e limites:** os 8 NFRs são qualitativos. Há limites numéricos para Argon2id (19 MiB/2/1), access token (15 min), service token (5 min), refresh (7 dias), lockout (5 em 15 min), timeout do `ServiceClient` (5000 ms), retry (3), dead-letter (5), Idempotency-Key TTL (24 h), outbox (7 dias), cache da ponte legada (30 s) e debounce (~250 ms).
- **Limites ausentes:** não há SLO de latência nem orçamento de overhead (PRD §9 OQ1 nunca foi fechado na spine), nem meta de throughput do relay/consumer, nem RTO/RPO (fora de escopo para framework).

## Step 3 — Testabilidade e riscos

### 🚨 Preocupações de testabilidade

| # | Preocupação | Evidência | Ação |
|---|---|---|---|
| TC-1 | **Sem relógio injetável.** Há pelo menos 10 prazos (access 15 min, service token 5 min, refresh 7 d, lockout 15 min, Idempotency-Key 24 h, expiração de pendência, retenção do outbox 7 d, cache da ponte legada 30 s, lock do relay, TTL de revogação). Sem uma porta `Clock`, os testes ficam lentos ou instáveis. | Spine AD-1 lista os Providers; nenhum é de tempo | ASR-1 (ACTIONABLE): porta `Clock` em `@tecton/providers`, injetada pelo Awilix; TTL do Valkey testado com valor curto configurável |
| TC-2 | **Injeção de falha em Valkey, JWKS, Directory e monólito.** Fail-closed e fail-open aparecem como critério de aceite em 9 stories. | Stories 2.4, 2.5, 2.6, 3.7, 3.8, 3.11, 3.12, 4.4, 6.5 | ASR-2 (ACTIONABLE): Toxiproxy (módulo Testcontainers) entre o serviço e Valkey/JWKS; fixture única `withDependencyDown()` |
| TC-3 | **Pontos de queda do relay e do consumidor** ("caiu depois de enviar e antes de marcar"; "aplicou o efeito e caiu antes de registrar a chave"). Não dá para reproduzir sem uma costura. | Stories 3.11, 3.12 | ASR-3 (ACTIONABLE): relay e consumidor decompostos em passos chamáveis isoladamente, ou hooks internos de teste |
| TC-4 | **JWKS só por `https` fora do modo dev.** Testes de integração precisam de TLS ou de um modo explícito. | Story 2.4, AD-7 | ASR-4 (ACTIONABLE): certificado autoassinado gerado na fixture com CA confiável só no processo de teste; teste dedicado prova que fora do modo dev `http` falha |
| TC-5 | **Semeadura de estado.** Não há API de seeding (correto por segurança); `auth bootstrap` exige acesso direto ao banco; Auth e Directory dependem um do outro e têm ordem de subida rígida. | Stories 2.2, 4.3, 4.4 | ASR-5 (ACTIONABLE): fábricas de dados por pacote que gravam via Prisma **só em código de teste**, e uma fixture `tectonStack()` que sobe Auth + Directory + Gateway com chaves e credenciais pré-registradas |
| TC-6 | **Canonicalização da assinatura de evento indefinida.** A spec diz "assinatura cobrindo envelope e dados", sem forma canônica. Como assinatura inválida vira ACK e descarte, uma divergência de serialização perde eventos em silêncio. | Stories 3.10, 3.12, AD-7 (E1) | ASR-6 (ACTIONABLE): fixar a canonicalização (ex.: JCS, RFC 8785) com vetores de teste fixos |
| TC-7 | **Resposta de login "com tempo equivalente".** Teste de tempo é estatístico e instável em CI. | Story 2.2 | Testar por comportamento: o hash fictício é verificado também para identificador inexistente (spy no `AuthProvider`), sem medir tempo |
| TC-8 | **O CLI gera workspaces inteiros** (`new`, `generate`, `extract`, `dev`). E2E real exige `pnpm install` e build. | Stories 1.9–1.11, 3.13, 6.6–6.8 | Dividir em snapshot de templates (rápido, todo PR) e poucos E2E de geração completa com link local (job separado) |
| TC-9 | **Matriz de 3 bancos** multiplica o custo de CI. | Story 1.1 | Tag `persistence`; a matriz roda só esse subconjunto (já previsto na Story 1.1) |

### ✅ Pontos fortes de testabilidade

- **Hexagonal + Awilix** (AD-1, NFR-8): toda infraestrutura fica atrás de porta, e adaptador falso é o caminho natural.
- **Tudo headless:** toda regra é action HTTP (RPC uniforme) ou comando de CLI com `--format json` e código de saída. A SPA `/admin` é a única superfície de UI.
- **Contratos são dados:** manifest → JSON Schema draft-07, OpenAPI e AsyncAPI. Os schemas servem de oráculo determinístico.
- **Observabilidade nativa:** `traceparent`, logs JSON com `trace_id` e OTel (InMemorySpanExporter para asserções).
- **Multi-tenant por construção** (FR-9): cada teste pode ter o próprio Tenant.
- **Testcontainers já é requisito** (FR-31), e o Laboratório Integrit tem infra Docker real para validação.
- **Abstração única de erro** (Story 1.7): a troca do formato provisório pelo RFC 9457 é verificável num só ponto.

### ASRs (Architecturally Significant Requirements)

| ID | Requisito | Tipo |
|---|---|---|
| ASR-1 | Porta `Clock` injetável | ACTIONABLE |
| ASR-2 | Injeção de falha de rede (Toxiproxy) como fixture padrão | ACTIONABLE |
| ASR-3 | Costuras de queda no relay e no consumidor | ACTIONABLE |
| ASR-4 | Estratégia de TLS do JWKS em teste | ACTIONABLE |
| ASR-5 | Fábricas de dados de teste + fixture `tectonStack()` | ACTIONABLE |
| ASR-6 | Canonicalização da assinatura de CloudEvent | ACTIONABLE |
| ASR-7 | Semântica de ordem do outbox sob transações concorrentes: seleção por linhas pendentes (nunca por watermark) e fencing token no lock do relay | ACTIONABLE |
| ASR-8 | Zero Trust em toda borda (AD-7) | FYI (já especificado; vira suíte P0) |
| ASR-9 | Três posturas de falha distintas (NFR-6) | FYI (vira matriz P0) |
| ASR-10 | Allowlist do Gateway e direção de dependência (AD-3, AD-8) | FYI (enforcement automático já previsto) |

### Registro de riscos

| ID | Cat | Risco | P | I | Score | Mitigação | Prazo |
|---|---|---|---|---|---|---|---|
| R-01 | SEC | Alguma borda pula a verificação Zero Trust (`/pending/*`, API da SPA, adaptador legado, consumidor de evento, endpoint dev) ou confia em header repassado | 2 | 3 | **6** | Suíte P0 "toda rota sem token → 401", gerada a partir do manifest, + teste de header forjado em cada borda | Epics 2–3 |
| R-02 | SEC | Falha na verificação do JWT: `alg` confusion (`none`/HS256), `kid` desconhecido forçando refetch em loop, JWKS por http ou com redirecionamento, `iss`/`aud` | 2 | 3 | **6** | Testes negativos P0 com tokens forjados; refetch com limite de frequência | Epic 2 |
| R-03 | SEC | Vazamento entre Tenants (listagem, busca, detalhe, export, pendência) | 2 | 3 | **6** | Suíte P0 de isolamento com 2 Tenants em todo endpoint do Directory; 404 em vez de 403 | Epic 4 |
| R-04 | SEC | ACL efetiva errada (herança por grupos e containment aninhado), ou revogação que não alcança todos os afetados quando uma permissão é removida | 2 | 3 | **6** | Testes por propriedade sobre árvores geradas, contra um oráculo de referência simples | Epic 4 |
| R-05 | DATA | Outbox sob concorrência: sequência atribuída fora da ordem de commit causa inversão, ou perda se o relay usar watermark; lock do relay expira com o líder antigo ainda enviando | 2 | 3 | **6** | ASR-7; teste com N transações paralelas verificando completude; fencing token | Stories 3.10–3.11 |
| R-06 | DATA | At-least-once ou deduplicação incorretos: chave gravada antes do efeito, poison message travando o stream, dead-letter não acionada | 2 | 3 | **6** | ASR-3; testes de queda; teste de poison message | Story 3.12 |
| R-07 | SEC/DATA | Canonicalização de assinatura divergente: eventos válidos descartados em silêncio por ACK, ou bypass | 2 | 3 | **6** | ASR-6; vetores fixos; teste de ida e volta entre serializadores | Story 3.10 |
| R-08 | TECH | Portabilidade PG/MariaDB/MySQL: JSON como texto no MariaDB, isolamento padrão diferente (REPEATABLE READ × READ COMMITTED), move na Closure Table, `@prisma/adapter-mariadb` | 3 | 2 | **6** | Job de matriz obrigatório (Story 1.1) para todo teste com tag `persistence` | Desde a Story 1.1 |
| R-09 | SEC | Postura de falha trocada (NFR-6): algo abre onde deveria fechar (revogação, lockout, Idempotency-Key, JWKS, Directory no login, ponte legada) ou o rate limit fecha | 2 | 3 | **6** | Matriz P0 "dependência fora × comportamento esperado" com Toxiproxy | Epics 2–4 e 6 |
| R-10 | SEC | Endpoint de registro automático do modo dev, ou `auth bootstrap`, alcançável em produção | 2 | 3 | **6** | Teste P0: Auth sobe sem a flag dev e o endpoint responde 404; bootstrap sem acesso ao banco falha | Story 3.13 |
| R-11 | DATA | `createUser` distribuído (Directory + Auth) deixa usuário sem credencial ou credencial órfã | 2 | 3 | **6** | Teste de falha em cada etapa, verificando a compensação | Story 4.3 |
| R-12 | BUS/SEC | Fluxo de `approval`: autoaprovação, resolução de `reportingChain`, permissão reconferida, corrida de decisão dupla, expiração | 2 | 3 | **6** | Testes P0 de autorização + teste de concorrência na decisão | Story 5.6 |
| R-13 | TECH | Dependência cíclica Auth↔Directory e ordem de bootstrap; Directory como ponto único de falha do login | 3 | 2 | **6** | ASR-5 (`tectonStack()`); teste de ordem de subida com falha clara | Epic 4 |
| R-14 | TECH | Sem relógio injetável, os testes de TTL ficam lentos ou instáveis | 3 | 2 | **6** | ASR-1 | Stories 2.1–2.3 |
| R-15 | SEC | Idempotency-Key: corrida com execução em andamento (409), escopo por sujeito, hash do corpo | 2 | 2 | 4 | Teste de concorrência com requisições paralelas | Story 3.8 |
| R-16 | SEC | Refresh concorrente legítimo (duas abas, requisições paralelas na SPA) é tomado como reuso e revoga a família, deslogando o usuário | 2 | 2 | 4 | Single-flight do refresh na SPA; teste de refresh concorrente | Stories 2.3 e 4.7 |
| R-17 | SEC | Enumeração de login por tempo ou pelo bloqueio | 2 | 2 | 4 | TC-7; teste de paridade entre identificador existente e inexistente | Stories 2.2 e 2.6 |
| R-18 | TECH | `test:contracts` com falso negativo (enum estreitado, `format`, `nullable`, campo de `output` virando opcional) | 2 | 2 | 4 | Tabela de regras de compatibilidade com um caso de teste por regra | Stories 5.7–5.8 |
| R-19 | BUS | `extract`: drenagem na janela, retomada do script sem duplicar, comparação de contagem | 2 | 2 | 4 | Integração contra monólito sintético (plano B do SM-1) | Epic 6 |
| R-20 | OPS | O tempo de CI explode (matriz × Testcontainers × geração de workspace) e o dev solo passa a pular testes | 2 | 2 | 4 | Seleção por tag, jobs paralelos, geração completa só em `main`/nightly | Workflow de CI |
| R-21 | PERF | Sem SLO de latência nem orçamento de overhead (PRD §9 OQ1 aberto); busca com ACL em árvore grande; checagem de revogação a cada requisição | 2 | 2 | 4 | Definir limites (ver NFR abaixo); benchmark de baseline no Epic 3 | Antes do Epic 4 |
| R-22 | SEC | `X-Forwarded-For` falsificado contorna o rate limit | 2 | 2 | 4 | Teste com proxy confiável e não confiável | Story 3.7 |
| R-23 | SEC | XSS na SPA (valor de atributo, `@rjsf`) ou CSP quebrada | 1 | 3 | 3 | Teste com payload de script + verificação dos headers de CSP | Epic 4 |
| R-24 | SEC | Retry cego de mutação no `ServiceClient` | 1 | 3 | 3 | Teste P0 de "nenhum retry" | Story 3.9 |
| R-25 | TECH | Deriva de arquitetura (AD-1, AD-3, AD-8) | 1 | 2 | 2 | `check:deps`, checagem hexagonal e `lint:gateway` no CI | Contínuo |
| R-26 | OPS | Regressão de acessibilidade WCAG 2.2 AA | 2 | 1 | 2 | axe no Playwright em todos os estados | Epic 4 |
| R-27 | TECH | Colisão ou fallback errado de i18n | 1 | 2 | 2 | Teste de consolidação do catálogo | Stories 4.6 e 5.2 |

Dono de todos os riscos: o autor (dev solo). **Riscos aceitos** (registrados nas stories, sem mitigação adicional): bloqueio de conta alheia por senha errada (2.6); reuso, por serviço comprometido, de token de usuário até expirar (2.7); Directory como ponto único de falha do login (4.4).

Nenhum risco com score 9. Catorze riscos com score 6, todos com mitigação.

### Planejamento de NFR

| NFR | Limite conhecido | Lacuna (UNKNOWN) | Evidência planejada |
|---|---|---|---|
| NFR-1 Zero Trust | Binário (verifica ou não) | — | Suíte P0 de bordas (R-01, R-02) |
| NFR-2 i18n | PT-BR padrão, EN secundário | — | Testes de negociação de `Accept-Language` |
| NFR-3 OTel | `traceparent` propagado | — | InMemorySpanExporter; asserção de trace contínuo |
| NFR-4 Portabilidade | 3 bancos | — | Job de matriz |
| NFR-5 Retry seguro | 3 tentativas, timeout de 5000 ms | — | Testes do `ServiceClient` |
| NFR-6 Posturas de falha | Binário por dependência | — | Matriz Toxiproxy (R-09) |
| NFR-7 Evolução de contrato | Regras do FR-29 | Regras para enum, `format`, `nullable` | Tabela de regras (R-18) |
| NFR-8 TS + DI | TS 6.0.3, Awilix | — | Build + `check:deps` |
| Performance (implícito) | Argon2id 19 MiB/2/1 | **UNKNOWN:** P95 por action via Gateway; overhead da verificação por requisição; vazão do relay; tempo de propagação da revogação ("tempo de propagação do Valkey", sem número) | Benchmark de baseline (autocannon/k6), sem gate até existir limite |
| Escala da busca | "centenas de usuários" | **UNKNOWN:** tamanho máximo de árvore para a busca com ACL | Teste com seed de 1.000 objetos |
| CI | — | **UNKNOWN:** orçamento de tempo do pipeline | Medir no primeiro mês |

### Resumo

Os riscos se concentram onde você apontou, **nos Epics 2 a 4**: onze dos catorze riscos altos estão em Auth/Zero Trust, mensageria assinada e Directory/ACL. Os outros três são o `approval` (5.6), a portabilidade de banco e a testabilidade de tempo. Prioridades de mitigação:

1. **Antes do Epic 2:** ASR-1 (`Clock`), ASR-2 (Toxiproxy) e ASR-4 (TLS do JWKS em teste), que viram fixtures no Test Framework.
2. **Antes do Epic 3:** ASR-6 (canonicalização) e ASR-7 (semântica do outbox). São decisões de design que precisam entrar nas Stories 3.10 e 3.11 no Create Story.
3. **Antes do Epic 4:** ASR-5 (`tectonStack()`) e um oráculo de ACL para os testes por propriedade.

## Step 4 — Plano de cobertura e estratégia de execução

### Níveis de teste adotados

| Nível | Uso no Tecton | Ferramenta provável (decisão final no Test Framework / Story 1.1) |
|---|---|---|
| **Unit** | Parser/validador do manifest, compilador de tipos, regras de compatibilidade de contrato, cálculo de ACL, canonicalização, Argon2id+Pepper, serializador de erro, catálogo i18n | Vitest |
| **Integration** | Plugin de verificação de token, rotas Fastify, Prisma + Closure Table, outbox/relay/consumer com Valkey real, Idempotency-Key, rate limit, health, OTel | Vitest + Testcontainers (+ Toxiproxy) |
| **API (multi-serviço)** | Fluxos entre Gateway, Auth, Directory e domínio de teste: Zero Trust de ponta a ponta, isolamento de Tenant, `approval`, `createUser` | Playwright `request` + Playwright Utils (perfil API) contra `tectonStack()` |
| **Component** | Componentes da SPA: árvore ARIA, menu de contexto, formulário `@rjsf`, estados | Vitest + Testing Library (ou Playwright CT) |
| **E2E (UI)** | Fluxos 1 e 2 do `EXPERIENCE.md`, login/refresh/logout, CSP, axe | Playwright |
| **CLI** | `new`, `generate`, `lint`, `test:contracts`, `migrate`, `extract`, `dev`, `--help` | Vitest chamando o binário (execa) + snapshot de templates; E2E de geração completa em job separado |

Regra contra duplicação: lógica pura fica em Unit; o nível API cobre só o que atravessa serviços; E2E de UI só para jornada da Marina, acessibilidade e headers. Nenhum caso de ACL ou de validação de manifest é repetido em E2E.

### Matriz de cobertura

Formato do ID: `{EPIC}.{STORY}-{NÍVEL}-{SEQ}`. Contagens são estimativas por grupo.

#### Epic 1 — Manifest e scaffold

| Grupo | Stories | Nível | Prioridade | Qtde | Risco |
|---|---|---|---|---|---|
| Validação do núcleo do manifest (versão, kebab-case, semver, chave desconhecida, erros agregados, linha/coluna) | 1.2 | Unit | P1 | 10 | — |
| Actions: compilação de tipos curtos, `auth` obrigatório, `public` × `requires`, formato de permissão, `sensitive`/`approval` exclusivos | 1.3 | Unit | **P0** (bloco `auth`) / P1 | 12 | R-01 |
| Events: `type` CloudEvents determinístico, `emit` referenciando evento inexistente | 1.4 | Unit | P1 | 6 | — |
| `objectClass`: `allowedParents`, `x-tecton-unique`, `readOnly`, padrões | 1.5 | Unit | P1 | 7 | — |
| `lint`: resolução em 3 caminhos, referência não resolvida, URL remota, ciclo (aviso), `--format json`, divergência do `AGENTS.md` | 1.6, 1.10 | Integration (CLI) | P1 | 10 | — |
| Rotas Fastify + OpenAPI: `POST /<domínio>/<action>`, 400 pré-handler, 501, OpenAPI reflete mudança | 1.7 | Integration | P1 | 6 | — |
| Abstração única de erro (nenhum outro ponto monta corpo de erro) | 1.7 | Unit + checagem estática | P1 | 2 | — |
| AsyncAPI válido no `@asyncapi/parser` | 1.8 | Unit + CI | P2 | 3 | — |
| `new`: workspace compila, AD-4 (nada copiado), link local, destino não vazio, `--help` em inglês, sementes de `AGENTS.md`/`README.md`/`CLAUDE.md` | 1.9 | CLI (snapshot + 1 E2E completo) | P1 | 8 | R-20 |
| `generate domain`: variádico, `--from`, atomicidade com nome inválido, *walking skeleton* responde 501 | 1.10 | CLI | P1 | 6 | — |
| Dev Services por banco, banco lógico por domínio | 1.11 | CLI (snapshot) | P2 | 4 | — |
| `check:deps` falha em import proibido (AD-3) | 1.1 | Integration | P1 | 2 | R-25 |

#### Epic 2 — Auth e Zero Trust (maior densidade de P0)

| Grupo | Stories | Nível | Prioridade | Qtde | Risco |
|---|---|---|---|---|---|
| Argon2id+Pepper: HMAC antes do hash, formato PHC, rehash, Pepper ausente ou curto falha, senha e Pepper fora de logs | 2.1 | Unit | **P0** | 7 | — |
| Login: token EdDSA com claims corretos, 401 idêntico para login inexistente e senha errada (hash fictício verificado), JWKS só público, várias chaves | 2.2 | Integration | **P0** | 8 | R-17 |
| `auth bootstrap`: só local, segunda execução falha, senha nunca por argumento | 2.2 | CLI | **P0** | 3 | R-10 |
| Refresh: cookie `HttpOnly`/`Secure`/`SameSite=Strict`/`Path`, rotação, reuso revoga família, expirado, logout, refresh nunca no corpo | 2.3 | Integration | **P0** | 8 | R-16 |
| Refresh concorrente legítimo (comportamento documentado) | 2.3 | Integration | P1 | 2 | R-16 |
| Verificação local: sem Bearer, `alg` `none`/HS256/RS256, `kid` desconhecido (refetch único e limitado), `exp`/`iss`/`aud`, header de identidade forjado ignorado, chamada direta com token adulterado, 403 por permissão, `public` | 2.4 | Integration | **P0** | 14 | R-01, R-02 |
| JWKS: `https` obrigatório fora do dev, redirecionamento para outro host recusado, Auth fora e cache vazio → rejeita | 2.4 | Integration (TLS + Toxiproxy) | **P0** | 4 | R-02, R-09 |
| Revogação: por `jti`, por sujeito antes do instante, TTL = restante do token, Valkey fora → 401, logout revoga access, reuso de refresh revoga access | 2.5 | Integration | **P0** | 7 | R-09 |
| Lockout por identificador: N falhas, senha correta bloqueada com 429 + `Retry-After`, identificador inexistente igual, várias origens, sucesso zera, `unlock`, Valkey fora → rejeita | 2.6 | Integration | **P0** | 8 | R-09, R-17 |
| Token de serviço: registro só com `auth:service:register`, sem sobrescrever sem `--rotate`, rotação revoga antigos, `typ: service` sem refresh, recusado em login/refresh | 2.7 | Integration | **P0** | 7 | R-01 |
| `Tecton-On-Behalf-Of`: dois tokens verificados, `auth.requires` contra o usuário, um inválido → 401, `call:<domínio>` exigido, domínio fora de `dependencies` → 403 | 2.7 | Integration | **P0** | 6 | R-01 |
| `KeyCustodyProvider`: sem provider executa com aviso por execução, nenhum método recebe requisição HTTP (checagem de tipo) | 2.8 | Unit | P1 | 3 | — |

#### Epic 3 — Interoperabilidade

| Grupo | Stories | Nível | Prioridade | Qtde | Risco |
|---|---|---|---|---|---|
| `ConfigProvider`: ausente, formato inválido, vários erros, segredo nunca na mensagem, núcleo sem `process.env` | 3.1 | Unit + checagem estática | P1 | 6 | — |
| Health: `/live` 200 com dependência fora, `/ready` 503 com nome da dependência, sem token, sem segredo no corpo | 3.2 | Integration | P1 | 5 | — |
| OTel: trace continua/cria, `trace_id` no log, sem endpoint só avisa, `Authorization`/token/cookie nunca em span ou log | 3.3 | Integration | P1 (redação = **P0**) | 6 | — |
| Esqueleto hexagonal: checagem falha com import concreto em `src/core`, Dockerfile multi-stage sem root e sem código de outro domínio, schema Prisma próprio | 3.4 | CLI + Integration (build de imagem no nightly) | P1 | 6 | R-25 |
| Discovery estático: variável ausente → fail-fast, adaptador falso sem mudar domínio | 3.5 | Unit | P2 | 3 | — |
| Gateway: tabela de rotas do manifest, 404 em prefixo desconhecido, 401 sem encaminhar, `Authorization` original intacto, remoção de `Tecton-On-Behalf-Of`/`x-user-id`, sem transformação, cookie de refresh passa | 3.6 | API | **P0** | 8 | R-01 |
| Rate limit: IP × `sub`, 429 + `Retry-After`, contagem compartilhada, `X-Forwarded-For` só de proxy confiável, Valkey fora → passa com aviso limitado, health fora da contagem | 3.7 | Integration | P1 (fail-open e XFF = **P0**) | 7 | R-09, R-22 |
| Idempotency-Key: repetição devolve resposta, corpo diferente 422, em andamento 409, 5xx não guardado, escopo por sujeito, chave inválida 400, Valkey fora 503 | 3.8 | Integration | **P0** | 8 | R-15 |
| `ServiceClient`: tipado por `dependencies`, direto ao destino, token de serviço + `On-Behalf-Of` + `traceparent`, timeout 5000 ms, retry só idempotente ou com chave, **nenhum retry em mutação sem chave**, middleware plugável | 3.9 | Integration | **P0** (sem retry cego) / P1 | 9 | R-24 |
| Outbox: chaves Ed25519 no registro, dados + outbox na mesma transação, rollback desfaz os dois, payload inválido desfaz, Valkey fora não afeta a action, envelope completo e assinado (`tectonsig`), mesmo comportamento nos 3 bancos | 3.10 | Integration (`persistence`) | **P0** | 9 | R-05, R-07, R-08 |
| Canonicalização: vetores fixos, ida e volta | 3.10 | Unit | **P0** | 3 | R-07 |
| Relay: ordem por sequência, um líder por lock, queda entre enviar e marcar reenvia mesmo `id`, Valkey fora mantém pendente sem pular, aviso de atraso no `/ready`, limpeza por retenção, **N transações concorrentes sem perda** | 3.11 | Integration | **P0** | 8 | R-05 |
| Consumidor: assinatura verificada antes do handler, chave de outro domínio → ACK + log de segurança, JWKS fora → reprocessa, dedupe por `id`, queda após efeito reprocessa, dead-letter após 5, schema inválido direto para dead-letter, ordem no stream, trace continua | 3.12 | Integration | **P0** | 10 | R-06, R-07 |
| `tecton-admin dev`: sobe tudo, migrations, reinício só do serviço alterado, falha isolada, `Ctrl+C` limpo | 3.13 | CLI E2E (nightly) | P2 | 5 | — |
| Registro automático só com modo dev explícito; endpoint inexistente fora dele; verificação de token ligada no dev | 3.13 | Integration | **P0** | 3 | R-10 |

#### Epic 4 — Directory e SPA `/admin`

| Grupo | Stories | Nível | Prioridade | Qtde | Risco |
|---|---|---|---|---|---|
| Closure Table: containment por `allowedParents`/`allowedChildren`, validação de atributos pelo schema, `x-tecton-unique`, move altera só a subárvore, move para descendente rejeitado, `readOnly` só por action específica — **nos 3 bancos** | 4.1 | Integration (`persistence`) | **P0** (ciclo, containment) / P1 | 10 | R-08 |
| Tenant: raiz própria, `tenant:create` só em `Root`, todo objeto pertence a Tenant, `suspended` bloqueia mutação, `archived` bloqueia tudo menos leitura/export, export com aviso | 4.2 | Integration | **P0** | 8 | R-03 |
| **Isolamento entre Tenants** em listagem, busca, detalhe, edição, export e pendência → 404 | 4.2, 4.9, 5.5 | API | **P0** | 8 | R-03 |
| Usuário/Grupo: containment, membership separada, papéis, `createUser` com compensação em cada falha, `create-credential` só de `service:directory`, desativação revoga tokens, bootstrap cria Tenant + admin, ordem de subida com falha clara | 4.3 | Integration + API | **P0** | 10 | R-11, R-13 |
| ACL: soma de heranças por grupo e containment (**teste por propriedade** contra oráculo), listagem só do legível, nó legível com pai ilegível vira topo, escrita negada, `perms` do token = permissões na raiz do Tenant, Directory fora → login falha, remoção revoga tokens dos afetados (inclusive via grupo aninhado) | 4.4 | Unit (oráculo) + Integration | **P0** | 12 | R-04, R-09 |
| Eventos do Directory: lista mínima publicada, gravados no outbox, sem credencial no payload, consumidor de teste recebe sem tocar o banco, AsyncAPI | 4.5 | Integration | P1 (sem credencial = **P0**) | 5 | — |
| `@tecton/ui`: tokens CSS, troca de um slot só, `ScreenLayout` só posiciona, segundo `Core` lança erro, namespace e duplicata de `i18nKey` falham, sem literal, sem import de `@tecton/directory` | 4.6 | Component + Unit | P1 | 8 | R-27 |
| Shell e login: API sempre pelo Gateway, token só em memória, mensagem única de credencial inválida, tempo de bloqueio, refresh único e repetição, logout, layout inicial | 4.7 | E2E | **P0** (token em memória, pelo Gateway) / P1 | 8 | R-16 |
| Headers de segurança do `/admin`: CSP sem inline/eval, `frame-ancestors 'none'`, `nosniff`, `no-referrer` | 4.7 | API | **P0** | 2 | R-23 |
| Árvore: expandir sob demanda, ícones, teclado, ARIA (`aria-posinset`/`setsize`), nó ilegível invisível, nenhum sinal de arrasto, foco visível | 4.8 | Component + E2E | P1 (invisível = **P0**) | 8 | R-04 |
| Busca: servidor após debounce, ancestrais expandidos, foco no primeiro, `aria-live`, sem resultado, limpar, ilegíveis fora dos resultados e da contagem | 4.9 | Component + API | P1 (ilegíveis = **P0**) | 7 | R-03 |
| Menu e detalhe: só 2 itens, edição some sem permissão, foco e `Esc`, valor com HTML renderizado como texto | 4.10 | Component | P1 (XSS = **P0**) | 6 | R-23 |
| Formulário `@rjsf`: campo novo aparece sem código, i18n, erro abaixo do campo com foco e `aria-live`, salvar, falha preserva dados, cancelar, `readOnly` nunca enviado | 4.11 | Component + E2E | P1 | 8 | — |
| Estados e acessibilidade: skeletons, vazio, erro com "Tentar novamente", axe sem violações em todos os estados, fluxos 1 e 2 só com teclado, microcopy sem emoji/stack | 4.12 | E2E | P1 | 8 | R-26 |
| Busca em árvore de 1.000 objetos com ACL (baseline de desempenho) | 4.9 | Integration | P3 | 1 | R-21 |

#### Epic 5 — Formato de API e contrato

| Grupo | Stories | Nível | Prioridade | Qtde | Risco |
|---|---|---|---|---|---|
| Sucesso puro: só o `output`, campos extras removidos, `traceparent` em toda resposta | 5.1 | Integration | P1 (vazamento de campo = **P0**) | 3 | — |
| RFC 9457: `problem+json`, URN estável, `i18nKey`, EN/PT-BR/idioma desconhecido, 500 sem stack nem tabela, todos os pontos provisórios migrados pelo serializador, SPA usa `title`/`detail`, `ServiceClient` tipado | 5.2 | Integration + API | P1 (500 sem vazamento = **P0**) | 10 | — |
| `invalid-params`: 422 com JSON Pointer traduzido, todos os campos, exclusivo de validação, SPA mostra por campo | 5.3 | Integration + Component | P1 | 5 | — |
| Erros de domínio de terceiros: URN com domínio, sem catálogo usa texto do dev, catálogo traduz, chave fora do namespace falha o startup, exceção comum vira 500 sem vazar | 5.4 | Integration | P1 | 5 | — |
| Pendência `202`: não executa, grava pedido, poll repete 202, expirado, desconhecido 404, terceiro 404, `sensitive.quorum` sem provider segue a 2.8 | 5.5 | Integration | **P0** (sem provider não bloqueia; terceiro 404) / P1 | 7 | R-12 |
| Decisão de `approval`: aprovador verificado no Directory na hora, autoaprovação 403, permissões reconferidas, evento no outbox, poll devolve sucesso/403/rejeição, decisão dupla 409 (**concorrente**) | 5.6 | Integration + API | **P0** | 9 | R-12 |
| `test:contracts`: snapshot do consumidor, comparação com o provedor, `consumes` × `publishes`, mensagem com provedor/action/consumidor/campo, código de saída, `--format json` | 5.7 | CLI | P1 | 6 | R-18 |
| Regras de compatibilidade (tabela): opcional novo passa; remover/renomear/trocar tipo falham; obrigatório novo em `input` falha; enum estreitado, `format`, `nullable` (a definir) | 5.8 | Unit | **P0** | 10 | R-18 |

#### Epic 6 — CLI completo

| Grupo | Stories | Nível | Prioridade | Qtde | Risco |
|---|---|---|---|---|---|
| `migrate`: aplica por serviço, `--domain`, `create`, falha para e lista aplicados, URL inválida, 3 bancos | 6.1 | CLI + Integration (`persistence`) | P1 | 6 | R-08 |
| `lint:gateway`: dependência e import proibidos, `@tecton/directory`/`@tecton/ui` proibidos, código de saída, `--format json`, workflow gerado | 6.2 | CLI | P1 | 6 | R-25 |
| Aviso de `sensitive.quorum`: por action, sem mudar a saída, `--strict` falha, com provider sem aviso | 6.3 | CLI | P2 | 3 | — |
| Testcontainers: duas execuções sem estado compartilhado, sem Docker → mensagem clara | 6.4 | Integration | P2 | 3 | — |
| `LegacyAuthBridge`: 3 adaptadores, `iss`/`aud`/`azp`, HS256 com aviso, mapeamento por `legacyId` (sem correspondência 401), cache de 30 s, monólito fora → rejeita, `setLegacyId` só admin/serviço de importação, edição genérica não altera | 6.5 | Integration | **P0** | 10 | R-01, R-09 |
| `extract` parte 1: domínio pelo manifest, stubs de tradutor, ponte antes de tudo (401 no formato legado), action pelo caminho normal com ACL, tradução só no adaptador | 6.6 | CLI + Integration | P1 (ponte primeiro = **P0**) | 6 | R-01 |
| `extract` parte 2: fachada inicia 100% monólito, desvio por rota/percentual/flag sem alterar corpo, aviso de percentual, janela devolve 503 + `Retry-After` e drena em andamento, fim com 100% novo | 6.7 | API | P1 | 7 | R-19 |
| `extract` parte 3: script por introspecção, `setLegacyId` via `ServiceClient`, contagem falha em diferença, retomada sem duplicar, 3 bancos | 6.8 | Integration (`persistence`) | P1 | 6 | R-19 |
| `--help` completo, `mcp:serve` roadmap sai ≠ 0, ajuda em inglês | 6.9 | CLI | P2 | 3 | — |

#### Transversais (derivados de risco)

| Grupo | Nível | Prioridade | Qtde | Risco |
|---|---|---|---|---|
| **Varredura Zero Trust gerada do manifest:** para cada action não pública de cada serviço, sem token → 401; token de outro `aud` → 401; chamada direta sem passar pelo Gateway → verificada | API | **P0** | gerado (~1 por action) | R-01 |
| **Matriz de posturas de falha** (Toxiproxy): Valkey (revogação, lockout, idempotência, rate limit, relay), JWKS (serviço, consumidor), Directory (login), monólito (ponte) | Integration | **P0** | 10 | R-09 |
| Segredos nunca em log/span/erro (senha, Pepper, hash, chave privada, tokens, cookie) — varredura do output capturado em toda a suíte de integração | Integration | **P0** | 1 fixture global | — |
| Benchmark de baseline: latência P95 de action via Gateway e overhead de verificação | Perf (autocannon/k6) | P3 | 2 | R-21 |
| Build de imagem Docker por domínio | Integration | P3 | 1 | — |

### Totais estimados

| Prioridade | Cenários (aprox.) |
|---|---|
| P0 | ~210–240 (inclui a varredura gerada) |
| P1 | ~190–220 |
| P2 | ~25–35 |
| P3 | ~4–6 |

O peso em P0 é deliberado: o produto é um framework de segurança (Zero Trust, ACL, multi-tenant) e de mensageria confiável, em que um defeito afeta todo sistema construído sobre ele.

### Evidência de NFR (para o `nfr-assess` consumir depois)

| NFR | Validação | Evidência esperada |
|---|---|---|
| NFR-1 Zero Trust | Varredura gerada + suítes 2.4/2.7/3.6/3.12/6.5 | Relatório JUnit da suíte `security`, com lista de rotas cobertas |
| NFR-2 i18n | Testes de `Accept-Language` (5.2–5.4) + consolidação do catálogo | JUnit; snapshot do catálogo consolidado |
| NFR-3 OTel | InMemorySpanExporter em fluxo Gateway → serviço → evento → consumidor | JUnit; trace exportado como artefato no nightly |
| NFR-4 Portabilidade | Job de matriz `persistence` | JUnit por banco no CI |
| NFR-5 Retry seguro | Suíte 3.8/3.9 | JUnit |
| NFR-6 Posturas de falha | Matriz Toxiproxy | JUnit da suíte `failure-modes` |
| NFR-7 Contrato | Tabela de regras 5.8 | JUnit |
| NFR-8 TS + DI | `pnpm build`, `check:deps`, checagem hexagonal | Log de CI |
| Performance | Baseline P3 | JSON do autocannon/k6 — **sem gate até existir limite (UNKNOWN)** |
| Acessibilidade | axe + teclado (4.12) | Relatório Playwright com axe |

### Estratégia de execução

| Gatilho | O que roda | Alvo de tempo |
|---|---|---|
| **PR** | Unit + Integration (PostgreSQL apenas) + API P0/P1 contra `tectonStack()` + Component + snapshot de templates do CLI + `check:deps` + `lint` + AsyncAPI | < 15 min |
| **PR que toca `persistence`** (ou merge em `main`) | Job de matriz PG/MariaDB/MySQL dos testes com tag `persistence` (obrigatório para merge, Story 1.1) | < 15 min em paralelo |
| **Nightly** | E2E de UI completo com axe, E2E de geração completa do CLI (`new` → `generate` → build → subir), `tecton-admin dev`, build de imagens Docker, matriz Toxiproxy completa | < 45 min |
| **Semanal / manual** | Benchmark de baseline; validação no Laboratório Integrit contra infra real; `extract` contra monólito sintético | livre |

### Estimativa de esforço (faixas)

| Prioridade | Esforço |
|---|---|
| P0 | ~70–110 h |
| P1 | ~55–90 h |
| P2 | ~10–20 h |
| P3 | ~4–8 h |
| **Total** | **~140–230 h**, distribuídas ao longo dos 6 épicos (os testes nascem junto com cada story; não é uma fase separada) |

A infraestrutura de teste (fixtures `Clock`, Toxiproxy, TLS do JWKS, `tectonStack()`, fábricas, varredura gerada) soma ~20–35 h, concentradas no Test Framework e no início dos Epics 2 e 4.

### Quality gates

- P0: **100%** de aprovação, sem exceção nem waiver.
- P1: **≥ 95%**; falha restante com issue aberta e justificativa.
- Riscos de score 6 (R-01 a R-14): mitigação implementada e teste correspondente verde antes de fechar o épico em que vivem.
- Cobertura de linhas **≥ 80%** em `manifest`, `core`, `providers`, `auth`, `directory` e `service-client`; **≥ 90%** nos módulos de verificação de token, ACL, outbox/relay/consumer e regras de compatibilidade. `ui` e `cli` medidos sem gate no MVP.
- Job de matriz de bancos verde para merge.
- Nenhum segredo em log/span/erro (fixture global falha a suíte).
- Toda categoria de NFR com evidência identificada (tabela acima). O PASS/CONCERNS/FAIL final fica com o `bmad-testarch-nfr` quando houver implementação.

## Step 5 — Saídas geradas

- Modo de execução: sequencial (sem subagentes).
- `_bmad-output/test-artifacts/test-design-architecture.md`
- `_bmad-output/test-artifacts/test-design-qa.md`
- `_bmad-output/test-artifacts/test-design/Tecton-handoff.md`
- Validado contra `checklist.md`. Desvio consciente: o documento de arquitetura tem ~380 linhas (alvo de 150–200) por cobrir o MVP inteiro (61 stories) e os 14 planos de mitigação.
