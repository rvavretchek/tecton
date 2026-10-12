---
stepsCompleted: ['step-01-document-discovery', 'step-02-prd-analysis', 'step-03-epic-coverage-validation', 'step-04-ux-alignment', 'step-05-epic-quality-review', 'step-06-final-assessment']
documentsIncluded:
  prd: '_bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md'
  prdAddendum: '_bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/addendum.md'
  architecture: '_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md'
  architectureCompanion: '_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/UML.md'
  epics: '_bmad-output/planning-artifacts/epics.md'
  ux: ['_bmad-output/planning-artifacts/ux-designs/ux-Tecton-2026-09-03/DESIGN.md', '_bmad-output/planning-artifacts/ux-designs/ux-Tecton-2026-09-03/EXPERIENCE.md']
  testDesign: ['_bmad-output/test-artifacts/test-design-architecture.md', '_bmad-output/test-artifacts/test-design-qa.md']
---

# Implementation Readiness Assessment Report

**Date:** 2026-10-08
**Project:** Tecton

## Inventário de documentos

| Tipo | Documento usado | Modificado | Observação |
|---|---|---|---|
| PRD | `prds/prd-Tecton-2026-08-14/prd.md` (+ `addendum.md`) | 2026-10-07 | Pasta com reviews e reconciliações; sem versão fragmentada (sem `index.md`) |
| Arquitetura | `architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md` (+ `UML.md`) | 2026-10-07 | `reviews/` e `reconcile-constitution.md` são histórico |
| Épicos e stories | `epics.md` | 2026-10-07 | Os arquivos `.working/epic-*-stories-bloco-*.md` são rascunhos de trabalho já consolidados no `epics.md`; não entram na avaliação |
| UX | `ux-designs/ux-Tecton-2026-09-03/DESIGN.md` + `EXPERIENCE.md` | 2026-09-04 / 2026-10-01 | Escopo restrito ao admin do Directory |
| Complementar | `sprint-change-proposal-2026-09-02.md` | 2026-09-04 | Origem do AD-10 |
| Complementar | `test-artifacts/test-design-architecture.md`, `test-design-qa.md` | 2026-10-08 | Test Design system-level |

**Duplicatas:** nenhuma (nenhum documento existe nas formas inteira e fragmentada).
**Ausentes:** nenhum.

## PRD Analysis

### Functional Requirements

- **FR-1** Declaração de domínio via `tecton.yaml` com `manifestVersion`, `domain`, `version`, `description`; manifest sem `manifestVersion` é rejeitado; `generate domain` cria manifest inicial válido.
- **FR-2** `objectClass` opcional (containment + ACL herdável) só para domínios do Core de Diretório; sem `objectClass` o domínio não aparece na árvore; `objectClass` sem `containment.allowedParents` falha; o `lint` resolve `allowedParents` mesmo entre repositórios e falha explicitamente em referência não resolvível.
- **FR-3** Actions com `input`/`output` tipados; `sensitive.quorum` exige `description`; `approval.required` gera estado pendente; `sensitive.quorum` e `approval` são mutuamente exclusivos; `idempotent: true` orienta o retry do `ServiceClient`.
- **FR-4** `events.publishes`/`events.consumes` com schema; conector gerado (Valkey Streams, CloudEvents); nenhum código de broker escrito à mão; o consumo nunca acessa o banco do publicador.
- **FR-5** OpenAPI (`@fastify/swagger`) e AsyncAPI (validado por `@asyncapi/parser`) gerados do manifest; mudar `input`/`output` atualiza o OpenAPI no build.
- **FR-6** Hierarquia por Closure Table via Prisma (PostgreSQL, MariaDB, MySQL); trocar de banco não exige mudança de schema nem de código; mover é operação localizada; mover para descendente é rejeitado.
- **FR-7** ACL por herança aditiva, sem override por nó; consultar permissões é só somar heranças; o schema evolui para OpenFGA sem migração de dados.
- **FR-8** Navegação (só leitura) e edição de atributos por formulário `@rjsf/core` gerado de `objectClass.attributes`; sem drag-and-drop; atributo novo aparece sem código de UI; labels e validação multi-idioma.
- **FR-9** Tenant como raiz (`active`/`suspended`/`archived`); todo objeto pertence a um Tenant; `exportTenantData` marcada `sensitive`; `suspended` bloqueia mutações e mantém leitura; `archived` bloqueia tudo menos leitura e exportação.
- **FR-10** Usuário e Grupo contidos no Tenant, com associação usuário-grupo e papel; estrutura de equipe como containment; Usuário é a identidade autenticável.
- **FR-11** Interface `KeyCustodyProvider` e conceito `sensitive.quorum` no MVP; sem provider, a action executa com aviso explícito em runtime (precedência sobre o 202 da FR-25); o `lint` avisa; a interceptação futura é no nível de dado.
- **FR-12** `AuthProvider` (Argon2id + Pepper), JWT de acesso e refresh confinado ao Auth; nenhum serviço de domínio processa refresh. Nota de 2026-10-01: o Gateway repassa o token original (AD-7).
- **FR-13** Todo serviço verifica a assinatura do token por conta própria; chamada direta com token adulterado é rejeitada; toda chamada serviço-a-serviço leva credencial verificável.
- **FR-14** `TokenRevocationStore` real com Valkey; a revogação vale antes da expiração; Valkey inacessível → fail-closed.
- **FR-15** `tecton-admin new`, `generate` (variádico ou `--from`), `dev` (Gateway + domínios + Valkey com live reload) e `migrate`.
- **FR-16** `extract <domínio>`: scaffold + fachada Strangler Fig no Gateway (rota, percentual ou flag) + script único de export/import; corte em janela de manutenção com drenagem; percentual só para validação; descomissionamento manual.
- **FR-17** Família `lint`: `lint:gateway` (allowlist) e aviso de `sensitive.quorum` sem provider; o CI gerado falha em violação; agnóstico de plataforma.
- **FR-18** `test:contracts` testa os dois lados do manifest; mudar `output` sem atualizar o consumidor falha. `extract` e `mcp:serve` aparecem no `--help`.
- **FR-19** Gateway fino: roteia, valida token, aplica rate limit (Valkey) e propaga `traceparent`; nunca circuit breaker, retry em mutação, cache, transformação, agregação ou regra de negócio; `lint:gateway` falha com dependência proibida; rate limit fail-open.
- **FR-20** Discovery estático por `TECTON_SERVICE_<DOMÍNIO>_URL`, atrás de `ServiceDiscoveryProvider`; variável gerada por `new`/`generate`.
- **FR-21** CloudEvents sobre Valkey Streams, at-least-once, com credencial verificável; handler idempotente com chave de dedupe registrada depois do efeito; ordem por stream; um stream por domínio; dead-letter após N tentativas; evento sem credencial válida → ACK e log de segurança.
- **FR-22** `ConfigProvider` tipado com fail-fast; variável ausente ou inválida derruba o startup antes de aceitar tráfego, identificando o campo e o formato.
- **FR-23** Sucesso é o `output` puro, sem envelope; correlação por `traceparent`.
- **FR-24** Erro RFC 9457, com `invalid-params` só em erro de validação; `title`/`detail` por `Accept-Language` com `i18nKey`; PT-BR por padrão.
- **FR-25** Pendência como `202 Accepted` com `status`, `requestId` e `pollUrl`, só com aprovação real; o poll repete 202 e depois devolve sucesso, rejeição RFC 9457 ou expiração; `requestId` desconhecido → 404.
- **FR-26** `ServiceClient` gerado, com retry só em action idempotente ou com `Idempotency-Key`; timeout padrão de 5000 ms; credencial verificável; middleware plugável.
- **FR-27** `/health`, `/ready` e `/live` em todo serviço; `/ready` falha com dependência fora; `/live` independe das dependências.
- **FR-28** Dockerfile por domínio, com build independente.
- **FR-29** Evolução aditiva por padrão; remover, renomear ou trocar tipo é quebra capturada por `test:contracts`; mudança incompatível vira action nova, sem obrigação de manter a antiga.
- **FR-30** `docker-compose.dev.yml` com Valkey e o banco escolhido, sem setup manual.
- **FR-31** Testcontainers para `test:contracts` e CI; sem estado compartilhado entre execuções; sem infraestrutura persistente.

**Total de FRs: 31**

### Non-Functional Requirements

O PRD não tem uma seção numerada de NFRs: eles aparecem como NFR de feature (§4.4), no escopo do MVP (§6.1) e nas convenções. O `epics.md` os consolidou em 8, que conferem com o PRD:

- **NFR-1** Zero Trust em toda comunicação leste-oeste, síncrona ou assíncrona, sem exceção (PRD §4.4, Constitution §9).
- **NFR-2** i18n de toda superfície exposta ao usuário final, com PT-BR padrão e EN secundário (FR-8, FR-24, §6.1).
- **NFR-3** Observabilidade distribuída com OpenTelemetry e `traceparent` (§6.1).
- **NFR-4** Portabilidade entre PostgreSQL, MariaDB e MySQL (FR-6, §6.1).
- **NFR-5** Retry seguro, nunca cego (FR-26).
- **NFR-6** Três posturas distintas: fail-fast de configuração, fail-closed de segurança, fail-open de rate limit (FR-14, FR-19, FR-22).
- **NFR-7** Evolução de contrato sem quebrar consumidor (FR-18, FR-29).
- **NFR-8** TypeScript full-stack e DI leve com Awilix (§6.1).

**Total de NFRs: 8**

### Additional Requirements

- **Restrições de escopo (§5, §6.2):** nada de greenfield, app de demonstração, primitivo criptográfico próprio, descoberta automática de limites de domínio ou motor de workflow nativo. São roadmap: Custodiante real, `WorkflowEngineProvider`, MCP por domínio, Keycloak/OpenBAO, MS-SQL, `--verify-providers`, circuit breaker, CDC, Kubernetes e mTLS.
- **Contrato público (§8):** manifest, CLI e interfaces de Provider na mesma classe de contrato; sem política de depreciação antes da v1.0.
- **Métricas (§7):** SM-1 (Arandu) e SM-2 (Tupã) via `extract`; SM-3 portfólio com revisão externa; SM-C1 adoção não é meta.
- **Idioma (Constitution §8):** código, CLI e logs em inglês; superfícies de usuário final multi-idioma.
- **Addendum:** OpenBAO como candidato de roadmap do `ConfigProvider`; interceptação do quórum no nível de dado; motivação regulatória do Custodiante (LGPD, GDPR, HIPAA).

### PRD Completeness Assessment

O PRD está completo e testável: cada FR tem "Consequences (testable)", o MVP e o roadmap estão explícitos, e as decisões posteriores (AD-7, entrada do MariaDB, saída do MS-SQL e do `--verify-providers`) foram registradas como notas datadas. Restam duas lacunas, nenhuma bloqueante:

1. **Open Questions abertas.** A §9-1 (orçamento de desempenho e runtime) foi resolvida na Spine só na parte de runtime (Node 24, TS 6.0.3); não há orçamento de desempenho, e o Test Design de 2026-10-08 registrou isso como R-21 (UNKNOWN). A §9-5 (comparativo técnico com Moleculer, Dapr e NestJS) segue pendente; afeta só a alegação pública de diferenciação.
2. **NFRs sem seção própria no PRD.** Os 8 NFRs só estão consolidados no `epics.md`; o mapeamento confere.

## Epic Coverage Validation

### Coverage Matrix

| FR | Requisito (resumo) | Cobertura | Status |
|---|---|---|---|
| FR-1 | Declaração via manifest | Epic 1: 1.2, 1.10 | ✓ |
| FR-2 | `objectClass` opcional | Epic 1: 1.5, 1.6 | ✓ |
| FR-3 | Actions tipadas, `sensitive`/`approval`, `idempotent` | Epic 1: 1.3; Epic 5: 5.5, 5.6 | ✓ |
| FR-4 | Events e conector gerado | Epic 1: 1.4; Epic 3: 3.10–3.12 | ✓ |
| FR-5 | OpenAPI e AsyncAPI | Epic 1: 1.7, 1.8 | ✓ |
| FR-6 | Closure Table, 3 bancos, ciclo | Epic 4: 4.1 | ✓ |
| FR-7 | ACL por herança aditiva | Epic 4: 4.4 | ✓ |
| FR-8 | Navegação e formulário gerado, i18n | Epic 4: 4.6–4.12 | ✓ |
| FR-9 | Tenant e status | Epic 4: 4.2 | ✓ |
| FR-10 | Usuário e Grupo | Epic 4: 4.3 | ✓ |
| FR-11 | `KeyCustodyProvider` e aviso | Epic 2: 2.8; Epic 6: 6.3 | ✓ |
| FR-12 | `AuthProvider`, JWT, refresh confinado | Epic 2: 2.1–2.3 | ✓ |
| FR-13 | Verificação independente | Epic 2: 2.4, 2.7 | ✓ |
| FR-14 | Revogação fail-closed | Epic 2: 2.5 | ✓ |
| FR-15 | `new`, `generate`, `dev`, `migrate` | Epic 1: 1.9, 1.10; Epic 3: 3.13; Epic 6: 6.1 | ✓ |
| FR-16 | `extract` | Epic 6: 6.5–6.8 | ✓ |
| FR-17 | Família `lint` | Epic 6: 6.2, 6.3 | ✓ |
| FR-18 | `test:contracts` e `--help` | Epic 5: 5.7; Epic 6: 6.9 | ✓ |
| FR-19 | Gateway fino, fail-open | Epic 3: 3.6, 3.7; Epic 6: 6.2 | ✓ |
| FR-20 | Discovery estático | Epic 3: 3.4, 3.5 | ✓ |
| FR-21 | CloudEvents, at-least-once, dead-letter | Epic 3: 3.10–3.12 | ✓ |
| FR-22 | `ConfigProvider` fail-fast | Epic 3: 3.1 | ✓ |
| FR-23 | Sucesso puro | Epic 5: 5.1 | ✓ |
| FR-24 | RFC 9457, `invalid-params`, i18n | Epic 5: 5.2–5.4 | ✓ |
| FR-25 | `202 Accepted` | Epic 5: 5.5, 5.6 | ✓ (quórum com provider falso) |
| FR-26 | `ServiceClient` | Epic 3: 3.8, 3.9 | ✓ |
| FR-27 | Health checks | Epic 3: 3.2 | ✓ |
| FR-28 | Dockerfile por domínio | Epic 3: 3.4 | ✓ |
| FR-29 | Evolução aditiva | Epic 5: 5.8 | ✓ |
| FR-30 | Dev Services | Epic 1: 1.11 | ✓ |
| FR-31 | Testcontainers | Epic 6: 6.4 | ⚠️ ✓ com redefinição (ver abaixo) |

### Missing Requirements

Nenhum FR sem cobertura. Duas observações de rastreabilidade:

- **FR-31 × PRD §6.2.** O texto da FR-31 ainda diz que o `test:contracts` roda "contra containers efêmeros via Testcontainers". Com a saída do `--verify-providers` (2026-10-06), o `test:contracts` passou a comparar schemas, sem estado, e a Story 6.4 registra isso numa nota. A consequência "duas execuções não compartilham estado" continua verdadeira, mas por outro motivo. **Recomendação:** acrescentar à FR-31 uma nota datada, como já foi feito nas FR-6 e FR-12, para que o PRD não contradiga a story.
- **FR-25, rejeição de quórum.** "Quando a aprovação/quórum é rejeitada" só é testável com provider falso no MVP (nota da Story 5.5). Aceitável e já documentado.

Nenhum FR aparece nos épicos sem estar no PRD. Os requisitos extras dos épicos (ADs, UX-DR1 a UX-DR12) vêm da Spine e do UX, não são invenção.

### Coverage Statistics

- Total de FRs no PRD: 31
- FRs cobertos nos épicos: 31
- Cobertura: **100%**
- NFRs com mapa de cobertura no `epics.md`: 8 de 8

## UX Alignment Assessment

### UX Document Status

**Encontrado:** `DESIGN.md` (tokens da Camada 0 do `@tecton/ui`) e `EXPERIENCE.md` (comportamento, estados, acessibilidade e fluxos), ambos `final`, com mockup em `mockups/directory-admin.html`. Escopo deliberadamente restrito ao `/admin` do Directory (Proposta D do Sprint Change Proposal).

### UX ↔ PRD

- Os fluxos 1 e 2 da Marina realizam FR-8 (navegação + formulário gerado) e FR-9 (isolamento por Tenant). UX-DR1 a UX-DR12 estão todos mapeados nas Stories 4.6 a 4.12.
- O UX não introduz requisito ausente do PRD; o PRD não pede UI que o UX não cubra.

### UX ↔ Arquitetura

- AD-10 sustenta tudo o que o UX pede: runtime único `@tecton/ui`, tokens CSS, porta `UiThemeProvider`, SPA servida pelo Directory em `/admin`, API sempre pelo Gateway, namespace de `i18nKey`.
- AD-7 sustenta a regra de "nó sem permissão é invisível" (UX-DR6); a Story 4.4 entrega a listagem filtrada no backend.

### Alignment Issues

| # | Divergência | Onde | Severidade | Recomendação |
|---|---|---|---|---|
| UX-1 | O `EXPERIENCE.md` lista ícone para **Custodiante** na árvore, mas o Custodiante não é `objectClass` no MVP (só interface, Story 2.8); a Story 4.8 lista só Tenant, Grupo e Usuário. | EXPERIENCE "Component Patterns" × Story 4.8 | 🟡 | Seguir a story; registrar no `EXPERIENCE.md` que o ícone do Custodiante é roadmap |
| UX-2 | O Fluxo 1 mostra "contagem de membros" no detalhe do Grupo, um atributo derivado que nenhuma story calcula (a membership é separada do containment, Story 4.3). | EXPERIENCE Flow 1 × Stories 4.3/4.10 | 🟡 | Decidir no Create Story da 4.10: calcular e exibir, ou tirar do fluxo |
| UX-3 | A tabela de voz traz "Não foi possível salvar. Tentando novamente.", que sugere retry automático; os State Patterns e a Story 4.11 dizem que o usuário tenta de novo, com os dados preservados. | EXPERIENCE "Voice and Tone" × Story 4.11 | 🟡 | Seguir a story; trocar o exemplo de microcopy |
| UX-4 | O UX não especifica a tela de login (só "Login → redirecionamento"); a Story 4.7 define o comportamento, mas sem layout. | EXPERIENCE "Information Architecture" × Story 4.7 | 🟡 | Aceitável: a tela é mínima e usa os tokens existentes |
| UX-5 | Com o access token só em memória (Story 4.7), um recarregamento da página perde a sessão até o primeiro 401. Nada diz que a SPA chama `/auth/refresh` ao iniciar. | Story 4.7 | 🟡 | Acrescentar no Create Story da 4.7: refresh silencioso na inicialização, com single-flight (R-16 do Test Design) |

### Warnings

- **Sem metas de desempenho percebido** (tempo de carga da árvore, latência da busca em "centenas de usuários"). O Test Design registrou isso como R-21 (UNKNOWN). Não bloqueia.
- **O Epic 4 promete mais do que a UX entrega:** o resumo do épico diz que Marina "gerencia ACL por herança aditiva", mas não há tela de ACL nem de membership no MVP; isso é só API (Stories 4.3 e 4.4). Ver EQ-6 abaixo.

## Epic Quality Review

### Valor ao usuário

O usuário do Tecton é o dev (ou agente de IA) que constrói um sistema, e a Marina, administradora do sistema construído. Sob essa lente:

| Épico | Valor | Avaliação |
|---|---|---|
| 1 Manifest e scaffold | Dev cria workspace e declara domínio com validação e docs gerados | ✓ |
| 2 Auth e Zero Trust | Dev tem Auth pronto e todo serviço verifica token | ✓ (capacidade de produto num framework de segurança) |
| 3 Interoperabilidade | Domínios se comunicam com segurança sem plumbing manual | ✓ (o "plumbing" é exatamente o produto) |
| 4 Directory e domínios embutidos | Marina administra a árvore; dev ganha Tenant/Usuário/Grupo prontos | ✓ |
| 5 Formato de API e contrato | Cliente trata erro e pendência de forma uniforme; dev evolui contrato sem quebrar consumidor | ✓ |
| 6 CLI completo e DX | Dev migra um domínio de monólito (Caso 1) | ✓ |

Nenhum épico é marco técnico puro. A Story 1.1 (scaffold do monorepo) é técnica, mas é a story de setup inicial esperada num repositório novo sem starter template (a Spine diz que não há starter).

### Independência entre épicos

Nenhuma dependência para frente quebra um épico. Todas as referências a épicos futuros são explícitas e de enriquecimento, não de pré-requisito:

- Formato de erro provisório nos Epics 2 a 4, trocado no Epic 5 por um único serializador (Story 1.7 → 5.2).
- `perms` vem da credencial no Epic 2 e passa a vir do Directory no Epic 4 (2.2 → 4.4).
- `apps/gateway`, `apps/directory` e o `/admin` no `tecton-admin dev` entram quando existirem (1.9, 3.13).
- A Story 1.6 prevê o caminho de resolução por pacote npm que o Auth e o Directory usarão depois, testado com fixture.

As modificações retroativas (4.4 altera o login do Auth; 6.5 acrescenta atributo ao `User`) são aditivas e estão declaradas.

### Dependências dentro dos épicos

Ordem sequencial válida em todos os épicos; nenhuma story depende de uma posterior do mesmo épico. Tabelas nascem quando são necessárias: credenciais na 2.2, refresh na 2.3, outbox na 3.10, objetos e closure na 4.1, pedidos pendentes na 5.5. Correto.

### Achados

#### 🔴 Critical Violations

Nenhum.

#### 🟠 Major Issues

| # | Achado | Stories | Por que importa | Recomendação |
|---|---|---|---|---|
| **EQ-1** | **Papel × permissão indefinido.** O UML (`ACL_GRANT.role`) e a Story 4.3 falam em **papel** atribuído sobre um objeto; a Story 4.4 fala em **permissão** concedida; o manifest exige permissões `<recurso>:<ação>` em `auth.requires`; a Story 5.6 resolve aprovador por `role: manager`. Nenhum artefato define como um papel vira permissões, nem onde os papéis são declarados. | 4.3, 4.4, 5.6; UML §3 | Sem esse mapeamento não dá para implementar a soma de heranças da 4.4, preencher `perms` do token nem resolver `approval.approver`. É o núcleo do modelo de autorização. | Decidir no Create Story da 4.3 (antes da 4.4): papel é um conjunto nomeado de permissões declarado no manifest do Directory (ou de cada domínio); `ACL_GRANT` guarda o papel; a permissão efetiva é a união das permissões dos papéis herdados. Registrar a decisão como emenda da Spine. |
| **EQ-2** | **Quem pode conceder permissão não está definido.** A Story 4.4 trata da gravação e do efeito de uma concessão, mas não da action de conceder/revogar nem da permissão exigida para isso (só a 4.2 restringe `tenant:create` a `Root`). | 4.4 | Risco de escalada de privilégio: sem regra, qualquer usuário com escrita num objeto poderia se conceder mais. | Acrescentar no Create Story da 4.4: actions `grantRole`/`revokeRole`, permissão própria (ex.: `directory:acl:manage`) no objeto ou ancestral, e proibição de conceder papel acima do que o próprio concedente tem. |
| **EQ-3** | **Bootstrap cíclico sob Zero Trust.** A Story 4.3 diz que `auth bootstrap` passa a criar também o Tenant inicial e o admin no Directory. Mas o Directory só aceita chamadas com token verificado, o admin ainda não tem permissões no Directory (que é a fonte de `perms` a partir da 4.4) e `tenant:create` só existe em `Root`. Não há caminho descrito que não seja circular. | 2.2, 4.3, 4.4 | A primeira subida de qualquer sistema fica bloqueada ou exige um atalho não especificado, justamente onde o AD-7 proíbe exceções. | Decidir no Create Story da 4.3: o bootstrap grava direto no banco do Directory, com acesso local, igual ao que já faz no Auth (sem endpoint HTTP), criando `Root`, o Tenant inicial, o `User` admin e as concessões em `Root` e no Tenant. |
| **EQ-4** | **Mudança de status do Tenant sem action.** A Story 4.2 define o efeito de `suspended` e `archived`, e o `status` é `readOnly` (4.1), mas nenhuma story cria a action que muda o status nem a permissão exigida. O evento `TenantStatusChanged` (4.5) depende dela. | 4.2, 4.5 | FR-9 fica sem caminho de execução para suspender ou arquivar. | Acrescentar no Create Story da 4.2: action `changeTenantStatus` (transições válidas, permissão em `Root`, evento no outbox). |
| **EQ-5** | **Como o CLI se autentica como administrador.** A Story 2.7 exige `tecton-admin auth register-service` "autenticado como administrador com `auth:service:register`", mas nenhum comando de login do CLI existe, nem a forma de guardar o token. | 2.7, 3.10 | Story não implementável como escrita. | Decidir no Create Story da 2.7: `tecton-admin auth login` (senha por stdin, token só em memória do processo ou em arquivo com permissão restrita) ou token por variável de ambiente. |
| **EQ-6** | **Promessa do Epic 4 maior que as stories.** O resumo do épico diz que Marina "gerencia ACL" e "cria Tenant/Usuário/Grupo", mas a SPA do MVP só navega e edita atributos; criação, membership e ACL são só API. | Epic 4 (resumo) | Expectativa errada para quem lê só o resumo; o Validate Story pode cobrar telas que não existem. | Ajustar a redação do resumo do Epic 4 no `epics.md`: criação e ACL por API/CLI; a SPA navega, busca e edita atributos. |

#### 🟡 Minor Concerns

| # | Achado | Stories | Recomendação |
|---|---|---|---|
| EQ-7 | Critérios não mensuráveis ou sem valor padrão: "tempo de resposta equivalente" (2.2), "limite de frequência" do refetch do JWKS (2.4), limites do rate limit (3.7), "limite configurável" de atraso do relay (3.11), prazo padrão da pendência (5.5). | 2.2, 2.4, 3.7, 3.11, 5.5 | Fixar valores padrão no Create Story de cada uma; para 2.2, testar por comportamento (Test Design TC-7) |
| EQ-8 | Semântica do outbox e canonicalização da assinatura indefinidas. | 3.10, 3.11 | Já registradas como bloqueios ASR-6 e ASR-7 no Test Design; resolver no Create Story |
| EQ-9 | Antes do Epic 6 (`migrate`), não está dito como as migrations do Auth (Epic 2) são aplicadas; a 3.13 cobre o `dev` só no Epic 3. | 2.2, 2.3 | No Create Story da 2.2: script `prisma migrate` do próprio pacote, depois exposto pelo `migrate` |
| EQ-10 | "Modo de desenvolvimento" é usado na 2.4 (JWKS por http) antes de ser definido na 3.13. | 2.4, 3.13 | Definir a flag de modo dev já na 2.4 (via configuração), e a 3.13 reaproveita |
| EQ-11 | O Auth precisa de token de serviço próprio para chamar o Directory (4.4), o que exige registrar o Auth como serviço (`call:directory`). Não está explícito. | 4.4 | Acrescentar no Create Story da 4.4 |
| EQ-12 | Stories com muita lógica de risco alto, além das já marcadas como grandes: 3.12 (consumidor, 10 critérios), 4.4 (ACL + `perms` + revogação) e 6.5 (3 adaptadores). | 3.12, 4.4, 6.5 | Avaliar divisão no Create Story; 4.4 é a mais forte candidata depois da decisão do EQ-1/EQ-2 |
| EQ-13 | A FR-31 do PRD ainda descreve o `test:contracts` contra Testcontainers (ver Epic Coverage Validation). | PRD FR-31 × 6.4 | Nota datada na FR-31 |

### Checklist de boas práticas

| Épico | Valor | Independente | Tamanho | Sem dep. futura | Tabelas no tempo certo | ACs claros | Rastreável |
|---|---|---|---|---|---|---|---|
| 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 2 | ✓ | ✓ | ⚠️ 2.2, 2.7 | ✓ | ✓ | ⚠️ EQ-5, EQ-7 | ✓ |
| 3 | ✓ | ✓ | ⚠️ 3.4, 3.10, 3.12 | ✓ | ✓ | ⚠️ EQ-8 | ✓ |
| 4 | ✓ | ✓ | ⚠️ 4.3, 4.4 | ✓ | ✓ | ⚠️ EQ-1 a EQ-4 | ✓ |
| 5 | ✓ | ✓ | ⚠️ 5.6 | ✓ | ✓ | ✓ | ✓ |
| 6 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Summary and Recommendations

### Overall Readiness Status

**NEEDS WORK, sem bloquear o início.** O Epic 1 está pronto para implementar agora. Os seis achados 🟠 vivem nas Stories 2.7, 4.2, 4.3 e 4.4 e precisam estar resolvidos quando essas stories passarem pelo Create Story, não antes da Story 1.1.

Base da avaliação: 31 de 31 FRs cobertos, 8 de 8 NFRs mapeados, nenhuma dependência para frente entre épicos, nenhum épico técnico sem valor, UX e arquitetura alinhados.

### Critical Issues Requiring Immediate Action

Nenhum crítico. Os que precisam de decisão antes das stories afetadas, em ordem de chegada:

1. **EQ-5 (Story 2.7):** como o CLI se autentica como administrador para `auth register-service`.
2. **EQ-1 (Stories 4.3, 4.4, 5.6):** modelo papel × permissão. É a decisão de maior alcance: sem ela não existe ACL, `perms` no token nem resolução de aprovador.
3. **EQ-2 (Story 4.4):** quem pode conceder e revogar papéis, sem escalada de privilégio.
4. **EQ-3 (Story 4.3):** bootstrap do Directory sem circularidade, por acesso local ao banco (como o do Auth).
5. **EQ-4 (Story 4.2):** action de mudança de status do Tenant.
6. **EQ-6 (resumo do Epic 4):** alinhar a promessa do épico ao que a SPA entrega.

Somam-se a estes os bloqueios do Test Design de 2026-10-08: **ASR-6** (canonicalização da assinatura, Story 3.10) e **ASR-7** (semântica do outbox, Story 3.11).

### Recommended Next Steps

1. Seguir para o **Sprint Planning** e começar a **Story 1.1**; nenhum achado afeta o Epic 1.
2. Tratar os achados no **Create Story** de cada story afetada, que já é o ponto de divisão das stories grandes: 2.7 (EQ-5), 3.10/3.11 (ASR-6, ASR-7, EQ-8), 4.2 (EQ-4), 4.3 (EQ-1, EQ-3), 4.4 (EQ-2, EQ-11, avaliar divisão), 4.7 (UX-5), 4.10 (UX-2).
3. Registrar a decisão de EQ-1 como emenda datada da Architecture Spine (mesmo padrão das emendas do AD-3 e do AD-7), porque ela muda o modelo de dados do UML (§3).
4. Ajustes pequenos de documento, quando for conveniente: resumo do Epic 4 (EQ-6), nota datada na FR-31 (EQ-13) e os exemplos do `EXPERIENCE.md` (UX-1, UX-3).
5. Rodar o **Test Framework** e o **CI Setup** logo depois da Story 1.1, como decidido nesta sessão.

### Final Note

Esta avaliação encontrou **18 itens em 3 categorias**: 6 🟠 e 7 🟡 na qualidade dos épicos, 5 🟡 no alinhamento de UX, e nenhuma lacuna de cobertura de FR (a nota da FR-31 está contada no EQ-13). Nenhum impede o início pelo Epic 1. Os 6 🟠 precisam de decisão antes das stories em que vivem; o Create Story é o ponto natural para isso. Você pode corrigir os artefatos agora ou seguir como está e tratar cada item na sua story.

**Avaliador:** John (PM, BMAD) para o Boss · **Data:** 2026-10-08
