---
title: 'TEA Test Design → BMAD Handoff Document'
version: '1.0'
workflowType: 'testarch-test-design-handoff'
inputDocuments:
  - _bmad-output/test-artifacts/test-design-architecture.md
  - _bmad-output/test-artifacts/test-design-qa.md
  - _bmad-output/planning-artifacts/epics.md
sourceWorkflow: 'testarch-test-design'
generatedBy: 'TEA Master Test Architect'
generatedAt: '2026-10-08'
projectName: 'Tecton'
---

# TEA → BMAD: repasse de integração

## Propósito

Liga o Test Design às stories. Como o `epics.md` já está completo (61 stories), este repasse serve ao **Create Story** e ao **Validate Story**: indica o que cada story precisa incorporar como critério de aceite ou nota técnica.

## Inventário dos artefatos TEA

| Artefato | Caminho | Ponto de integração |
|---|---|---|
| Test Design (arquitetura) | `_bmad-output/test-artifacts/test-design-architecture.md` | Bloqueios, ASRs, planos de mitigação |
| Test Design (QA) | `_bmad-output/test-artifacts/test-design-qa.md` | Cenários P0–P3 por story |
| Avaliação de riscos | (dentro do Test Design de arquitetura) | Prioridade das stories |
| Estratégia de cobertura | (dentro do Test Design de QA) | Requisitos de teste por story |

## Orientação por épico

### Referências de risco

| Épico | Riscos altos (score 6) |
|---|---|
| Epic 1 | R-08 (matriz de bancos nasce na 1.1) |
| Epic 2 | R-01, R-02, R-09, R-14 |
| Epic 3 | R-01, R-05, R-06, R-07, R-09, R-10 |
| Epic 4 | R-03, R-04, R-08, R-09, R-11, R-13 |
| Epic 5 | R-12 |
| Epic 6 | R-01, R-08, R-09 |

### Quality gates por épico

- Todos os P0 do épico verdes; P1 ≥ 95%.
- Riscos de score 6 do épico mitigados e com teste verde antes de fechá-lo.
- Matriz de bancos verde para todo teste `persistence`.
- Fixture global de segredos sem detecção.

## Orientação por story

### Cenários P0/P1 que devem virar critério de aceite ou nota técnica no Create Story

| Story | O que incorporar | Origem |
|---|---|---|
| 1.1 | Escolha do Vitest e do Playwright no README; tag `persistence`; job de matriz | TC-9, R-08 |
| 2.1 | Porta `Clock` em `@tecton/providers` (ou na primeira story que precisar de tempo) | ASR-1 |
| 2.2 | 401 idêntico verificado por comportamento (hash fictício), não por tempo | TC-7, R-17 |
| 2.3 | Comportamento documentado para refresh concorrente legítimo | R-16 |
| 2.4 | Estratégia de TLS do JWKS em teste; refetch de `kid` com limite verificável | ASR-4, R-02 |
| 3.10 | **Canonicalização da assinatura** (JCS/RFC 8785) e lista de atributos assinados | ASR-6, R-07 |
| 3.11 | **Seleção por linhas pendentes, nunca watermark; fencing token no lock**; teste de N transações concorrentes | ASR-7, R-05 |
| 3.11, 3.12 | Relay e consumidor decompostos em passos testáveis para simular queda | ASR-3, R-06 |
| 3.12 | Teste de poison message | R-06 |
| 3.13 | Teste negativo: Auth sem flag dev → endpoint de registro 404 | R-10 |
| 4.1 | Casos dirigidos às diferenças entre bancos (JSON no MariaDB, isolamento) | R-08 |
| 4.3 | Falha injetada em cada etapa do `createUser` | R-11 |
| 4.4 | Oráculo de ACL + teste por propriedade; revogação via grupo aninhado | R-04 |
| 4.7 | Single-flight do refresh entre requisições paralelas | R-16 |
| 4.x (início) | Fixture `tectonStack()` e fábricas | ASR-5, R-13 |
| 5.6 | Decisão dupla concorrente → uma vence, outra 409 | R-12 |
| 5.8 | Tabela de regras de compatibilidade (enum, `format`, `nullable`, `output` opcional) | R-18 |
| Fim do Epic 3 | Varredura Zero Trust gerada dos manifests | R-01 |

### Divisão das stories grandes (pedida pelo usuário)

As stories 2.2, 3.4, 4.3, 5.6, 2.7 e 3.10 serão divididas no Create Story. Sugestão de corte alinhada aos riscos, para que cada parte tenha seus P0:

| Story | Corte sugerido |
|---|---|
| 2.2 | (a) credenciais + `auth bootstrap` + login + 401 idêntico; (b) EdDSA, JWKS, rotação de chaves, `tecton.yaml` do Auth, `apps/auth` no `new` |
| 2.7 | (a) registro de credencial de serviço, `--rotate`, emissão do token de serviço; (b) verificação com `Tecton-On-Behalf-Of` e `call:<domínio>` |
| 3.4 | (a) estrutura hexagonal + Awilix + bootstrap + checagem de imports; (b) Dockerfile multi-stage + schema Prisma próprio + variável de serviço |
| 3.10 | (a) chaves Ed25519 no registro + envelope + canonicalização e assinatura (ASR-6); (b) tabela de outbox + Unit of Work + transação nos 3 bancos |
| 4.3 | (a) `User`/`Group`, containment, membership e papéis; (b) `createUser` com Auth via `ServiceClient` e compensação, desativação, bootstrap integrado e ordem de subida |
| 5.6 | (a) verificação de aprovador (`reportingChain`), autoaprovação e decisão dupla; (b) execução após aprovação, reconferência de permissões, eventos `onApprove`/`onReject` e respostas do `pollUrl` |

### Requisitos de `data-testid`

A SPA deve preferir seletores por papel ARIA (já exigidos pelo UX-DR4/UX-DR11). `data-testid` só onde não há papel semântico:

- `tree-skeleton`, `detail-skeleton` (estados de carregamento)
- `detail-panel` (painel de detalhe)
- `form-error-summary` (mensagem de falha acima do formulário)
- `search-results-count` (região `aria-live`)

## Mapa risco → story

| Risco | Cat | P×I | Story/épico | Nível |
|---|---|---|---|---|
| R-01 | SEC | 2×3 | 2.4, 2.7, 3.6, 3.12, 6.5, 6.6 + varredura no fim do Epic 3 | API + Integration |
| R-02 | SEC | 2×3 | 2.4, 3.12 | Integration |
| R-03 | SEC | 2×3 | 4.2, 4.9, 5.5 | API |
| R-04 | SEC | 2×3 | 4.4, 4.8, 4.9 | Unit + Integration |
| R-05 | DATA | 2×3 | 3.10, 3.11 | Integration |
| R-06 | DATA | 2×3 | 3.12 | Integration |
| R-07 | SEC | 2×3 | 3.10, 3.12 | Unit + Integration |
| R-08 | TECH | 3×2 | 1.1, 3.10, 4.1, 6.1, 6.8 | Integration (matriz) |
| R-09 | SEC | 2×3 | 2.4, 2.5, 2.6, 3.7, 3.8, 3.11, 3.12, 4.4, 6.5 | Integration |
| R-10 | SEC | 2×3 | 2.2, 3.13 | Integration + CLI |
| R-11 | DATA | 2×3 | 4.3 | Integration |
| R-12 | BUS | 2×3 | 5.5, 5.6 | Integration + API |
| R-13 | TECH | 3×2 | 4.3, 4.4 | Integration |
| R-14 | TECH | 3×2 | 2.1–2.3 (infra) | — |
| R-15 | SEC | 2×2 | 3.8 | Integration |
| R-16 | SEC | 2×2 | 2.3, 4.7 | Integration + Component |
| R-17 | SEC | 2×2 | 2.2, 2.6 | Integration |
| R-18 | TECH | 2×2 | 5.7, 5.8 | Unit + CLI |
| R-19 | BUS | 2×2 | 6.6–6.8 | Integration + API |
| R-21 | PERF | 2×2 | Epic 3 (baseline) | Perf |
| R-22 | SEC | 2×2 | 3.7 | Integration |
| R-23 | SEC | 1×3 | 4.7, 4.10 | API + Component |
| R-24 | SEC | 1×3 | 3.9 | Integration |

## Sequência recomendada BMAD ↔ TEA

1. **TEA Test Design** (`TD`) → este repasse ✅
2. **TEA Test Framework** (`TF`) e **CI Setup** (`CI`) → fixtures e pipeline
3. **BMAD Check Implementation Readiness** e **Sprint Planning**
4. Por story: **Create Story** (incorporando este repasse) → **Validate Story** → **Dev Story** (testes junto com o código; ATDD opcional para stories P0-pesadas)
5. **TEA Trace** (`TR`) ao fim de cada épico → matriz de rastreabilidade e gate
6. **TEA NFR** quando houver evidência

## Gates entre fases

| De | Para | Critério |
|---|---|---|
| Test Design | Criação de stories | Todo risco P0 com estratégia de mitigação ✅ |
| Criação de stories | Dev Story | Story incorpora os itens desta tabela que a afetam |
| Dev Story | Fechamento da story | Testes P0 da story verdes |
| Fechamento do épico | Próximo épico | Trace do épico com ≥ 80% de cobertura de P0/P1 e riscos de score 6 mitigados |
