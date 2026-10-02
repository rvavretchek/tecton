---
stepsCompleted: [1, 2]
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-Tecton-2026-09-03/DESIGN.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-Tecton-2026-09-03/EXPERIENCE.md'
  - 'CONSTITUTION.md'
---

# Tecton - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Tecton, decomposing the requirements from the PRD, UX Design (Directory Service admin, restricted scope), and Architecture Spine into implementable stories. Tecton is the framework itself (packages `@tecton/manifest`, `core`, `providers`, `auth`, `directory`, `service-client`, `ui`, `cli`) — these epics build the framework, not an app built with it.

## Requirements Inventory

### Functional Requirements

- FR-1: Declaração de domínio via manifest (`tecton.yaml`, `manifestVersion`, validação)
- FR-2: `objectClass` opcional (containment + ACL herdável), validação de `containment.allowedParents` cross-domínio no lint
- FR-3: Actions tipadas com `sensitive.quorum`/`approval` (mutuamente exclusivos), flag `idempotent`
- FR-4: Events publicados/consumidos com schema, conector de mensageria gerado automaticamente
- FR-5: Geração de OpenAPI (`@fastify/swagger`) e AsyncAPI (validado por `@asyncapi/parser`) a partir do manifest
- FR-6: Persistência da hierarquia via Closure Table (Prisma; PostgreSQL/MySQL/MS-SQL), detecção de ciclo
- FR-7: Controle de acesso por herança aditiva simples (sem override por nó no MVP)
- FR-8: Navegação (leitura) e edição de atributo via formulário gerado (`@rjsf/core`) a partir de `objectClass.attributes`, sem drag-and-drop; i18n de labels/mensagens
- FR-9: Domínio Tenant (raiz da árvore, status active/suspended/archived, isolamento multi-tenant)
- FR-10: Domínio Usuário/Grupo (containment, associação usuário-grupo, papel)
- FR-11: Domínio Custodiante — interface `KeyCustodyProvider` + conceito `sensitive.quorum` no MVP, sem implementação real; execução sem provider é permitida com aviso explícito
- FR-12: `AuthProvider` (Argon2id + Pepper), JWT de acesso + refresh confinado ao serviço de Auth
- FR-13: Verificação independente de assinatura por serviço (Zero Trust), nunca aceita header pré-decodificado
- FR-14: `TokenRevocationStore` Valkey-backed real, fail-closed se Valkey inacessível
- FR-15: Comandos essenciais do CLI (`new`, `generate`, `dev`, `migrate`)
- FR-16: `extract` para migração assistida (Strangler Fig, corte único, Caso 1)
- FR-17: Família de lint (`lint:gateway`, aviso de `sensitive.quorum` sem provider)
- FR-18: `test:contracts` (testa os dois lados do manifest)
- FR-19: Gateway fino com responsabilidades proibidas explícitas (allowlist executável via `lint:gateway`), fail-open no rate limiting
- FR-20: Service Discovery estático via variável de ambiente, atrás de `ServiceDiscoveryProvider`
- FR-21: CloudEvents sobre Valkey Streams (at-least-once), idempotência por deduplicação, dead-letter stream
- FR-22: `ConfigProvider` com validação tipada e fail-fast no startup
- FR-23: Sucesso como payload puro (sem envelope), correlação via `traceparent`
- FR-24: Erro como RFC 9457 Problem Details, multi-idioma (`title`/`detail` via `Accept-Language`, `i18nKey`)
- FR-25: Estado pendente como `202 Accepted` dedicado (`pending_approval`, `pollUrl`), expiração configurável
- FR-26: `ServiceClient` com retry/timeout seguro (nunca retry cego em mutação sem `Idempotency-Key`)
- FR-27: Health checks `/health`, `/ready`, `/live` por serviço
- FR-28: Dockerfile por domínio (build/deploy independente)
- FR-29: Evolução aditiva de contrato por padrão (nunca remove/renomeia campo existente)
- FR-30: Dev Services via `docker-compose.dev.yml` (Valkey + banco)
- FR-31: Testcontainers para isolamento de `test:contracts`/CI

### NonFunctional Requirements

- NFR-1: Zero Trust em toda comunicação leste-oeste (serviço-a-serviço, síncrona ou assíncrona) — verificação criptográfica própria sempre, sem exceção por "ambiente de confiança" (Constitution §9; FR-13/FR-14/FR-21/FR-26)
- NFR-2: i18n de toda superfície exposta a usuário final — PT-BR padrão, EN secundário via `Accept-Language`/`i18nKey`, nunca obrigatório para código de domínio de terceiros (FR-8, FR-24)
- NFR-3: Observabilidade distribuída via OpenTelemetry, com propagação de `traceparent` (FR-19/FR-23)
- NFR-4: Portabilidade de banco — trocar entre PostgreSQL/MySQL/MS-SQL via Prisma nunca exige mudança de schema/código de domínio (FR-6)
- NFR-5: Resiliência segura — retry automático só em ação idempotente por natureza ou com `Idempotency-Key` explícito; nunca retry cego (FR-26)
- NFR-6: Fail-fast de configuração no startup vs. fail-closed de segurança (revogação de token) vs. fail-open de proteção de recurso (rate limiting) — três posturas distintas e deliberadas, nunca confundidas (FR-14/FR-19/FR-22)
- NFR-7: Evolução de contrato nunca quebra consumidor existente por padrão — mudança incompatível exige nova action explícita, capturado por `test:contracts` (FR-18/FR-29)
- NFR-8: TypeScript full-stack; DI/IoC leve (Awilix) por serviço, sem framework de DI pesado (§6.1)

### Additional Requirements

*(extraído da Architecture Spine — Architectural Decisions e Structural Seed)*

- AD-1: Todo serviço de domínio organizado em núcleo + portas (Providers) + adaptadores (Hexagonal); núcleo nunca importa infraestrutura concreta diretamente — paradigma DOMA + Hexagonal vinculante em todo domínio gerado
- AD-2: Tenant/Usuário-Grupo/Custodiante vivem só dentro de `@tecton/directory`, distribuído como serviço pronto (nunca via `generate domain`); customização só por `objectClass.attributes` declarativo (JSON/JSONB validado contra JSON Schema, nunca migração relacional); acesso de outro domínio ao dado do Directory só via `events.publishes`, nunca leitura direta de banco
- AD-3 (emendado em 2026-10-01): `manifest` não depende de nada interno; `providers` e `ui` dependem de `manifest`; `core` e `service-client` de `manifest` e `providers`; `auth` de `manifest`, `providers` e `core`; `directory` de `manifest`, `providers`, `core` e `ui`; `cli` de todos; nunca o inverso
- AD-4: Todo scaffold gerado declara `@tecton/*` como dependência versionada; nenhum comando do CLI grava código-fonte de pacote do framework no repo do dev
- AD-5: UUID v7 canônico (36 caracteres, minúsculas, forma `8-4-4-4-12`) para todo identificador de entidade e `id` de evento, gerado por biblioteca padrão do ecossistema
- AD-6: `i18nKey` como campo de extensão de lookup de máquina em toda mensagem/erro exposta ao usuário final
- AD-7: Todo serviço (Directory incluído) verifica a assinatura do token ele mesmo, sempre, e decide autorização só a partir das claims que ele mesmo extraiu — nunca de header/claim repassado por outro serviço
- AD-8: Gateway nunca importa pacote de circuit breaker, cache de resposta, ou pacote de domínio específico — `lint:gateway` enforça isso em CI
- AD-9: Único jeito de um domínio A obter dado de domínio B é `ServiceClient` (síncrono, exceção) ou consumir `events.publishes` (padrão) — nunca import direto de código nem acesso direto a banco de outro domínio, Directory Service incluído
- AD-10: `@tecton/ui` como único runtime de renderização schema→tela; tema default (tokens CSS) + porta `UiThemeProvider` (slots substituíveis, compostos pelo `Core`, nunca resolvidos pelo slot substituto); namespace de `i18nKey` `<domínio>.<chave>`; `ObjectTreeView` exclusivo do Directory (containment/ACL), `AttributeForm` reusável por qualquer domínio via `@tecton/manifest` (nunca import direto de `@tecton/directory`); SPA admin embutida em `@tecton/directory`, servida em `/admin`; toda chamada de API da SPA (não só o shell inicial) atravessa o Gateway
- Stack fixado: Node.js 24.x, TypeScript 6.0.3, Fastify 5.12.x, Prisma 8.x, Valkey 9.1.x, React 19.x, `@rjsf/core` 6.1.2, OpenTelemetry, Awilix, Testcontainers
- Estrutura de monorepo do framework: pnpm workspaces, pacotes `packages/{manifest,core,providers,auth,directory,service-client,ui,cli}`; app gerada por `tecton-admin new` usa Turborepo com `apps/{gateway,auth,directory,domains/<nome>}`
- Sem starter template externo para o repositório do próprio framework — scaffold nasce do zero conforme o Structural Seed acima (não é greenfield de app, é o framework sendo construído)

### UX Design Requirements

*(extraído do par DESIGN.md/EXPERIENCE.md — escopo restrito à tela `/admin` do Directory Service, Proposta D do Sprint Change Proposal)*

- UX-DR1: Tema default (Camada 0) do `@tecton/ui` como tokens CSS custom properties — paleta (`background`, `foreground`, `muted`, `muted-foreground`, `border`, `primary`, `selected-bg`, `destructive`), tipografia (`body`/`label`/`heading`/`mono`), `rounded` (`sm`/`md`), `spacing` (escala de 4px) — conforme frontmatter de `DESIGN.md`
- UX-DR2: Porta `UiThemeProvider` — registro de 3 slots substituíveis (`ObjectTreeView`, `AttributeForm`, `ScreenLayout`); `Core` resolve os slots via a porta e injeta os já-resolvidos como filhos — um slot customizado nunca resolve outro slot por conta própria
- UX-DR3: Layout master-detail de dois painéis (árvore + detalhe) na SPA `/admin`, embutida em `@tecton/directory`, servida por ele mesmo; Gateway só roteia pro path, nunca importa o pacote
- UX-DR4: Componente de árvore — expand/collapse (chevron/duplo-clique), seleção por clique único, ícone por `objectClass`, navegação por teclado (`↑`/`↓`/`→`/`←`/`Enter`), padrão ARIA Tree View completo (`aria-expanded`, `aria-level`, `aria-selected`, `aria-posinset`, `aria-setsize`)
- UX-DR5: Busca/filtro da árvore — filtra por nome com debounce (~250ms), expande até o nó resultado e destaca, mensagem clara quando sem resultado
- UX-DR6: Nó sem permissão de leitura (ACL) é completamente invisível na árvore — nunca aparece cinza/bloqueado (postura Zero Trust)
- UX-DR7: Menu de contexto (clique direito + equivalente de teclado) — só "Ver detalhes"/"Editar atributos"; item de edição some (não aparece esmaecido) sem permissão de escrita; nenhuma affordance visual de arrastar/mover
- UX-DR8: Painel de detalhe em modo visualização — lista de atributos rótulo/valor somente leitura; botão "Editar atributos" condicionado à permissão de escrita
- UX-DR9: Formulário de edição de atributo gerado via `@rjsf/core` a partir do JSON Schema de `objectClass.attributes`; labels e mensagens de validação multi-idioma (PT-BR/EN); botões Salvar/Cancelar; erro de validação inline abaixo do campo com foco automático e anúncio via `aria-live`
- UX-DR10: Cobertura de estado — skeleton de carregamento (árvore/detalhe), árvore vazia, nenhuma seleção, busca sem resultado, falha ao carregar (RFC 9457 + retry), falha ao salvar (preserva dados do formulário), somente-leitura (botão de editar ausente, não desabilitado)
- UX-DR11: Acessibilidade WCAG 2.2 AA em toda a superfície — operabilidade total por teclado (árvore, menu de contexto, formulário), foco visível em `{colors.primary}`, gestão de foco ao abrir/fechar menu de contexto
- UX-DR12: Microcopy funcional sem tom de marca — mensagens curtas, sem emoji/exclamação, nunca expõe erro técnico cru (sempre RFC 9457 `title`/`detail` já traduzido)

### FR Coverage Map

FR-1: Epic 1 - Declaração de domínio via manifest
FR-2: Epic 1 - ObjectClass opcional
FR-3: Epic 1 - Actions tipadas com aprovação/sensibilidade
FR-4: Epic 1 - Events publicados/consumidos
FR-5: Epic 1 - Geração de OpenAPI/AsyncAPI
FR-6: Epic 3 - Persistência da hierarquia via Closure Table
FR-7: Epic 3 - Controle de acesso por herança aditiva
FR-8: Epic 3 - Navegação e edição de objetos (Directory admin UI)
FR-9: Epic 3 - Domínio Tenant
FR-10: Epic 3 - Domínio Usuário/Grupo
FR-11: Epic 2 - Domínio Custodiante (interface)
FR-12: Epic 2 - AuthProvider com JWT e refresh confinado
FR-13: Epic 2 - Verificação independente por serviço (Zero Trust)
FR-14: Epic 2 - Revogação de token via TokenRevocationStore
FR-15: Epic 1 (parcial: new/generate) + Epic 6 (parcial: dev/migrate) - Comandos essenciais do ciclo de vida
FR-16: Epic 6 - `extract` para migração assistida
FR-17: Epic 6 - Família de lint
FR-18: Epic 5 - `test:contracts`
FR-19: Epic 4 - Gateway fino com responsabilidades proibidas
FR-20: Epic 4 - Service Discovery estático
FR-21: Epic 4 - Comunicação assíncrona via CloudEvents/Valkey Streams
FR-22: Epic 4 - ConfigProvider com validação tipada
FR-23: Epic 5 - Sucesso como payload puro
FR-24: Epic 5 - Erro como RFC 9457 Problem Details
FR-25: Epic 5 - Estado pendente como 202 Accepted dedicado
FR-26: Epic 4 - ServiceClient com retry/timeout seguro
FR-27: Epic 4 - Health checks padrão por serviço
FR-28: Epic 4 - Dockerfile por domínio
FR-29: Epic 5 - Evolução aditiva de contrato por padrão
FR-30: Epic 6 - Dev Services
FR-31: Epic 6 - Testcontainers para isolamento de teste/CI

## Epic List

### Epic 1: Manifest Declarativo e Scaffold Inicial
Dev (ou agente de IA) cria um workspace Tecton, declara um domínio via `tecton.yaml` com `objectClass` opcional, actions tipadas (`sensitive`/`approval`), events publicados/consumidos e dependencies, e recebe validação + documentação OpenAPI/AsyncAPI geradas automaticamente — sem escrever nenhum código de plumbing. Inclui o scaffold mínimo do monorepo (pnpm workspaces, `@tecton/manifest`) e uma versão inicial de `tecton-admin new`/`generate domain` suficiente para produzir o manifest.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-15 (parcial: `new`/`generate`)

### Epic 2: Autenticação e Zero Trust
Dev tem um serviço de Auth funcional (Argon2id+Pepper, JWT de acesso + refresh confinado) e todo serviço gerado verifica a assinatura do token por conta própria, nunca aceitando header pré-decodificado; revogação de token via `TokenRevocationStore` Valkey-backed real, fail-closed se o Valkey estiver inacessível. Inclui Custodiante como primitivo de segurança — interface `KeyCustodyProvider` e conceito `sensitive.quorum`, sem implementação real de custódia (movido do Epic 3 por não compartilhar Closure Table/ACL/tela com Tenant/Usuário-Grupo — decisão da mesa de arquitetura, 2026-09-04). Restrição de design herdada do PRD (FR-11): a interceptação de `sensitive.quorum`, quando implementada, precisa acontecer no nível de acesso ao dado, nunca só num middleware de rota HTTP.
**FRs covered:** FR-12, FR-13, FR-14, FR-11

### Epic 3: Core de Diretório e Domínios Embutidos
Marina cria Tenant/Usuário/Grupo, navega a árvore de objetos em `/admin` (com busca, ícones por objectClass, navegação por teclado), edita atributos via formulário gerado (`@rjsf/core`) e gerencia ACL por herança aditiva — tudo autenticado via Epic 2. Backend (`@tecton/directory`) e frontend (`@tecton/ui`, tema + `UiThemeProvider`) entregues juntos, por serem o mesmo componente ponta-a-ponta.
**FRs covered:** FR-6, FR-7, FR-8, FR-9, FR-10

### Epic 4: Interoperabilidade entre Domínios
Dev gera domínios de negócio (via `generate domain` do Epic 1) que se comunicam com segurança — chamada síncrona via `ServiceClient` com retry seguro (nunca cego), e assíncrona via CloudEvents sobre Valkey Streams (at-least-once, dead-letter) — atrás de um Gateway fino com responsabilidades proibidas explícitas, `ConfigProvider` com fail-fast no startup, health checks padrão e Dockerfile por domínio. **Nota de dependência (decisão da mesa, 2026-09-04):** nasce com formato de erro provisório (status HTTP + corpo básico) — o formato final (RFC 9457/i18n) é entregue pelo Epic 5, que enriquece em vez de recriar; stories deste épico devem nomear explicitamente esse caráter provisório para não gerar retrabalho.
**FRs covered:** FR-19, FR-20, FR-21, FR-22, FR-26, FR-27, FR-28

### Epic 5: Formato de API e Evolução de Contrato
Toda action de todo domínio gerado responde em formato consistente — sucesso como payload puro, erro como RFC 9457 Problem Details multi-idioma, estado pendente como `202 Accepted` dedicado — com `test:contracts` garantindo que a evolução do manifest seja aditiva por padrão e nunca quebre um consumidor existente. Enriquece o formato de erro provisório do Epic 4 para a forma final, sem recriá-lo do zero.
**FRs covered:** FR-18, FR-23, FR-24, FR-25, FR-29

### Epic 6: CLI Completo e Developer Experience
Dev tem o ciclo de vida completo do `tecton-admin`: `dev` (sobe ambiente local completo com Dev Services), `migrate` (Prisma), `extract` (migração assistida Strangler Fig, Caso 1), família `lint` (`lint:gateway` + aviso de quórum sem provider), e `test:contracts`/CI isolados via Testcontainers.
**FRs covered:** FR-16, FR-17, FR-30, FR-31, FR-15 (parcial: `dev`/`migrate`)

## Epic 1: Manifest Declarativo e Scaffold Inicial

Dev (ou agente de IA) cria um workspace Tecton, declara um domínio via `tecton.yaml` e recebe validação + documentação OpenAPI/AsyncAPI geradas automaticamente, sem escrever código de plumbing. Este épico declara e valida; comportamento em execução de `approval` (Epic 5) e conector de mensageria (Epic 4) ficam fora.

### Story 1.1: Scaffold do monorepo do framework

Como **contribuidor do framework (humano ou agente de IA)**,
quero um monorepo pnpm com os 8 pacotes e a direção de dependência verificada automaticamente,
para que cada story seguinte tenha onde nascer sem violar o AD-3.

**Critérios de Aceite:**

**Dado** um clone limpo do repositório
**Quando** eu rodo `pnpm install` e `pnpm build`
**Então** os pacotes `@tecton/{manifest,core,providers,auth,directory,service-client,ui,cli}` compilam com TypeScript 6.0.3, com `engines.node` fixado em 24.x
**E** o repositório do framework usa só pnpm workspaces, sem Turborepo nem Nx (Structural Seed). O Turborepo pertence à app gerada por `tecton-admin new` (Story 1.9), não a este repositório.

**Dado** um pacote que importa uma dependência interna proibida (ex.: `@tecton/manifest` importando `@tecton/core`)
**Quando** a checagem de direção de dependência roda (`pnpm check:deps`)
**Então** ela falha e informa o arquivo, o import e a regra do AD-3 que foi violada

**Dado** um push ou pull request no GitHub
**Quando** o CI roda
**Então** ele executa install, build, test e `check:deps`, e falha se qualquer um deles falhar

**Dado** que a story foi concluída
**Quando** eu consulto o README do repositório
**Então** encontro o test runner escolhido e o motivo da escolha, além dos comandos `pnpm build`, `pnpm test` e `pnpm check:deps`

### Story 1.2: Núcleo do `tecton.yaml` (identidade do domínio)

Como **dev ou agente de IA declarando um domínio**,
quero que o `@tecton/manifest` faça o parse e a validação dos campos de identidade do `tecton.yaml`,
para que um manifest inválido seja rejeitado com erro claro antes de qualquer geração.

**Critérios de Aceite:**

**Dado** um `tecton.yaml` com `manifestVersion: "0.1"`, `domain`, `version` (semver), `description` e `dependencies: []`
**Quando** eu chamo o parser
**Então** recebo um objeto tipado e nenhum erro

**Dado** um manifest sem `manifestVersion`
**Quando** ele é validado
**Então** a validação falha com erro no caminho `manifestVersion` (FR-1)

**Dado** um `manifestVersion` não suportado (ex.: `"9.9"`)
**Quando** ele é validado
**Então** a validação falha e lista as versões suportadas

**Dado** um `domain` fora de kebab-case ou um `version` que não é semver
**Quando** ele é validado
**Então** a validação falha e indica o caminho do campo

**Dado** uma chave de topo desconhecida (ex.: `action:` em vez de `actions:`)
**Quando** ela é validada
**Então** a validação falha
**E** `actions`, `events` e `objectClass` são aceitos como chaves reservadas, validadas nas Stories 1.3 a 1.5

**Dado** um YAML com erro de sintaxe
**Quando** ele é parseado
**Então** o erro informa linha e coluna

**Dado** um manifest com vários problemas
**Quando** ele é validado
**Então** todos os erros voltam de uma vez, cada um com `path`, `code` e `message`
**E** o texto de `message` está em inglês, porque o público é dev ou agente de IA (Constitution §8, eixo 2)

**Dado** o pacote compilado
**Quando** um editor ou agente de IA procura o schema
**Então** o `@tecton/manifest` exporta o JSON Schema do `tecton.yaml`

### Story 1.3: Actions tipadas

Como **dev declarando o que meu domínio faz**,
quero declarar `actions` com input e output tipados, autorização explícita e regras de aprovação e sensibilidade validadas,
para que contratos inconsistentes ou rotas abertas por esquecimento falhem antes de virar rota.

**Critérios de Aceite:**

**Dado** uma action com `name` (camelCase, único no domínio), `description`, `input`, `output` e `auth.requires`
**Quando** ela é validada
**Então** ela passa
**E** `input` e `output` são compilados para JSON Schema, para uso na Story 1.7

**Dado** um campo com tipo do sistema curto (`string`, `number`, `integer`, `boolean`, `uuid`, `date`, `datetime`, `enum[a,b]`)
**Quando** ele é compilado
**Então** vira o JSON Schema equivalente (`uuid` vira `format: uuid` e `datetime` vira ISO 8601)
**E** um tipo desconhecido falha a validação e o nome do tipo aparece no erro

**Dado** uma action sem o bloco `auth`
**Quando** ela é validada
**Então** a validação falha, porque toda action declara a autorização de forma explícita

**Dado** uma action com `auth.public: true`
**Quando** ela é validada
**Então** ela passa sem `auth.requires`, como rota aberta declarada de propósito
**E** uma action com `auth.public: true` e `auth.requires` ao mesmo tempo falha a validação

**Dado** uma action com `auth.requires` vazio e sem `auth.public: true`
**Quando** ela é validada
**Então** a validação falha

**Dado** uma permissão em `auth.requires` fora do formato `<recurso>:<ação>`
**Quando** ela é validada
**Então** a validação falha

**Dado** uma action com `sensitive` sem `description`
**Quando** ela é validada
**Então** a validação falha (FR-3)

**Dado** uma action com `sensitive.quorum` e `approval` ao mesmo tempo
**Quando** ela é validada
**Então** a validação falha, porque os dois primitivos são mutuamente exclusivos (FR-3)

**Dado** uma action sem o campo `idempotent`
**Quando** ela é parseada
**Então** `idempotent` assume o valor `false`

> **Nota:** esta story só declara e valida. O estado pendente `202 Accepted` de `approval` em execução é do Epic 5 (FR-25).

### Story 1.4: Events publicados e consumidos

Como **dev declarando o que meu domínio publica e consome**,
quero declarar `events.publishes` e `events.consumes` com schema,
para que os contratos assíncronos sejam validados e fiquem prontos para o AsyncAPI e para o conector de mensageria.

**Critérios de Aceite:**

**Dado** um evento em `publishes` com `name` (PascalCase, único no domínio) e `schema` no mesmo sistema de tipos da Story 1.3
**Quando** ele é validado
**Então** ele passa e o schema é compilado para JSON Schema
**E** o parser expõe o `type` CloudEvents derivado no formato `com.tecton.<domínio>.<evento>`, com regra determinística, documentada e coberta por teste

**Dado** uma entrada em `consumes` que referencia `<domínio>.<Evento>`
**Quando** ela é validada
**Então** só a sintaxe é verificada
**E** a resolução contra o manifest do outro domínio fica com a Story 1.6

**Dado** uma action com `approval.onApprove.emit` ou `approval.onReject.emit` apontando para um evento que não está em `publishes`
**Quando** ela é validada
**Então** a validação falha e o erro mostra o nome do evento

**Dado** o arquivo `docs/examples/leave-domain-manifest-v0.yaml`, atualizado para o bloco `auth` da Story 1.3 se necessário
**Quando** ele é validado
**Então** ele passa sem erro

> **Nota:** nenhum código de broker nasce aqui. O conector Valkey Streams é do Epic 4 (FR-21).

### Story 1.5: `objectClass` opcional

Como **dev de um domínio que participa do Core de Diretório**,
quero declarar `objectClass` com containment, atributos e ACL herdável,
para que o domínio seja reconhecido como objeto de diretório e os atributos virem um schema que a UI e a persistência consomem.

**Critérios de Aceite:**

**Dado** um manifest sem `objectClass`
**Quando** ele é parseado
**Então** ele é válido e marcado como domínio que não participa do diretório (FR-2)

**Dado** um `objectClass` sem `containment.allowedParents`, ou com a lista vazia
**Quando** ele é validado
**Então** a validação falha (FR-2)

**Dado** `attributes` no formato curto (`name`, `type`, `required`, `default`, `values`, `unique`)
**Quando** eles são compilados
**Então** viram um JSON Schema que o `@rjsf/core` 6.1.2 e o validador de atributos do Directory conseguem consumir (AD-2)
**E** `unique` vira o metadado de extensão `x-tecton-unique`, porque não existe em JSON Schema

**Dado** um `objectClass` sem `extends` ou sem `acl.inheritable`
**Quando** ele é parseado
**Então** os valores padrão são `extends: DirectoryObject` e `acl.inheritable: true`

**Dado** os campos `allowedParents` e `allowedChildren`
**Quando** eles são validados
**Então** só a sintaxe (PascalCase) é verificada
**E** a resolução contra outros domínios fica com a Story 1.6

**Dado** o arquivo `docs/examples/tenant-domain-manifest-v0.yaml`, atualizado para o bloco `auth` da Story 1.3 se necessário
**Quando** ele é validado
**Então** ele passa sem erro

### Story 1.6: `tecton-admin lint` (base)

Como **dev ou agente de IA trabalhando num workspace Tecton**,
quero um comando único que valide todos os manifests e resolva as referências entre domínios,
para que uma referência quebrada falhe explicitamente em vez de passar como válida.

**Critérios de Aceite:**

**Dado** um workspace com um ou mais `tecton.yaml`
**Quando** eu rodo `tecton-admin lint`
**Então** todos os manifests são validados com as regras das Stories 1.2 a 1.5
**E** o comando sai com código 0 se não houver erro e com código diferente de 0 se houver

**Dado** um erro encontrado
**Quando** o lint o reporta
**Então** a saída mostra arquivo, linha, `path`, `code` e `message`, em inglês (Constitution §8, eixo 2)

**Dado** a opção `--format json`
**Quando** eu rodo o lint
**Então** a saída é JSON estruturado, para que um agente de IA consuma o resultado sem fazer parse de texto

**Dado** uma referência a outro domínio (`allowedParents`, `allowedChildren` ou `consumes`)
**Quando** o lint tenta resolvê-la
**Então** a resolução segue esta ordem: (1) manifest no workspace local; (2) manifest exportado por um pacote npm instalado, que é o caso dos `objectClass` embutidos do `@tecton/directory`, como `Root`, `User` e `Group`; (3) caminho explícito declarado em `dependencies`

**Dado** um `objectClass` em `allowedParents` ou `allowedChildren` que não é encontrado por nenhum dos três caminhos
**Quando** o lint roda
**Então** ele falha e nomeia a referência não resolvida (FR-2)

**Dado** uma entrada `consumes` que aponta para um evento que não está em `publishes` do domínio de origem
**Quando** o lint roda
**Então** ele falha e nomeia o domínio e o evento

**Dado** uma dependência declarada por URL remota
**Quando** o lint roda
**Então** ele falha com mensagem clara de que esse modo de resolução não existe no MVP

> **Nota:** `lint:gateway` e o aviso de `sensitive.quorum` sem provider são do Epic 6 (FR-17), que estende este comando.

### Story 1.7: Rotas Fastify e OpenAPI a partir das actions

Como **dev que declarou actions no manifest**,
quero que o `@tecton/core` registre as rotas Fastify e gere o OpenAPI a partir delas,
para que contrato HTTP e documentação nunca sejam escritos à mão nem fiquem desatualizados.

**Critérios de Aceite:**

**Dado** um manifest válido com actions
**Quando** o `@tecton/core` registra as rotas numa instância Fastify
**Então** cada action vira uma rota `POST /<domínio>/<action-em-kebab-case>`, com `input` como schema do corpo e `output` como schema da resposta (convenção RPC uniforme, decidida em 2026-10-01 e registrada na Consistency Conventions da spine)

**Dado** uma requisição com corpo que não segue o `input`
**Quando** ela chega à rota
**Então** a validação nativa do Fastify a rejeita com status 400 antes de chegar ao handler
**E** o formato do corpo de erro é provisório, porque o RFC 9457 final é do Epic 5 (FR-24)

**Dado** uma rota registrada sem implementação de handler
**Quando** ela é chamada com corpo válido
**Então** responde 501 Not Implemented

**Dado** as rotas registradas
**Quando** o `@fastify/swagger` gera o documento
**Então** o OpenAPI lista todas as actions, com schemas de entrada e saída e a `description` de cada action (FR-5)

**Dado** que eu altero o `input` ou o `output` de uma action no manifest
**Quando** eu rodo o build novamente
**Então** o OpenAPI gerado reflete a mudança sem edição manual (FR-5)

> **Nota:** a verificação de token em cada rota (Zero Trust) é do Epic 2; o formato final de resposta, do Epic 5.

### Story 1.8: AsyncAPI a partir dos events

Como **dev ou agente de IA que precisa entender os contratos assíncronos de um domínio**,
quero que o AsyncAPI seja gerado a partir de `events`,
para que publicação e consumo de eventos fiquem documentados e validados sem escrita manual.

**Critérios de Aceite:**

**Dado** um manifest válido com `events.publishes` e `events.consumes`
**Quando** o `@tecton/manifest` gera o documento AsyncAPI
**Então** cada evento publicado vira uma operação de envio e cada evento consumido vira uma operação de recebimento
**E** o payload de cada mensagem é o JSON Schema compilado na Story 1.4
**E** cada mensagem traz o `type` CloudEvents derivado (`com.tecton.<domínio>.<evento>`)

**Dado** o documento gerado
**Quando** ele é validado por `@asyncapi/parser`
**Então** não há nenhum erro (FR-5)

**Dado** um push ou pull request
**Quando** o CI roda
**Então** ele gera e valida o AsyncAPI dos manifests de `docs/examples/` e falha se a validação falhar

**Dado** um manifest sem `events`
**Quando** o AsyncAPI é gerado
**Então** o documento é válido e não tem operações, em vez de causar erro

### Story 1.9: `tecton-admin new <projeto>`

Como **dev começando a migrar um sistema para o Tecton**,
quero criar um workspace com um único comando,
para ter a estrutura pronta e as dependências do framework declaradas, sem copiar código do framework.

**Critérios de Aceite:**

**Dado** um diretório de destino inexistente e um nome em kebab-case
**Quando** eu rodo `tecton-admin new <projeto>`
**Então** é criado um workspace com Turborepo e pnpm workspaces, `turbo.json` com tarefas `build` e `dev`, `tsconfig` base e a pasta `apps/domains/` vazia
**E** `pnpm install` e `turbo run build` terminam com sucesso nesse workspace vazio

**Dado** o workspace gerado
**Quando** eu inspeciono os `package.json`
**Então** os pacotes `@tecton/*` aparecem como dependências versionadas
**E** nenhum arquivo de código-fonte do framework foi copiado para o workspace (AD-4)

**Dado** a opção de apontar para um checkout local do framework (para testes ponta a ponta do próprio framework)
**Quando** eu a uso
**Então** as dependências `@tecton/*` apontam para o checkout local como link de dependência, nunca como cópia (AD-4)

**Dado** um diretório de destino que já existe e não está vazio
**Quando** eu rodo `tecton-admin new`
**Então** o comando falha sem sobrescrever nada

**Dado** um nome fora de kebab-case
**Quando** eu rodo `tecton-admin new`
**Então** o comando falha e explica o formato esperado

**Dado** o texto de ajuda e as mensagens do comando
**Quando** eu rodo `tecton-admin new --help`
**Então** todo o texto está em inglês (Constitution §8, eixo 2)

> **Nota:** `apps/gateway` entra no Epic 4, `apps/directory` no Epic 3 e `docker-compose.dev.yml` no Epic 6. Cada épico estende o `new`.

### Story 1.10: `tecton-admin generate domain <nomes...>`

Como **dev ou agente de IA estruturando os domínios de um sistema**,
quero gerar um ou vários domínios numa chamada, cada um já com manifest válido,
para começar a declarar actions e events imediatamente.

**Critérios de Aceite:**

**Dado** um workspace criado pela Story 1.9
**Quando** eu rodo `tecton-admin generate domain finance inventory sales`
**Então** são criados `apps/domains/finance`, `apps/domains/inventory` e `apps/domains/sales`, cada um com `tecton.yaml` e `package.json` (FR-15)
**E** cada `tecton.yaml` traz o `manifestVersion` atual, `domain`, `version: 0.1.0`, `description` de exemplo, `actions: []`, `events` vazio e `dependencies: []`
**E** `tecton-admin lint` passa logo em seguida, sem nenhuma edição (FR-1)

**Dado** um arquivo de texto com um nome de domínio por linha (linhas vazias e linhas começando com `#` são ignoradas)
**Quando** eu rodo `tecton-admin generate domain --from <arquivo>`
**Então** o resultado é o mesmo de passar os nomes na linha de comando

**Dado** uma lista com algum nome inválido (fora de kebab-case) ou que já existe no workspace
**Quando** eu rodo o comando
**Então** nenhum domínio é criado e o erro lista todos os nomes com problema

**Dado** que eu rodo o comando fora de um workspace Tecton
**Quando** ele procura o workspace
**Então** falha com mensagem que indica `tecton-admin new`

> **Nota:** a estrutura de código hexagonal do domínio (AD-1) chega no Epic 4. Os nomes de domínio seguem a convenção de identificador em inglês (Consistency Conventions), por isso o exemplo usa `finance inventory sales` e não o `financeiro materiais comercial` do PRD.

## Epic 2: Autenticação e Zero Trust

Dev tem um serviço de Auth pronto (`@tecton/auth`: Argon2id + Pepper, access token EdDSA verificável por JWKS, refresh opaco confinado ao Auth) e todo serviço verifica o token por conta própria, sem aceitar header pré-decodificado; revogação via `TokenRevocationStore` com Valkey e fail-closed; token de serviço em toda chamada entre serviços; interface `KeyCustodyProvider` para o Custodiante, sem implementação real. Mecanismo fixado na emenda do AD-7 de 2026-10-01.

### Story 2.1: `AuthProvider` com Argon2id e Pepper

Como **dev que precisa guardar senhas com segurança**,
quero um `AuthProvider` que gere e verifique hash de senha com Argon2id e Pepper,
para que nenhuma senha seja guardada de forma recuperável, mesmo se o banco vazar.

**Critérios de Aceite:**

**Dado** a interface `AuthProvider` em `@tecton/providers` e o adaptador de referência Argon2id
**Quando** eu gero o hash de uma senha
**Então** a senha passa primeiro por HMAC-SHA256 com o Pepper como chave e depois por Argon2id, com parâmetros mínimos configuráveis (padrão: 19 MiB de memória, 2 iterações, paralelismo 1)
**E** o resultado guardado está no formato PHC, com os parâmetros e o identificador da versão do Pepper usado

**Dado** uma senha correta e outra incorreta
**Quando** eu as verifico contra o hash guardado
**Então** a correta retorna verdadeiro e a incorreta retorna falso, com comparação em tempo constante e sem lançar exceção que revele o motivo

**Dado** um hash guardado com parâmetros mais fracos que a configuração atual
**Quando** a senha é verificada com sucesso
**Então** o provider indica que o hash precisa ser refeito

**Dado** um serviço que inicia sem Pepper configurado, ou com Pepper menor que 32 bytes
**Quando** ele sobe
**Então** a inicialização falha com mensagem clara, sem gerar nenhum hash

**Dado** qualquer log, erro ou registro persistido
**Quando** eu o inspeciono
**Então** o Pepper e a senha em texto puro nunca aparecem

**Dado** o núcleo de um serviço que usa o `AuthProvider`
**Quando** eu verifico os imports
**Então** ele depende só da interface, nunca da biblioteca de Argon2id diretamente (AD-1)

> **Nota:** a leitura do Pepper usa validação mínima própria. O `ConfigProvider` formal com fail-fast é do Epic 4 (FR-22) e vai absorver essa leitura.

### Story 2.2: Serviço `@tecton/auth`: login, access token EdDSA e JWKS

Como **dev de um sistema construído com o Tecton**,
quero um serviço de Auth pronto que autentique por login e senha e emita access token assinado,
para que todo serviço consiga verificar a identidade por conta própria, sem conseguir forjá-la.

**Critérios de Aceite:**

**Dado** o pacote `@tecton/auth`
**Quando** ele sobe
**Então** ele guarda só credenciais (ID de sujeito em UUID v7, identificador de login normalizado e único, hash, status e lista de permissões) no próprio banco, via Prisma
**E** nenhum outro serviço acessa esse banco (AD-9)

**Dado** um workspace sem nenhuma credencial
**Quando** eu rodo `tecton-admin auth bootstrap`
**Então** a primeira credencial administrativa é criada
**E** a senha é lida da entrada padrão ou de variável de ambiente, nunca de argumento da linha de comando

**Dado** uma credencial válida
**Quando** eu chamo `POST /auth/login` com identificador e senha
**Então** recebo um access token JWT assinado com EdDSA (Ed25519), com `kid` no cabeçalho e os claims `iss`, `sub`, `aud`, `iat`, `exp` (padrão de 15 minutos, configurável), `jti` em UUID v7, `typ: user` e `perms`

**Dado** um identificador inexistente ou uma senha errada
**Quando** eu chamo o login
**Então** a resposta é 401, idêntica nos dois casos e com tempo de resposta equivalente, para não revelar quais logins existem

**Dado** o serviço de Auth em execução
**Quando** eu chamo `GET /auth/.well-known/jwks.json`
**Então** recebo só as chaves públicas, nunca a privada
**E** o JWKS pode conter mais de uma chave, para permitir rotação sem invalidar tokens ainda válidos

**Dado** um serviço de Auth que sobe sem chave privada configurada
**Quando** ele inicia
**Então** a inicialização falha com mensagem clara

**Dado** um workspace novo
**Quando** eu rodo `tecton-admin new`
**Então** é gerado `apps/auth` como instância configurada de `@tecton/auth`, com dependência versionada (AD-4)

**Dado** qualquer log do serviço de Auth
**Quando** eu o inspeciono
**Então** senha, hash, Pepper, chave privada e tokens nunca aparecem

> **Notas:**
> - O JWKS é um endpoint padrão de mercado e por isso usa `GET` em caminho `.well-known`, fora da convenção RPC das actions.
> - Proteção contra força bruta fica com o rate limiting do Gateway (Epic 4, FR-19).
> - Nesta story, `perms` vem da credencial. No Epic 3, a fonte passa a ser o ACL do Directory.

### Story 2.3: Refresh token opaco com rotação e logout

Como **usuário final de um sistema construído com o Tecton**,
quero continuar autenticado sem digitar a senha a cada 15 minutos,
para usar o sistema sem interrupção e sem que um refresh token roubado sirva para alguma coisa por muito tempo.

**Critérios de Aceite:**

**Dado** um login bem-sucedido
**Quando** a resposta é enviada
**Então** ela traz um cookie de refresh com valor aleatório opaco de pelo menos 256 bits, com os atributos `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/auth/refresh`
**E** o corpo da resposta nunca contém o refresh token
**E** o banco do Auth guarda só o hash do refresh, com identificador de família e validade (padrão de 7 dias, configurável)

**Dado** um refresh válido
**Quando** eu chamo `POST /auth/refresh`
**Então** recebo um novo access token e um novo refresh, e o refresh anterior fica marcado como usado

**Dado** um refresh que já foi usado
**Quando** ele é apresentado de novo
**Então** a resposta é 401, toda a família desse refresh é revogada e um evento de segurança é registrado em log (em inglês)

**Dado** um refresh expirado ou desconhecido
**Quando** ele é apresentado
**Então** a resposta é 401

**Dado** uma sessão ativa
**Quando** eu chamo `POST /auth/logout`
**Então** a família do refresh é revogada e o cookie é apagado

**Dado** um serviço de domínio qualquer
**Quando** ele recebe requisições
**Então** nunca recebe nem processa refresh token (FR-12), garantido pelo `Path` do cookie e pela ausência do token no corpo das respostas

> **Nota:** a revogação imediata do access token no logout depende do `TokenRevocationStore` e é coberta na Story 2.5.

### Story 2.4: Verificação local do token em todo serviço

Como **dev de um domínio**,
quero que cada rota gerada verifique o token por conta própria antes de executar a action,
para que nenhum serviço confie em outro, nem no Gateway, para decidir quem está chamando (Zero Trust, AD-7).

**Critérios de Aceite:**

**Dado** uma rota gerada pela Story 1.7 para uma action sem `auth.public: true`
**Quando** chega uma requisição sem `Authorization: Bearer`
**Então** a resposta é 401 antes de chegar ao handler

**Dado** um token recebido
**Quando** o plugin de verificação do `@tecton/core` o processa
**Então** ele verifica a assinatura EdDSA com a chave pública do JWKS em cache, além de `exp`, `iss` e `aud`
**E** rejeita qualquer token com `alg` diferente de `EdDSA`, incluindo `none` e `HS256`

**Dado** um token com `kid` que não está no cache
**Quando** ele chega
**Então** o JWKS é buscado de novo uma única vez, com limite de frequência
**E** se o `kid` continuar desconhecido, a resposta é 401

**Dado** um serviço sem JWKS em cache e com o serviço de Auth inacessível
**Quando** chega uma requisição autenticada
**Então** ela é rejeitada, nunca aceita sem verificação (fail-closed)

**Dado** um token válido do usuário A e um header como `x-user-id` ou `x-claims` dizendo ser o usuário B
**Quando** a requisição é processada
**Então** o serviço trata a chamada como do usuário A e ignora o header (AD-7)

**Dado** uma chamada direta ao serviço, sem passar pelo Gateway, com token adulterado
**Quando** ela chega
**Então** o próprio serviço a rejeita com 401 (FR-13)

**Dado** um token válido sem a permissão exigida em `auth.requires`
**Quando** a action é chamada
**Então** a resposta é 403

**Dado** uma action com `auth.public: true`
**Quando** ela é chamada sem token
**Então** ela é executada

> **Nota:** o corpo das respostas 401 e 403 é provisório. O formato final RFC 9457 é do Epic 5 (FR-24).

### Story 2.5: `TokenRevocationStore` com Valkey e fail-closed

Como **operador de um sistema construído com o Tecton**,
quero revogar um token e vê-lo rejeitado em todos os serviços imediatamente,
para não precisar esperar a expiração natural quando uma sessão é comprometida.

**Critérios de Aceite:**

**Dado** a interface `TokenRevocationStore` em `@tecton/providers` e o adaptador de referência Valkey
**Quando** um token é revogado pelo `jti`
**Então** a revogação é gravada no Valkey com tempo de vida igual ao que falta para o token expirar, sob chave com prefixo próprio do framework

**Dado** um token revogado
**Quando** ele é apresentado a qualquer serviço depois da revogação
**Então** o plugin de verificação da Story 2.4 o rejeita com 401, sem esperar o `exp` (FR-14)

**Dado** uma revogação de todos os tokens de um sujeito (ex.: conta desativada)
**Quando** ela é registrada
**Então** todo token desse sujeito emitido antes do momento da revogação passa a ser rejeitado

**Dado** um Valkey inacessível ou que não responde dentro do tempo limite configurado
**Quando** um serviço precisa checar a revogação
**Então** a requisição é rejeitada (fail-closed), nunca tratada como "não revogada" (FR-14, Constitution §9)

**Dado** um logout (Story 2.3)
**Quando** ele é concluído
**Então** o access token em uso também é revogado, além da família do refresh

**Dado** a detecção de reuso de refresh (Story 2.3)
**Quando** ela acontece
**Então** os access tokens do sujeito emitidos até aquele momento também são revogados

> **Nota:** o Dev Services com Valkey local é do Epic 6 (FR-30). Os testes desta story rodam contra um Valkey real em container.

### Story 2.6: Bloqueio de login por identificador

Como **operador de um sistema construído com o Tecton**,
quero que um login seja bloqueado temporariamente depois de várias senhas erradas, venham de onde vierem,
para que um ataque distribuído contra uma única conta não escape do rate limit por origem do Gateway.

**Critérios de Aceite:**

**Dado** um identificador de login normalizado
**Quando** acontecem N falhas dentro da janela configurada (padrão: 5 falhas em 15 minutos)
**Então** o login desse identificador fica bloqueado pelo tempo configurado (padrão: 15 minutos)
**E** o contador fica no Valkey, compartilhado entre todas as instâncias do serviço de Auth

**Dado** um identificador bloqueado
**Quando** chega uma tentativa de login, mesmo com a senha correta
**Então** a resposta é 429 com `Retry-After`, e a senha não é verificada

**Dado** um identificador que não existe
**Quando** ele recebe tentativas de login
**Então** o contador e o bloqueio funcionam igual a um identificador existente, para que o bloqueio não revele quais logins existem

**Dado** tentativas vindas de várias origens diferentes contra o mesmo identificador
**Quando** o limite é atingido
**Então** o bloqueio acontece do mesmo jeito, porque a contagem é por identificador e não por origem

**Dado** um login bem-sucedido antes de atingir o limite
**Quando** ele acontece
**Então** o contador de falhas desse identificador é zerado

**Dado** um bloqueio aplicado
**Quando** ele acontece
**Então** um evento de segurança é registrado em log (em inglês), com o identificador e sem nenhuma senha

**Dado** um administrador que precisa liberar uma conta antes do prazo
**Quando** ele roda `tecton-admin auth unlock <identificador>`
**Então** o bloqueio e o contador desse identificador são removidos

**Dado** um Valkey inacessível
**Quando** chega uma tentativa de login
**Então** ela é rejeitada (fail-closed), coerente com a Story 2.5

### Story 2.7: Token de serviço para chamadas entre serviços

Como **dev de um domínio que chama outro domínio**,
quero que toda chamada entre serviços leve uma credencial própria do serviço chamador,
para que quem recebe saiba qual serviço está chamando e em nome de qual usuário, verificando os dois por conta própria (FR-13, D3).

**Critérios de Aceite:**

**Dado** um domínio sem credencial de serviço
**Quando** eu rodo `tecton-admin auth register-service <domínio>`
**Então** é criada uma credencial `service:<domínio>` e o segredo aparece uma única vez na saída
**E** o Auth guarda só o hash do segredo, gerado pelo `AuthProvider` da Story 2.1

**Dado** uma credencial de serviço válida
**Quando** o serviço chama `POST /auth/service-token`
**Então** recebe um token EdDSA com `typ: service`, `sub: service:<domínio>`, `perms` do serviço e validade curta (padrão de 5 minutos, configurável)
**E** nenhum refresh é emitido para token de serviço

**Dado** uma chamada entre serviços em nome de um usuário
**Quando** ela chega com o token de serviço em `Authorization` e o token do usuário em `Tecton-On-Behalf-Of`
**Então** quem recebe verifica os dois tokens de forma independente, com as mesmas regras da Story 2.4
**E** `auth.requires` é avaliado contra as permissões do usuário, nunca contra as do serviço

**Dado** uma chamada entre serviços sem usuário (ex.: job ou consumo de evento)
**Quando** ela chega só com o token de serviço
**Então** `auth.requires` é avaliado contra as permissões do serviço

**Dado** um token de serviço e um token de usuário em `Tecton-On-Behalf-Of` em que um dos dois é inválido, expirado ou revogado
**Quando** a chamada chega
**Então** ela é rejeitada com 401

**Dado** um token de serviço
**Quando** ele é apresentado a `POST /auth/refresh` ou a `POST /auth/login`
**Então** ele é recusado

> **Nota:** esta story entrega emissão e verificação. A anexação automática dos tokens no `ServiceClient` e na publicação e consumo de eventos é do Epic 4 (FR-21, FR-26).

### Story 2.8: Interface `KeyCustodyProvider` e aviso de `sensitive.quorum` sem provider

Como **dev que marcou uma action como `sensitive.quorum`**,
quero que o framework declare o contrato do Custodiante e me avise toda vez que a action rodar sem proteção real,
para que a ausência de custódia nunca passe despercebida e a implementação futura já nasça no lugar certo.

**Critérios de Aceite:**

**Dado** a interface `KeyCustodyProvider` em `@tecton/providers`
**Quando** eu leio a documentação do contrato
**Então** ela diz, em inglês, que a interceptação de `sensitive.quorum` acontece no nível de acesso ao dado e nunca só num middleware de rota HTTP (FR-11)
**E** nenhum método da interface recebe objeto de requisição HTTP, o que impede por construção uma implementação presa à rota

**Dado** uma action `sensitive.quorum` e nenhum `KeyCustodyProvider` configurado
**Quando** ela é chamada
**Então** ela executa normalmente, sem bloquear e sem responder `202` (FR-11, com precedência sobre o FR-25)
**E** cada execução registra um aviso em log (em inglês) com o nome da action, dizendo que rodou sem proteção de quórum

**Dado** um serviço sem `KeyCustodyProvider` configurado
**Quando** ele sobe
**Então** todas as outras funções do framework funcionam normalmente

> **Nota:** o aviso de build/CI do `tecton-admin lint` para `sensitive.quorum` sem provider é do Epic 6 (FR-17). A implementação real (OpenBAO, quórum x/n, auditoria encadeada) é roadmap.
