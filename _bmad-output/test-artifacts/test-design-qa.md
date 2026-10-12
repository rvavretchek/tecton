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
  - _bmad-output/test-artifacts/test-design-architecture.md
---

# Test Design para QA: Tecton (MVP completo)

**Propósito:** receita de execução dos testes: o que testar, como e o que precisa existir antes.

**Data:** 2026-10-08
**Autor:** Murat (Master Test Architect, BMAD TEA) para o Boss
**Status:** Rascunho
**Projeto:** Tecton

**Relacionado:** `test-design-architecture.md` (preocupações de testabilidade, bloqueios e planos de mitigação).

---

## Resumo executivo

**Escopo:** os 6 épicos e 61 stories do MVP: manifest e scaffold, Auth/Zero Trust, interoperabilidade (Gateway, `ServiceClient`, eventos assinados), Directory e SPA `/admin`, formato de API e contratos, CLI completo e `extract`.

**Resumo de riscos:**

- 27 riscos (14 com score ≥ 6, 10 médios, 3 baixos)
- Categorias críticas: **SEC** (8 dos 14 altos) e **DATA** (3 dos 14), concentradas nos Epics 2 a 4

**Resumo de cobertura:**

- P0: ~210–240 cenários (segurança, isolamento, mensageria confiável, posturas de falha), incluindo a varredura Zero Trust gerada
- P1: ~190–220 (fluxos principais, CLI, i18n, UI)
- P2: ~25–35 (bordas e conveniências)
- P3: ~4–6 (baselines de desempenho, build de imagem)
- **Total:** ~430–500 cenários, ~140–230 h (~3,5–6 semanas de tempo integral) para um dev solo, distribuídas pelos épicos

---

## Fora de escopo

| Item | Motivo | Mitigação |
|---|---|---|
| **Implementação real do `KeyCustodyProvider`** (OpenBAO, quórum x/n) | Roadmap (PRD §6.2) | A pendência de `sensitive.quorum` usa provider falso (Story 5.5); a interface é verificada por tipo (2.8) |
| **`test:contracts --verify-providers`** | Roadmap (PRD §6.2) | `test:contracts` compara schemas (5.7–5.8) |
| **Circuit breaker/bulkhead** | Roadmap | Só o ponto de extensão é testado (middleware plugável, 3.9) |
| **Drag-and-drop na árvore** | Roadmap (FR-8) | Teste negativo: nenhum sinal de arrasto (4.8) |
| **DR, failover, SLA, blue/green, rollback automático** | Responsabilidade de quem opera o sistema construído, não do framework | Dockerfile por domínio e health checks testados (3.2, 3.4) |
| **Keycloak e OpenBAO como adaptadores** | Roadmap (PRD §6.2) | A ponte legada testa JWT de provedor externo (6.5) |
| **MS-SQL** | Fora do MVP desde 2026-10-06 | — |
| **Carga e estresse com gate** | Sem limite definido (R-21) | Baseline P3 sem gate |
| **Verificação de bibliotecas de terceiros** (Argon2, jose, Prisma, `@rjsf`) | Testadas pelos mantenedores | Testes cobrem só o uso que o Tecton faz delas |

---

## Dependências e bloqueios de teste

### Dependências de arquitetura (pré-implementação)

Detalhes no guia rápido do documento de arquitetura.

1. **ASR-1: porta `Clock`** — Boss — antes da Story 2.2
   - Permite avançar o tempo nos testes de expiração.
   - Sem ela, os testes de TTL dependem de espera real.
2. **ASR-6: canonicalização da assinatura** — Boss — Create Story da 3.10
   - Define os vetores fixos.
   - Sem ela, não há oráculo para a assinatura.
3. **ASR-7: semântica do outbox** — Boss — Create Story da 3.10/3.11
   - Define o que o teste de concorrência afirma.
4. **ASR-3: costuras de queda** — Boss — Create Story da 3.11/3.12
   - Necessárias para os testes de at-least-once.

### Infraestrutura de teste (pré-implementação)

1. **Fábricas de dados** (por pacote, gravando via Prisma só em código de teste)
   - `credentialFactory`, `serviceCredentialFactory`, `tenantFactory`, `userFactory`, `groupFactory`, `grantFactory`, `outboxRowFactory`, `manifestFactory` (YAML válido mínimo + mutações)
   - Dados sintéticos com faker; nenhum dado de produção
   - Um Tenant novo por teste, para isolamento e paralelismo
2. **Fábrica de tokens** (`tokenFactory`): tokens válidos assinados com chave de teste e variantes forjadas (`none`, HS256, RS256, `kid` desconhecido, `exp`/`iss`/`aud` errados).
3. **Fixtures**
   - `clock`: relógio controlável (ASR-1)
   - `valkey`, `postgres`/`mariadb`/`mysql`: Testcontainers por suíte
   - `toxiproxy`: `withDependencyDown('valkey' | 'jwks' | 'directory' | 'legacy')` (ASR-2)
   - `jwksTls`: certificado autoassinado e CA confiável só no processo de teste (ASR-4)
   - `tectonStack()`: Auth + Directory + Gateway + domínio de teste com chaves e credenciais registradas (ASR-5)
   - `capturedOutput`: captura de logs e spans com varredura de segredos ao final de cada teste
4. **Ambientes**
   - Local: Docker + Testcontainers; Dev Services só para desenvolvimento manual, nunca para teste
   - CI: GitHub Actions com Docker; matriz de bancos para a tag `persistence`
   - Laboratório Integrit: validação manual contra infra real e monólitos do SM-1/SM-2 (Epic 6)

**Exemplo de padrão** (nível API, contra `tectonStack()`):

```typescript
import { test } from '@seontechnologies/playwright-utils/api-request/fixtures';
import { expect } from '@playwright/test';

test('@P0 @API @Security forged identity header is ignored', async ({ apiRequest, stack }) => {
  const userA = await stack.users.create({ tenant: stack.tenantA });
  const userB = await stack.users.create({ tenant: stack.tenantA });
  const token = await stack.login(userA);

  const { status, body } = await apiRequest({
    method: 'POST',
    path: '/directory/get-object',
    headers: { Authorization: `Bearer ${token}`, 'x-user-id': userB.id },
    body: { id: userA.id },
  });

  expect(status).toBe(200);
  expect(body.id).toBe(userA.id);
});
```

---

## Avaliação de riscos

Detalhes completos no documento de arquitetura.

### Alta prioridade (score ≥ 6)

| Risco | Cat | Descrição | Score | Cobertura de teste |
|---|---|---|---|---|
| **R-01** | SEC | Borda pulando Zero Trust | **6** | Varredura gerada (P0-001) + bordas explícitas (P0-010 a P0-014, P0-034) |
| **R-02** | SEC | Verificação de JWT | **6** | Tokens forjados (P0-010 a P0-012) |
| **R-03** | SEC | Vazamento entre Tenants | **6** | Matriz endpoint × Tenant (P0-040) |
| **R-04** | SEC | ACL efetiva e revogação | **6** | Teste por propriedade + revogação via grupo aninhado (P0-042, P0-043) |
| **R-05** | DATA | Outbox sob concorrência | **6** | Completude com transações paralelas + fencing (P0-030, P0-031) |
| **R-06** | DATA | At-least-once e dedupe | **6** | Costuras de queda + poison message (P0-032, P0-033) |
| **R-07** | SEC | Canonicalização | **6** | Vetores fixos + ida e volta (P0-029) |
| **R-08** | TECH | Portabilidade de banco | **6** | Job de matriz (P0-028, P0-038, P1 do Epic 6) |
| **R-09** | SEC | Posturas de falha | **6** | Matriz Toxiproxy (P0-002) |
| **R-10** | SEC | Endpoint dev em produção | **6** | P0-035 |
| **R-11** | DATA | `createUser` distribuído | **6** | P0-041 |
| **R-12** | BUS | `approval` | **6** | P0-050, P0-051 |
| **R-13** | TECH | Auth↔Directory e bootstrap | **6** | P0-041, P0-044 |
| **R-14** | TECH | Relógio | **6** | Infra (`clock`); verificada pela ausência de espera real |

### Média e baixa prioridade

| Risco | Cat | Descrição | Score | Cobertura de teste |
|---|---|---|---|---|
| R-15 | SEC | Idempotency-Key | 4 | P0-024 |
| R-16 | SEC | Refresh concorrente | 4 | P1-034 + P0-045 |
| R-17 | SEC | Enumeração de login | 4 | P0-006, P0-016 |
| R-18 | TECH | Falso negativo em `test:contracts` | 4 | P0-053 |
| R-19 | BUS | `extract` | 4 | P1-050 a P1-052 |
| R-20 | OPS | Tempo de CI | 4 | Estratégia de execução |
| R-21 | PERF | Sem SLO | 4 | P3-001, P3-002 |
| R-22 | SEC | `X-Forwarded-For` | 4 | P0-023 |
| R-23 | SEC | XSS/CSP | 3 | P0-046, P0-047 |
| R-24 | SEC | Retry cego | 3 | P0-026 |
| R-25 | TECH | Deriva de arquitetura | 2 | P1-003, P1-025, P1-048 |
| R-26 | OPS | Acessibilidade | 2 | P1-040 |
| R-27 | TECH | i18n | 2 | P1-036 |

---

## Plano de cobertura de NFR

| Categoria | Requisito / limite | Validação planejada | Ferramenta / nível | Evidência | Prioridade |
|---|---|---|---|---|---|
| Segurança (NFR-1) | Zero Trust em toda borda | Varredura gerada + bordas explícitas + tokens forjados | API + Integration | JUnit da suíte `security` com lista de rotas cobertas | P0 |
| Segurança (NFR-6) | Fail-closed / fail-open / fail-fast | Matriz Toxiproxy | Integration | JUnit da suíte `failure-modes` | P0 |
| Segurança | Segredos fora de log/span/erro | Fixture global de varredura de saída | Integration | Falha da suíte se detectar | P0 |
| Segurança | Headers do `/admin`, XSS | Verificação de CSP e payload de script | API + Component | JUnit | P0 |
| Confiabilidade | At-least-once, dedupe, dead-letter, ordem | Concorrência e queda | Integration | JUnit da suíte `messaging` | P0 |
| Confiabilidade (NFR-5) | Retry seguro, timeout 5000 ms | Suíte do `ServiceClient` e Idempotency-Key | Integration | JUnit | P0 |
| Portabilidade (NFR-4) | PG, MariaDB, MySQL | Matriz de bancos | Integration | JUnit por banco | P0 |
| Observabilidade (NFR-3) | `traceparent` de ponta a ponta | InMemorySpanExporter | Integration | JUnit; trace exportado no nightly | P1 |
| i18n (NFR-2) | PT-BR padrão, EN, `i18nKey` | Negociação de `Accept-Language` e consolidação de catálogo | Integration + Unit | JUnit | P1 |
| Contrato (NFR-7) | Evolução aditiva | Tabela de regras | Unit + CLI | JUnit | P0 |
| Acessibilidade | WCAG 2.2 AA | axe + percursos só com teclado | E2E | Relatório Playwright + axe | P1 |
| Manutenibilidade (NFR-8) | TS, DI, fronteiras | `check:deps`, checagem hexagonal, `lint:gateway`, cobertura | CI | Log de CI + relatório de cobertura | P1 |
| Desempenho | **UNKNOWN** | Baseline | autocannon/k6 | JSON do benchmark | P3 |

**Limites ou fontes de evidência ausentes:** P95 de action via Gateway, overhead de verificação, vazão do relay, tempo de propagação da revogação, tamanho máximo de árvore na busca e orçamento de tempo de CI. Precisam ser definidos antes do `bmad-testarch-nfr`.

---

## Critérios de entrada

- [ ] Requisitos e premissas aceitos (este documento e o de arquitetura revisados)
- [ ] Docker disponível localmente e no CI
- [ ] Framework de teste configurado (`bmad-testarch-framework`) com as fixtures `clock`, `toxiproxy` e `jwksTls`
- [ ] Pipeline de CI configurado (`bmad-testarch-ci`) com o job de matriz de bancos
- [ ] Bloqueios ASR-6 e ASR-7 decididos antes das Stories 3.10 e 3.11
- [ ] `tectonStack()` pronta antes do Epic 4

## Critérios de saída (por épico)

- [ ] Todos os P0 do épico passando
- [ ] P1 do épico ≥ 95% (falhas restantes com issue e justificativa)
- [ ] Riscos de score 6 do épico com mitigação implementada e teste verde
- [ ] Cobertura ≥ 80% nos pacotes de backend tocados; ≥ 90% nos módulos de segurança e mensageria
- [ ] Job de matriz de bancos verde
- [ ] Nenhum segredo detectado pela fixture global
- [ ] Nenhum bug de severidade alta aberto ligado a risco de score ≥ 6

---

## Plano de cobertura de testes

**IMPORTANTE:** P0/P1/P2/P3 indicam **prioridade e risco**, não momento de execução. Ver "Estratégia de execução".

Cada linha é um grupo de cenários; a coluna "Qtde" é a estimativa de casos. Os IDs de teste no código seguem `{EPIC}.{STORY}-{NÍVEL}-{SEQ}` (ex.: `2.4-INT-007`) e levam a tag de prioridade.

### P0 (crítico)

**Critério:** bloqueia funcionalidade central, risco alto, sem contorno, afeta todo sistema construído com o Tecton.

| ID | Requisito | Nível | Risco | Qtde | Notas |
|---|---|---|---|---|---|
| **P0-001** | Varredura gerada: toda action não pública de todo serviço sem token → 401; token de outro `aud` → 401; chamada direta sem Gateway também verificada | API | R-01 | ~1/action | Gerada dos manifests |
| **P0-002** | Matriz de posturas de falha: Valkey (revogação, lockout, idempotência, rate limit, relay), JWKS (serviço, consumidor), Directory (login), monólito (ponte) | Integration | R-09 | 10 | Toxiproxy |
| **P0-003** | Segredos nunca em log, span ou corpo de erro | Integration | — | fixture | Varredura global |
| **P0-004** | Bloco `auth` obrigatório na action; `public` × `requires`; formato `<recurso>:<ação>` (1.3) | Unit | R-01 | 5 | |
| **P0-005** | Argon2id + Pepper: HMAC antes do hash, PHC, rehash, Pepper ausente/curto falha (2.1) | Unit | — | 7 | |
| **P0-006** | Login: claims do token EdDSA, 401 idêntico para identificador inexistente e senha errada (hash fictício verificado), JWKS só com chave pública e várias chaves (2.2) | Integration | R-17 | 8 | Sem medir tempo |
| **P0-007** | `auth bootstrap` só local, segunda execução falha, senha nunca por argumento (2.2) | CLI | R-10 | 3 | |
| **P0-008** | Refresh: atributos do cookie, rotação, reuso revoga família, expirado/desconhecido, logout, nunca no corpo (2.3) | Integration | R-16 | 8 | Usa `clock` |
| **P0-009** | Domínio nunca recebe refresh (`Path` + corpo) (2.3) | API | R-01 | 1 | |
| **P0-010** | Sem Bearer → 401 antes do handler; chamada direta com token adulterado → 401 (2.4) | Integration | R-01 | 2 | |
| **P0-011** | `alg` `none`/HS256/RS256 rejeitados; `exp`/`iss`/`aud` (2.4) | Integration | R-02 | 6 | `tokenFactory` |
| **P0-012** | `kid` desconhecido: refetch único e limitado; continua desconhecido → 401 (2.4) | Integration | R-02 | 2 | |
| **P0-013** | Header de identidade forjado ignorado; 403 por permissão; `public` sem token executa (2.4) | Integration | R-01 | 3 | |
| **P0-014** | JWKS `https` obrigatório fora do dev; redirecionamento para outro host recusado; Auth fora e cache vazio → rejeita (2.4) | Integration | R-02, R-09 | 4 | `jwksTls` |
| **P0-015** | Revogação por `jti` e por sujeito, TTL = restante, logout revoga access, reuso de refresh revoga access (2.5) | Integration | — | 6 | |
| **P0-016** | Lockout: N falhas, 429 + `Retry-After` mesmo com senha correta, identificador inexistente igual, várias origens, sucesso zera, `unlock`, log sem senha (2.6) | Integration | R-17 | 8 | |
| **P0-017** | Registro de serviço só com `auth:service:register`; sem sobrescrever sem `--rotate`; rotação revoga antigos e seus tokens (2.7) | Integration | R-01 | 4 | |
| **P0-018** | Token de serviço `typ: service`, sem refresh, recusado em login/refresh (2.7) | Integration | R-01 | 3 | |
| **P0-019** | `Tecton-On-Behalf-Of`: dois tokens verificados, `requires` contra o usuário (ou contra o serviço sem usuário), um inválido → 401 (2.7) | Integration | R-01 | 4 | |
| **P0-020** | `call:<domínio>` exigido; domínio fora de `dependencies` → 403 mesmo com usuário válido (2.7) | Integration | R-01 | 2 | |
| **P0-021** | OTel: `Authorization`, tokens, senhas e cookies nunca em span ou log (3.3) | Integration | — | 2 | |
| **P0-022** | Gateway: 401 sem encaminhar, `Authorization` original intacto, remoção de `Tecton-On-Behalf-Of`/`x-user-id`, sem transformação, 404 em prefixo desconhecido (3.6) | API | R-01 | 6 | |
| **P0-023** | Rate limit: `X-Forwarded-For` só de proxy confiável; Valkey fora → passa com aviso limitado (3.7) | Integration | R-22, R-09 | 3 | |
| **P0-024** | Idempotency-Key: repetição devolve resposta, corpo diferente 422, em andamento 409 (concorrente), 5xx não guardado, escopo por sujeito, chave inválida 400, Valkey fora 503 (3.8) | Integration | R-15 | 8 | |
| **P0-025** | `ServiceClient` leva token de serviço, `On-Behalf-Of` e `traceparent`; vai direto ao destino (3.9) | Integration | R-01 | 3 | |
| **P0-026** | Mutação sem `idempotent` e sem chave: **nenhum retry** (3.9) | Integration | R-24 | 2 | |
| **P0-027** | Outbox: dados e outbox na mesma transação; rollback e payload inválido desfazem os dois; Valkey fora não afeta a action (3.10) | Integration | R-05 | 4 | `persistence` |
| **P0-028** | Outbox com comportamento transacional idêntico nos 3 bancos (3.10) | Integration | R-08 | 3 | Matriz |
| **P0-029** | Envelope completo e assinado (`tectonsig`); vetores fixos de canonicalização; ida e volta (3.10) | Unit + Integration | R-07 | 5 | |
| **P0-030** | Relay: ordem, um líder por lock, reenvio com mesmo `id` após queda, Valkey fora mantém pendente sem pular (3.11) | Integration | R-05 | 5 | Costura de queda |
| **P0-031** | Relay sob N transações concorrentes: nenhum confirmado perdido, nenhum desfeito publicado; líder antigo com lock expirado não marca (3.11) | Integration | R-05 | 2 | Fencing |
| **P0-032** | Consumidor: assinatura antes do handler; chave de outro domínio ou ausente → ACK + log de segurança; JWKS fora → reprocessa (3.12) | Integration | R-07, R-09 | 4 | |
| **P0-033** | Consumidor: dedupe por `id`; queda após efeito reprocessa; dead-letter após 5; schema inválido direto para dead-letter; poison message não trava (3.12) | Integration | R-06 | 6 | |
| **P0-034** | Consumidor: JWKS por `https` e sem redirecionamento (3.12) | Integration | R-02 | 1 | |
| **P0-035** | Registro automático só com modo dev explícito; endpoint inexistente fora dele; verificação de token ligada no dev (3.13) | Integration | R-10 | 3 | |
| **P0-036** | Closure Table: move para descendente rejeitado; containment por `allowedParents`/`allowedChildren`; `readOnly` só por action específica (4.1) | Integration | R-08 | 5 | `persistence` |
| **P0-037** | Tenant: `tenant:create` só em `Root`; todo objeto pertence a Tenant; `suspended` bloqueia mutação; `archived` bloqueia tudo menos leitura/export (4.2) | Integration | R-03 | 6 | |
| **P0-038** | Directory nos 3 bancos sem mudança de schema ou código (4.1) | Integration | R-08 | matriz | |
| **P0-039** | Export do Tenant com aviso da 2.8 (4.2) | Integration | — | 1 | |
| **P0-040** | Isolamento entre Tenants: listar, buscar, detalhe, editar, export, pendência → 404 (4.2, 4.9, 5.5) | API | R-03 | 8 | Dois Tenants |
| **P0-041** | `createUser` com compensação em cada falha; `create-credential` só de `service:directory`; senha nunca em log; desativação revoga tokens (4.3) | Integration + API | R-11, R-13 | 7 | |
| **P0-042** | ACL efetiva por teste de propriedade contra oráculo; listagem só do legível; nó legível com pai ilegível vira topo; escrita negada (4.4) | Unit + Integration | R-04 | 6 | fast-check |
| **P0-043** | Remoção de permissão (inclusive via grupo aninhado) revoga tokens dos afetados; `perms` do token = raiz do Tenant (4.4) | Integration | R-04 | 3 | |
| **P0-044** | Directory fora → login/refresh falham e `/ready` do Auth indica; bootstrap na ordem errada falha com mensagem clara (4.3, 4.4) | Integration | R-13, R-09 | 3 | |
| **P0-045** | SPA: toda API pelo Gateway; access token só em memória (nunca `localStorage`/`sessionStorage`) (4.7) | E2E | R-01 | 2 | |
| **P0-046** | Headers do `/admin`: CSP sem inline/eval, `frame-ancestors 'none'`, `nosniff`, `no-referrer` (4.7) | API | R-23 | 2 | |
| **P0-047** | Valor de atributo com HTML/script renderizado como texto na árvore, busca e detalhe (4.10) | Component | R-23 | 3 | |
| **P0-048** | Nó ou resultado de busca sem permissão de leitura nunca aparece nem conta (4.8, 4.9) | Component + API | R-04 | 2 | |
| **P0-049** | Payload do evento do Directory nunca contém senha, hash ou credencial (4.5) | Integration | — | 1 | |
| **P0-050** | Pendência `202`: action não executa; `sensitive.quorum` sem provider executa com aviso (2.8 tem precedência); terceiro consultando → 404 (5.5) | Integration | R-12 | 3 | Provider falso |
| **P0-051** | Decisão de `approval`: aprovador verificado no Directory na hora, autoaprovação 403, permissões reconferidas, quem perdeu permissão → não executa, decisão dupla concorrente → 409 (5.6) | Integration + API | R-12 | 6 | |
| **P0-052** | Erro 500 nunca contém stack, mensagem de exceção ou nome de tabela; campo fora do `output` nunca vaza (5.1, 5.2, 5.4) | Integration | — | 3 | |
| **P0-053** | Regras de compatibilidade: opcional novo passa; remover/renomear/trocar tipo falham; obrigatório novo em `input` falha; enum estreitado, `format` e `nullable` conforme a tabela decidida (5.8) | Unit | R-18 | 10 | |
| **P0-054** | `LegacyAuthBridge`: 3 adaptadores, `iss`/`aud`/`azp`, usuário sem correspondência → 401, monólito fora → rejeita, `setLegacyId` só admin/serviço de importação, edição genérica não altera (6.5) | Integration | R-01, R-09 | 8 | |
| **P0-055** | Adaptador legado verifica a ponte antes de tudo e executa a action pelo caminho normal com ACL (6.6) | Integration | R-01 | 2 | |

**Total P0:** ~210–240 (≈ 190 explícitos + varredura gerada)

---

### P1 (alto)

**Critério:** funcionalidade importante, fluxo comum, risco médio.

| ID | Requisito | Nível | Risco | Qtde |
|---|---|---|---|---|
| **P1-001** | Núcleo do manifest: versão, kebab-case, semver, chave desconhecida, erros agregados com `path`/`code`/`message`, linha e coluna, JSON Schema exportado (1.2) | Unit | — | 10 |
| **P1-002** | Actions e events: tipos curtos, `sensitive` sem `description`, exclusividade, `idempotent` padrão, `type` CloudEvents, `emit` inexistente (1.3, 1.4) | Unit | — | 12 |
| **P1-003** | `check:deps` falha com arquivo, import e regra (1.1) | Integration | R-25 | 2 |
| **P1-004** | `objectClass`: `allowedParents`, `x-tecton-unique`, `readOnly`, padrões, manifests de exemplo (1.5) | Unit | — | 7 |
| **P1-005** | `lint`: 3 caminhos de resolução, referência não resolvida, URL remota, ciclo como aviso, `--format json`, divergência do `AGENTS.md` (1.6, 1.10) | CLI | — | 10 |
| **P1-006** | Rotas Fastify: `POST /<domínio>/<action>`, 400 pré-handler, 501, OpenAPI atualizado (1.7) | Integration | — | 6 |
| **P1-007** | Abstração única de erro (1.7) | Unit + estático | — | 2 |
| **P1-008** | `new`: workspace compila, AD-4, link local, destino não vazio, nome inválido, `--help` em inglês, sementes de documentação (1.9) | CLI | R-20 | 8 |
| **P1-009** | `generate domain`: variádico, `--from`, atomicidade, fora de workspace, *walking skeleton* 501 (1.10) | CLI | — | 6 |
| **P1-010** | Refresh concorrente legítimo: comportamento documentado (2.3) | Integration | R-16 | 2 |
| **P1-011** | `KeyCustodyProvider`: aviso por execução, nenhum método recebe requisição HTTP (2.8) | Unit | — | 3 |
| **P1-012** | `ConfigProvider`: ausente, formato inválido, vários erros, segredo mascarado, núcleo sem `process.env`, `.env` no `.gitignore` (3.1) | Unit + estático | — | 6 |
| **P1-013** | Health: `/live` 200, `/ready` 503 com a dependência, sem token, sem segredo (3.2) | Integration | — | 5 |
| **P1-014** | OTel: trace continua/cria, `trace_id` no log, sem endpoint só avisa (3.3) | Integration | — | 4 |
| **P1-015** | Esqueleto hexagonal: estrutura, stub 501, checagem falha com import concreto, schema Prisma próprio, variável de serviço (3.4) | CLI + Integration | R-25 | 5 |
| **P1-016** | Gateway: tabela de rotas dos manifests, `traceparent`, cookie de refresh atravessa (3.6) | API | — | 3 |
| **P1-017** | Rate limit: IP × `sub`, 429 + `Retry-After`, contagem compartilhada, health fora da contagem (3.7) | Integration | — | 4 |
| **P1-018** | `ServiceClient`: tipagem por `dependencies`, recusa fora delas, timeout 5000 ms e por chamada, retry com backoff e mesma chave, middleware plugável, erro tipado (3.9) | Integration | — | 6 |
| **P1-019** | Relay: aviso de atraso no `/ready`, limpeza por retenção (3.11) | Integration | — | 3 |
| **P1-020** | Consumidor: ordem no stream, trace continua (3.12) | Integration | — | 2 |
| **P1-021** | Closure Table: move altera só a subárvore, validação de atributos pelo schema, unicidade (4.1) | Integration | R-08 | 5 |
| **P1-022** | Usuário/Grupo: containment, membership separada, papéis, bootstrap cria Tenant + admin (4.3) | Integration | — | 4 |
| **P1-023** | Eventos do Directory: lista mínima, outbox na mesma transação, consumidor de teste sem tocar o banco, AsyncAPI (4.5) | Integration | — | 4 |
| **P1-024** | `@tecton/ui`: tokens CSS, troca de um slot, `ScreenLayout` só posiciona, segundo `Core` lança erro (4.6) | Component | — | 5 |
| **P1-025** | `@tecton/ui` não importa `@tecton/directory`; sem literal de texto (4.6) | Estático | R-25 | 2 |
| **P1-030** | Login na SPA: mensagem única, tempo de bloqueio, refresh e repetição, sessão expirada, logout, layout inicial (4.7) | E2E | R-16 | 6 |
| **P1-031** | Árvore: expandir sob demanda, ícones, teclado, ARIA completo, nenhum sinal de arrasto, foco visível (4.8) | Component + E2E | — | 7 |
| **P1-032** | Busca: servidor após debounce, ancestrais expandidos, foco, `aria-live`, sem resultado, limpar (4.9) | Component | — | 6 |
| **P1-033** | Menu e detalhe: 2 itens, edição some sem permissão, foco e `Esc`, rótulos do catálogo (4.10) | Component | — | 5 |
| **P1-034** | Single-flight do refresh com requisições paralelas (4.7) | Component | R-16 | 2 |
| **P1-035** | Formulário: campo novo sem código, i18n, erro abaixo do campo com foco e `aria-live`, salvar, falha preserva dados, cancelar, `readOnly` não enviado (4.11) | Component + E2E | — | 8 |
| **P1-036** | Catálogo i18n: PT-BR padrão, EN, namespace obrigatório, duplicata falha (4.6) | Unit | R-27 | 3 |
| **P1-040** | Estados e acessibilidade: skeletons, vazio, erro com "Tentar novamente", axe sem violações, fluxos 1 e 2 só com teclado, microcopy (4.12) | E2E | R-26 | 8 |
| **P1-041** | Sucesso puro e `traceparent` em toda resposta (5.1) | Integration | — | 2 |
| **P1-042** | RFC 9457: `problem+json`, URN estável, `i18nKey`, EN/PT-BR/idioma desconhecido, migração pelo serializador, SPA usa `title`/`detail`, `ServiceClient` tipado (5.2) | Integration + API | — | 8 |
| **P1-043** | `invalid-params`: 422 com JSON Pointer traduzido, todos os campos, exclusivo de validação, SPA por campo (5.3) | Integration + Component | — | 5 |
| **P1-044** | Erros de domínio de terceiros: URN com domínio, texto do dev sem catálogo, tradução com catálogo, chave fora do namespace falha o startup (5.4) | Integration | — | 4 |
| **P1-045** | Pendência: poll repete 202, expirado, `requestId` desconhecido 404 (5.5) | Integration | — | 4 |
| **P1-046** | `approval`: eventos `onApprove`/`onReject` no outbox, poll devolve sucesso, 403 ou rejeição (5.6) | Integration | — | 3 |
| **P1-047** | `test:contracts`: snapshot, comparação com o provedor, `consumes` × `publishes`, mensagem com provedor/action/consumidor/campo, código de saída, `--format json` (5.7) | CLI | R-18 | 6 |
| **P1-048** | `lint:gateway`: dependências e imports proibidos, código de saída, `--format json`, workflow do GitHub Actions gerado (6.2) | CLI | R-25 | 6 |
| **P1-049** | `migrate`: por serviço, `--domain`, `create`, falha lista o que foi aplicado, URL inválida, 3 bancos (6.1) | CLI + Integration | R-08 | 6 |
| **P1-050** | `extract` parte 1: domínio pelo manifest, stubs de tradutor, tradução só no adaptador, lembrete do `AGENTS.md` (6.6) | CLI | R-19 | 4 |
| **P1-051** | `extract` parte 2: fachada 100% monólito, desvio por rota/percentual/flag sem alterar corpo, aviso de percentual, janela 503 + drenagem, fim em 100% novo (6.7) | API | R-19 | 7 |
| **P1-052** | `extract` parte 3: script por introspecção, `setLegacyId` via `ServiceClient`, contagem falha em diferença, retomada sem duplicar, 3 bancos (6.8) | Integration | R-19 | 6 |

**Total P1:** ~190–220

---

### P2 (médio)

**Critério:** fluxos secundários, risco baixo, bordas.

| ID | Requisito | Nível | Risco | Qtde |
|---|---|---|---|---|
| **P2-001** | AsyncAPI válido no `@asyncapi/parser`, manifest sem `events` (1.8) | Unit + CI | — | 3 |
| **P2-002** | Dev Services por banco e banco lógico por domínio (1.11) | CLI | — | 4 |
| **P2-003** | Discovery estático: variável ausente → fail-fast, adaptador falso (3.5) | Unit | — | 3 |
| **P2-004** | `tecton-admin dev`: sobe tudo, migrations, reinício só do serviço alterado, falha isolada, `Ctrl+C` limpo, sugestão de bootstrap (3.13) | CLI E2E | — | 6 |
| **P2-005** | Aviso de `sensitive.quorum` no lint, `--strict` (6.3) | CLI | — | 3 |
| **P2-006** | Testcontainers: execuções sem estado compartilhado, sem Docker → mensagem clara (6.4) | Integration | — | 3 |
| **P2-007** | `--help` completo, `mcp:serve` roadmap sai ≠ 0, ajuda em inglês (6.9) | CLI | — | 3 |

**Total P2:** ~25–35

---

### P3 (baixo)

| ID | Requisito | Nível | Notas |
|---|---|---|---|
| **P3-001** | Baseline de latência P95 de action via Gateway e overhead de verificação | Perf (autocannon/k6) | Sem gate até existir limite (R-21) |
| **P3-002** | Busca com ACL em árvore de 1.000 objetos | Integration | Baseline |
| **P3-003** | Build de imagem Docker por domínio: multi-stage, sem root, sem código de outro domínio (3.4) | Integration | Nightly |

**Total P3:** ~4–6

---

## Estratégia de execução

**Filosofia:** tudo que é funcional roda no PR enquanto couber em ~15 min; o caro vai para o nightly.

### Todo PR (~10–15 min)

- Unit e Integration (Vitest + Testcontainers, PostgreSQL apenas), Component, API P0/P1 contra `tectonStack()`
- Snapshot dos templates do CLI, `check:deps`, `lint`, AsyncAPI
- Paralelizado por pacote (Vitest em workers, Playwright em shards); centenas de testes cabem em 10–15 min

### PR que toca `persistence` e merge em `main` (~15 min em paralelo)

- Testes com tag `persistence` em PostgreSQL, MariaDB e MySQL (obrigatório para merge, Story 1.1)

### Nightly (~30–45 min)

- E2E de UI completo com axe
- Geração completa de workspace (`new` → `generate` → build → subir) e `tecton-admin dev`
- Matriz Toxiproxy completa
- Build de imagens Docker

### Semanal ou manual

- Baselines de desempenho (P3)
- Validação no Laboratório Integrit contra infra real
- `extract` contra monólito sintético (e, depois, contra Arandu e Tupã para SM-1/SM-2)

---

## Estimativa de esforço

Esforço de desenvolvimento de testes (dev solo com apoio de agente):

| Prioridade | Qtde | Esforço | Notas |
|---|---|---|---|
| P0 | ~210–240 | ~70–110 h | Setup complexo (tokens forjados, Toxiproxy, concorrência, queda) |
| P1 | ~190–220 | ~55–90 h | Integração, CLI, UI |
| P2 | ~25–35 | ~10–20 h | Bordas simples |
| P3 | ~4–6 | ~4–8 h | Baselines |
| **Total** | **~430–500** | **~140–230 h (~3,5–6 semanas de tempo integral)** | Distribuído pelos 6 épicos |

**Premissas:**

- Inclui desenho, implementação, depuração e integração ao CI
- Não inclui manutenção contínua (~10%)
- Infraestrutura de teste (fixtures, fábricas, varredura gerada) soma ~20–35 h à parte, concentradas no Test Framework e no início dos Epics 2 e 4

---

## Repasse para o planejamento de implementação

| Item | Dono | Marco | Notas |
|---|---|---|---|
| Fixtures `clock`, `toxiproxy`, `jwksTls`, `capturedOutput` | Boss | Test Framework | ASR-1, ASR-2, ASR-4 |
| Pipeline com matriz de bancos e nightly | Boss | CI Setup | R-08, R-20 |
| Decisão de canonicalização (ASR-6) | Boss | Create Story 3.10 | Bloqueio |
| Decisão da semântica do outbox (ASR-7) | Boss | Create Story 3.10/3.11 | Bloqueio |
| Costuras de queda (ASR-3) | Boss | Create Story 3.11/3.12 | |
| `tectonStack()` e fábricas | Boss | Início do Epic 4 | ASR-5 |
| Single-flight do refresh | Boss | Create Story 4.7 | R-16 |
| Tabela de regras de compatibilidade | Boss | Create Story 5.8 | R-18 |
| Varredura Zero Trust gerada | Boss | Fim do Epic 3 | R-01 |
| Monólito sintético | Boss | Início do Epic 6 | R-19 |

---

## Ferramentas e acesso

| Ferramenta | Propósito | Acesso | Status |
|---|---|---|---|
| Docker (local e GitHub Actions) | Testcontainers, Toxiproxy | Já disponível | Ready |
| Toxiproxy (módulo Testcontainers) | Injeção de falha | Nenhum | Pending (Test Framework) |
| fast-check | Testes por propriedade da ACL | Nenhum | Pending |
| axe-core (Playwright) | Acessibilidade | Nenhum | Pending |
| Laboratório Integrit (ubt-host01) | Validação contra infra real e monólitos | Acesso do autor | Ready |

---

## Interligação e regressão

| Componente | Impacto | Escopo de regressão | Validação |
|---|---|---|---|
| **`@tecton/manifest`** | Base de todos os pacotes | Suíte inteira do manifest + `lint` + `test:contracts` | Todo PR |
| **`@tecton/core`** (verificação, erro, rotas, eventos) | Todo serviço | Varredura Zero Trust + suítes `security`, `messaging`, `failure-modes` | Todo PR |
| **`@tecton/auth`** | Login de todo sistema | Suíte do Epic 2 + P0-044 | Todo PR |
| **`@tecton/directory`** | Isolamento e ACL | P0-036 a P0-049 + matriz de bancos | Todo PR + matriz |
| **Formato de erro (Epic 5)** | Substitui o provisório dos Epics 2–4 | Todos os testes que afirmam corpo de erro dos Epics 2–4 | Na Story 5.2 |

**Estratégia de regressão:** cada épico entrega os testes junto com as stories; o Epic 5 atualiza as asserções de corpo de erro dos épicos anteriores num único passo (Story 5.2), sem mudar os cenários.

---

## Apêndice A: tags para execução seletiva

```typescript
// Vitest: tags no nome do teste
describe('@P0 @Security token verification', () => {
  it('rejects alg none', async () => { /* ... */ });
});

// Playwright: tags no título
test('@P0 @API @Security cross-tenant read returns 404', async ({ apiRequest, stack }) => { /* ... */ });
```

```bash
# Só P0
pnpm vitest run -t "@P0"
npx playwright test --grep @P0

# Só persistência (matriz de bancos)
TECTON_TEST_DB=mariadb pnpm vitest run -t "@persistence"
```

---

## Apêndice B: referências da base de conhecimento

- `risk-governance.md` — pontuação de risco
- `test-levels-framework.md` — escolha de nível
- `nfr-criteria.md` — validação de NFR
- `adr-quality-readiness-checklist.md` — testabilidade de arquitetura
- `test-quality.md` — definição de pronto (sem espera fixa, ≤ 500 linhas, < 1,5 min por teste)

---

**Gerado por:** BMad TEA Agent
**Workflow:** `bmad-testarch-test-design`
