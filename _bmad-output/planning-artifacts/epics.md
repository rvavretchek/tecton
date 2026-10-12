---
stepsCompleted: [1, 2, 3, 4]
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
- FR-6: Persistência da hierarquia via Closure Table (Prisma; PostgreSQL, MariaDB e MySQL; MS-SQL saiu do MVP em 2026-10-06, MariaDB entrou em 2026-10-07), detecção de ciclo
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
- NFR-4: Portabilidade de banco — trocar entre PostgreSQL, MariaDB e MySQL via Prisma nunca exige mudança de schema/código de domínio (FR-6)
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
- Stack fixado (corrigido em 2026-10-06): Node.js 24.x (>=24.7), TypeScript 6.0.3, Fastify 5.12.x, Prisma 7.x (o 8 ainda não suporta MySQL nem MariaDB), Valkey 9.1.x, React 19.x, `@rjsf/core` 6.x mais recente, JSON Schema draft-07, OpenTelemetry, Awilix, Testcontainers
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
FR-6: Epic 4 - Persistência da hierarquia via Closure Table
FR-7: Epic 4 - Controle de acesso por herança aditiva
FR-8: Epic 4 - Navegação e edição de objetos (Directory admin UI)
FR-9: Epic 4 - Domínio Tenant
FR-10: Epic 4 - Domínio Usuário/Grupo
FR-11: Epic 2 - Domínio Custodiante (interface)
FR-12: Epic 2 - AuthProvider com JWT e refresh confinado
FR-13: Epic 2 - Verificação independente por serviço (Zero Trust)
FR-14: Epic 2 - Revogação de token via TokenRevocationStore
FR-15: Epic 1 (new/generate) + Epic 3 (dev, Story 3.13) + Epic 6 (migrate) - Comandos essenciais do ciclo de vida
FR-16: Epic 6 - `extract` para migração assistida
FR-17: Epic 6 - Família de lint
FR-18: Epic 5 - `test:contracts`
FR-19: Epic 3 - Gateway fino com responsabilidades proibidas
FR-20: Epic 3 - Service Discovery estático
FR-21: Epic 3 - Comunicação assíncrona via CloudEvents/Valkey Streams
FR-22: Epic 3 - ConfigProvider com validação tipada
FR-23: Epic 5 - Sucesso como payload puro
FR-24: Epic 5 - Erro como RFC 9457 Problem Details
FR-25: Epic 5 - Estado pendente como 202 Accepted dedicado
FR-26: Epic 3 - ServiceClient com retry/timeout seguro
FR-27: Epic 3 - Health checks padrão por serviço
FR-28: Epic 3 - Dockerfile por domínio
FR-29: Epic 5 - Evolução aditiva de contrato por padrão
FR-30: Epic 1 - Dev Services (Story 1.11)
FR-31: Epic 6 - Testcontainers para isolamento de teste/CI

### NFR Coverage Map

NFR-1 (Zero Trust): Stories 2.4, 2.5, 2.6, 2.7, 3.6, 3.9, 3.12 (AD-7)
NFR-2 (i18n): Stories 4.6, 4.11, 5.2, 5.3, 5.4 (AD-6, AD-10)
NFR-3 (OpenTelemetry): Stories 3.3, 3.6, 3.9, 3.10, 3.12
NFR-4 (Portabilidade de banco): Stories 1.1 (job de matriz), 3.10, 4.1, 6.1, 6.8
NFR-5 (Retry seguro): Stories 3.8, 3.9
NFR-6 (Fail-fast / fail-closed / fail-open): Stories 3.1 (fail-fast), 2.4, 2.5, 2.6, 4.4 (fail-closed), 3.7 (fail-open)
NFR-7 (Evolução de contrato): Stories 5.7, 5.8
NFR-8 (TypeScript full-stack, DI leve): Stories 1.1 (TypeScript), 3.4 (Awilix)

## Epic List

### Epic 1: Manifest Declarativo e Scaffold Inicial
Dev (ou agente de IA) cria um workspace Tecton, declara um domínio via `tecton.yaml` com `objectClass` opcional, actions tipadas (`sensitive`/`approval`), events publicados/consumidos e dependencies, e recebe validação + documentação OpenAPI/AsyncAPI geradas automaticamente — sem escrever nenhum código de plumbing. Inclui o scaffold mínimo do monorepo (pnpm workspaces, `@tecton/manifest`) e uma versão inicial de `tecton-admin new`/`generate domain` suficiente para produzir o manifest.
**FRs covered:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-15 (parcial: `new`/`generate`), FR-30

### Epic 2: Autenticação e Zero Trust
Dev tem um serviço de Auth funcional (Argon2id+Pepper, JWT de acesso + refresh confinado) e todo serviço gerado verifica a assinatura do token por conta própria, nunca aceitando header pré-decodificado; revogação de token via `TokenRevocationStore` Valkey-backed real, fail-closed se o Valkey estiver inacessível. Inclui Custodiante como primitivo de segurança — interface `KeyCustodyProvider` e conceito `sensitive.quorum`, sem implementação real de custódia (movido do Epic 4 por não compartilhar Closure Table/ACL/tela com Tenant/Usuário-Grupo — decisão da mesa de arquitetura, 2026-09-04). Restrição de design herdada do PRD (FR-11): a interceptação de `sensitive.quorum`, quando implementada, precisa acontecer no nível de acesso ao dado, nunca só num middleware de rota HTTP.
**FRs covered:** FR-12, FR-13, FR-14, FR-11

### Epic 3: Interoperabilidade entre Domínios
Dev gera domínios de negócio (via `generate domain` do Epic 1) que se comunicam com segurança — chamada síncrona via `ServiceClient` com retry seguro (nunca cego), e assíncrona via CloudEvents sobre Valkey Streams (at-least-once, dead-letter) — atrás de um Gateway fino com responsabilidades proibidas explícitas, `ConfigProvider` com fail-fast no startup, health checks padrão e Dockerfile por domínio. **Nota de dependência (decisão da mesa, 2026-09-04):** nasce com formato de erro provisório (status HTTP + corpo básico) — o formato final (RFC 9457/i18n) é entregue pelo Epic 5, que enriquece em vez de recriar; stories deste épico devem nomear explicitamente esse caráter provisório para não gerar retrabalho.
**FRs covered:** FR-19, FR-20, FR-21, FR-22, FR-26, FR-27, FR-28, FR-15 (parcial: `dev`)

### Epic 4: Core de Diretório e Domínios Embutidos
Marina cria Tenant/Usuário/Grupo, navega a árvore de objetos em `/admin` (com busca, ícones por objectClass, navegação por teclado), edita atributos via formulário gerado (`@rjsf/core`) e gerencia ACL por herança aditiva — tudo autenticado via Epic 2. Backend (`@tecton/directory`) e frontend (`@tecton/ui`, tema + `UiThemeProvider`) entregues juntos, por serem o mesmo componente ponta-a-ponta.
**FRs covered:** FR-6, FR-7, FR-8, FR-9, FR-10
**Ordem (decisão de 2026-10-02):** vem depois da Interoperabilidade porque a SPA `/admin` chama a API pelo Gateway (AD-10), os outros domínios consomem os eventos do Directory (AD-2/AD-9) e a criação de usuário chama o Auth pelo `ServiceClient`. O `perms` do token passa a vir de uma consulta do Auth ao Directory no login e no refresh.

### Epic 5: Formato de API e Evolução de Contrato
Toda action de todo domínio gerado responde em formato consistente — sucesso como payload puro, erro como RFC 9457 Problem Details multi-idioma, estado pendente como `202 Accepted` dedicado — com `test:contracts` garantindo que a evolução do manifest seja aditiva por padrão e nunca quebre um consumidor existente. Enriquece o formato de erro provisório do Epic 3 para a forma final, sem recriá-lo do zero.
**FRs covered:** FR-18, FR-23, FR-24, FR-25, FR-29

### Epic 6: CLI Completo e Developer Experience
Dev tem o ciclo de vida completo do `tecton-admin`: `migrate` (Prisma), `extract` (migração assistida Strangler Fig, Caso 1), família `lint` (`lint:gateway` + aviso de quórum sem provider), e `test:contracts`/CI isolados via Testcontainers.
**FRs covered:** FR-16, FR-17, FR-31, FR-15 (parcial: `migrate`)

## Epic 1: Manifest Declarativo e Scaffold Inicial

Dev (ou agente de IA) cria um workspace Tecton, declara um domínio via `tecton.yaml` e recebe validação + documentação OpenAPI/AsyncAPI geradas automaticamente, sem escrever código de plumbing. Este épico declara e valida; comportamento em execução de `approval` (Epic 5) e conector de mensageria (Epic 3) ficam fora.

### Story 1.1: Scaffold do monorepo do framework

Como **contribuidor do framework (humano ou agente de IA)**,
quero um monorepo pnpm com os 8 pacotes e a direção de dependência verificada automaticamente,
para que cada story seguinte tenha onde nascer sem violar o AD-3.

**Critérios de Aceite:**

**Dado** um clone limpo do repositório
**Quando** eu rodo `pnpm install` e `pnpm build`
**Então** os pacotes `@tecton/{manifest,core,providers,auth,directory,service-client,ui,cli}` compilam com TypeScript 6.0.3, com `engines.node` fixado em `>=24.7 <25`
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

**Dado** testes marcados como de persistência, a partir do momento em que existirem
**Quando** o CI roda
**Então** um job dedicado executa esses testes em PostgreSQL, MariaDB e MySQL e é obrigatório para merge
**E** no ciclo local e nos demais jobs, os testes de persistência rodam só em PostgreSQL, para manter o ciclo de desenvolvimento rápido

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
**E** `input` e `output` são compilados para JSON Schema draft-07 (Consistency Conventions), para uso na Story 1.7

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

> **Nota:** nenhum código de broker nasce aqui. O conector Valkey Streams é do Epic 3 (FR-21).

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
**Então** viram um JSON Schema draft-07 que o `@rjsf/core` 6.x e o validador de atributos do Directory conseguem consumir (AD-2)
**E** `unique` vira o metadado de extensão `x-tecton-unique`, porque não existe em JSON Schema
**E** um atributo com `readOnly: true` no manifest vira `readOnly` no JSON Schema

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
**Então** a resolução segue esta ordem: (1) manifest no workspace local; (2) manifest exportado por um pacote npm instalado; (3) caminho explícito declarado em `dependencies`
**E** a resolução por pacote npm é testada com um pacote de fixture; o `@tecton/directory` (Story 4.1) e o `@tecton/auth` (Story 2.2) passam a usar esse mesmo caminho quando existirem

**Dado** um `objectClass` em `allowedParents` ou `allowedChildren` que não é encontrado por nenhum dos três caminhos
**Quando** o lint roda
**Então** ele falha e nomeia a referência não resolvida (FR-2)

**Dado** uma entrada `consumes` que aponta para um evento que não está em `publishes` do domínio de origem
**Quando** o lint roda
**Então** ele falha e nomeia o domínio e o evento

**Dado** uma dependência declarada por URL remota
**Quando** o lint roda
**Então** ele falha com mensagem clara de que esse modo de resolução não existe no MVP

**Dado** domínios que dependem um do outro por chamada síncrona (ex.: Auth e Directory)
**Quando** o lint encontra o ciclo em `dependencies`
**Então** registra um aviso que nomeia o ciclo, sem falhar, porque o ciclo pode ser proposital

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

**Dado** qualquer erro gerado pelo framework, a partir desta story e em todos os épicos seguintes
**Quando** ele é lançado
**Então** passa por uma abstração única de erro do `@tecton/core` (status, `slug`, `i18nKey` e mensagem) e é convertido em resposta por um único serializador, provisório até o Epic 5
**E** nenhum outro código monta corpo de resposta de erro por conta própria

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

**Dado** um workspace novo
**Quando** eu rodo `tecton-admin new`
**Então** são criadas sementes curtas de `AGENTS.md` e `README.md`, em inglês, que dizem ao agente de IA que os documentos ainda não foram escritos e que ele deve escrevê-los seguindo o guia do Tecton e substituir a semente
**E** é criado um `CLAUDE.md` que só aponta para o `AGENTS.md`, para não manter dois arquivos com o mesmo conteúdo

**Dado** o guia de documentação para agentes, distribuído no pacote `@tecton/cli` em inglês
**Quando** eu o leio
**Então** ele define a estrutura recomendada do `AGENTS.md`, incluindo uma seção marcada com a lista de domínios e dependências em formato verificável e uma seção de regras invioláveis (nunca acessar o banco de outro domínio, nunca editar `@tecton/*`, nunca desligar a verificação de token)
**E** orienta que o documento seja escrito e mantido só por agentes, no idioma escolhido pelo dev, preservando o máximo do conteúdo existente a cada atualização
**E** determina que as regras invioláveis nunca sejam removidas nem enfraquecidas, só ampliadas, e que mudanças no `AGENTS.md` passem por revisão de PR como código
**E** nenhum trecho dos documentos é bloqueado contra edição

**Dado** a semente do `README.md`
**Quando** o agente faz a primeira tarefa no workspace
**Então** o guia o orienta a entrevistar o dev sobre o produto e escrever o README no idioma escolhido pelo dev

> **Nota:** `apps/gateway` entra no Epic 3, `apps/directory` no Epic 4 e `docker-compose.dev.yml` na Story 1.11. Cada épico estende o `new`.

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

**Dado** um domínio recém-gerado
**Quando** eu o inicio pelo script do próprio pacote
**Então** ele sobe um servidor Fastify com as rotas da Story 1.7, e cada action responde 501 até ser implementada
**E** isso é o esqueleto executável mínimo (*walking skeleton*) que os épicos seguintes enriquecem

**Dado** domínios gerados
**Quando** o comando termina
**Então** a saída lembra o agente de atualizar a seção marcada do `AGENTS.md`

**Dado** um `AGENTS.md` cuja seção marcada não bate com os manifests do workspace
**Quando** eu rodo `tecton-admin lint` (Story 1.6)
**Então** aparece um aviso, sem falha, indicando os domínios ou dependências divergentes, também na saída `--format json`

> **Nota:** a estrutura de código hexagonal do domínio (AD-1) chega no Epic 3. Os nomes de domínio seguem a convenção de identificador em inglês (Consistency Conventions), por isso o exemplo usa `finance inventory sales` e não o `financeiro materiais comercial` do PRD.

### Story 1.11: Dev Services

Como **dev começando num workspace Tecton**,
quero a infraestrutura de desenvolvimento pronta num único arquivo,
para subir banco e Valkey sem configurar nada à mão (FR-30).

**Critérios de Aceite:**

**Dado** `tecton-admin new <projeto> --db postgres|mariadb|mysql` (padrão: `postgres`)
**Quando** ele roda
**Então** gera `docker-compose.dev.yml` com Valkey 9.1 e o banco escolhido (FR-30)
**E** cada domínio tem seu banco lógico próprio, criado na primeira subida; o Auth (Story 2.2) e o Directory (Story 4.1) acrescentam os seus quando entram
**E** o arquivo de exemplo de ambiente já aponta para esses bancos e para o Valkey

**Dado** `tecton-admin generate domain <nome>`
**Quando** ele roda depois desta story
**Então** o banco lógico do domínio novo é acrescentado ao Dev Services

**Dado** o `docker-compose.dev.yml` em execução
**Quando** eu subo qualquer serviço do workspace
**Então** banco e Valkey já estão disponíveis, sem nenhum passo adicional de infraestrutura (FR-30)

**Dado** o arquivo gerado
**Quando** eu o leio
**Então** um comentário em inglês avisa que ele é só para desenvolvimento, não para produção

> **Nota:** movida do Epic 6 no pre-mortem de 2026-10-05, para que o Valkey e o banco locais existam desde o Epic 2. O `tecton-admin dev`, que usa este arquivo, está na Story 3.13.

## Epic 2: Autenticação e Zero Trust

Dev tem um serviço de Auth pronto (`@tecton/auth`: Argon2id + Pepper, access token EdDSA verificável por JWKS, refresh opaco confinado ao Auth) e todo serviço verifica o token por conta própria, sem aceitar header pré-decodificado; revogação via `TokenRevocationStore` com Valkey e fail-closed; token de serviço em toda chamada entre serviços; interface `KeyCustodyProvider` para o Custodiante, sem implementação real. Mecanismo fixado na emenda do AD-7 de 2026-10-01.

### Story 2.1: `AuthProvider` com Argon2id e Pepper

Como **dev que precisa guardar senhas com segurança**,
quero um `AuthProvider` que gere e verifique hash de senha com Argon2id e Pepper,
para que nenhuma senha seja guardada de forma recuperável, mesmo se o banco vazar.

**Critérios de Aceite:**

**Dado** a interface `AuthProvider` em `@tecton/providers` e o adaptador de referência Argon2id, que usa o `crypto.argon2` nativo do Node (disponível desde a 24.7.0) se ele estiver estável na versão fixada, ou `@node-rs/argon2` caso ainda seja experimental, com a escolha e o motivo registrados no README do pacote
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

> **Nota:** a leitura do Pepper usa validação mínima própria. O `ConfigProvider` formal com fail-fast é do Epic 3 (FR-22) e vai absorver essa leitura.

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
**E** o comando grava direto no banco do Auth, com acesso local a ele; não existe endpoint HTTP de bootstrap

**Dado** um Auth que já tem pelo menos uma credencial
**Quando** alguém roda `tecton-admin auth bootstrap`
**Então** o comando falha sem alterar nada

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

**Dado** o pacote `@tecton/auth`
**Quando** eu inspeciono o que ele exporta
**Então** ele traz o próprio `tecton.yaml`, com as actions do Auth (`login`, `refresh`, `logout`, `service-token` e, a partir da Story 4.3, `create-credential`), resolvível pelo lint como pacote npm (Story 1.6)
**E** o JWKS fica fora do manifest, porque não é action

**Dado** um workspace novo
**Quando** eu rodo `tecton-admin new`
**Então** é gerado `apps/auth` como instância configurada de `@tecton/auth`, com dependência versionada (AD-4)

**Dado** qualquer log do serviço de Auth
**Quando** eu o inspeciono
**Então** senha, hash, Pepper, chave privada e tokens nunca aparecem

> **Notas:**
> - O JWKS é um endpoint padrão de mercado e por isso usa `GET` em caminho `.well-known`, fora da convenção RPC das actions.
> - Proteção contra força bruta fica com o rate limiting do Gateway (Epic 3, FR-19).
> - Nesta story, `perms` vem da credencial. No Epic 4, a fonte passa a ser o ACL do Directory.

> **Nota de tamanho (pre-mortem de 2026-10-05):** story grande para uma única sessão de agente; candidata a divisão no `bmad-create-story`.

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

**Dado** a URL do JWKS configurada no serviço
**Quando** o serviço sobe fora do modo de desenvolvimento
**Então** o startup falha se a URL não for `https`
**E** um redirecionamento do JWKS para outro host é recusado, para que ninguém na rede interna consiga entregar uma chave falsa (AD-7)

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

> **Nota:** o Valkey local de desenvolvimento vem do Dev Services (Story 1.11). Os testes desta story rodam contra um Valkey real em container.

### Story 2.6: Bloqueio de login por identificador

Como **operador de um sistema construído com o Tecton**,
quero que um login seja bloqueado temporariamente depois de várias senhas erradas, venham de onde vierem,
para que um ataque distribuído contra uma única conta não escape do rate limit por origem do Gateway (FR-12, NFR-1).

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

> **Risco aceito (auditoria de segurança de 2026-10-06):** como a contagem é por identificador, alguém pode bloquear de propósito a conta de outra pessoa errando a senha dela. É o custo conhecido de bloquear por conta; o `tecton-admin auth unlock` existe para isso. Registrado na documentação de operação.

### Story 2.7: Token de serviço para chamadas entre serviços

Como **dev de um domínio que chama outro domínio**,
quero que toda chamada entre serviços leve uma credencial própria do serviço chamador,
para que quem recebe saiba qual serviço está chamando e em nome de qual usuário, verificando os dois por conta própria (FR-13, D3).

**Critérios de Aceite:**

**Dado** um domínio sem credencial de serviço
**Quando** eu rodo `tecton-admin auth register-service <domínio>` autenticado como administrador com a permissão `auth:service:register`
**Então** é criada uma credencial `service:<domínio>` e o segredo aparece uma única vez na saída
**E** o Auth guarda só o hash do segredo, gerado pelo `AuthProvider` da Story 2.1

**Dado** uma chamada de registro sem token de administrador ou sem `auth:service:register`
**Quando** ela chega ao Auth
**Então** é recusada e nada é criado

**Dado** um domínio que já tem credencial de serviço
**Quando** alguém tenta registrá-lo de novo
**Então** a operação falha, a menos que use `--rotate`, que também exige administrador, gera credenciais novas e revoga as antigas e todos os tokens emitidos com elas

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

**Dado** o registro de um serviço
**Quando** o Auth emite o token de serviço
**Então** o token traz `call:<domínio>` só para os domínios declarados em `dependencies` no manifest do serviço chamador, lido no registro

**Dado** uma chamada entre serviços, com ou sem `Tecton-On-Behalf-Of`
**Quando** ela chega
**Então** o serviço chamado exige `call:<próprio domínio>` no token de serviço, além das permissões avaliadas para `auth.requires`
**E** um serviço que não declarou o domínio chamado em `dependencies` recebe 403, mesmo trazendo um token de usuário válido

> **Nota:** esta story entrega emissão e verificação. A anexação automática dos tokens no `ServiceClient` e na publicação e consumo de eventos é do Epic 3 (FR-21, FR-26).

> **Risco aceito (auditoria de segurança de 2026-10-06):** um serviço comprometido pode reaproveitar, até expirarem (15 minutos), tokens de usuário que recebeu. É inerente à propagação de token; a exigência de `call:<domínio>` limita para onde ele pode usá-los. Registrado na documentação de operação.

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

## Epic 3: Interoperabilidade entre Domínios

Dev gera domínios de negócio que já nascem como serviços hexagonais completos e se comunicam com segurança: chamada síncrona via `ServiceClient` (retry só quando seguro, `Idempotency-Key` respeitado no servidor), assíncrona via CloudEvents assinados sobre Valkey Streams (at-least-once, deduplicação, dead-letter), atrás de um Gateway fino com rate limiting fail-open; `ConfigProvider` com fail-fast, health checks, OpenTelemetry e Dockerfile por domínio. O formato de erro deste épico é provisório (status HTTP + corpo básico); o RFC 9457 final é do Epic 5.

### Story 3.1: `ConfigProvider` tipado com fail-fast

Como **dev ou operador subindo um serviço**,
quero que a configuração seja validada e tipada antes do serviço aceitar tráfego,
para que uma variável faltando ou errada derrube o startup com mensagem clara, em vez de causar erro estranho em produção.

**Critérios de Aceite:**

**Dado** a interface `ConfigProvider` em `@tecton/providers` e o adaptador de referência de variáveis de ambiente (com suporte a `.env` em desenvolvimento)
**Quando** um serviço declara o schema tipado da própria configuração
**Então** o núcleo do serviço recebe um objeto de configuração já tipado e validado

**Dado** uma variável obrigatória ausente
**Quando** o serviço sobe
**Então** o startup falha antes de abrir a porta, com mensagem (em inglês) que identifica o campo (FR-22)

**Dado** uma variável presente com formato ou tipo inválido (ex.: URL malformada, texto onde se espera número)
**Quando** o serviço sobe
**Então** o startup falha da mesma forma, com mensagem que identifica o campo e mostra o formato esperado e o recebido (FR-22)
**E** o valor recebido nunca aparece na mensagem quando o campo é marcado como secreto

**Dado** uma configuração com vários problemas
**Quando** o serviço sobe
**Então** todos os problemas são listados de uma vez

**Dado** o Pepper (Story 2.1) e a chave privada de assinatura (Story 2.2)
**Quando** esta story é concluída
**Então** a leitura deles passa a usar o `ConfigProvider`, e a validação mínima própria daquelas stories é removida

**Dado** o núcleo de qualquer serviço
**Quando** eu verifico o código
**Então** ele nunca lê `process.env` diretamente; só o adaptador lê (AD-1)

**Dado** um workspace gerado por `tecton-admin new`
**Quando** eu inspeciono o `.gitignore`
**Então** os arquivos `.env` estão ignorados

### Story 3.2: Health checks padrão em todo serviço

Como **operador de um sistema construído com o Tecton**,
quero que todo serviço exponha `/health`, `/ready` e `/live` sem código escrito à mão,
para que o orquestrador saiba quando um serviço está de pé e quando está pronto para receber tráfego.

**Critérios de Aceite:**

**Dado** qualquer serviço construído sobre o `@tecton/core`, incluindo o Auth
**Quando** ele sobe
**Então** expõe `GET /health`, `GET /ready` e `GET /live` automaticamente (FR-27)
**E** essas rotas seguem a convenção de probes do Kubernetes e por isso usam `GET`, fora da convenção RPC das actions

**Dado** um processo de pé com o banco ou o Valkey inacessível
**Quando** eu chamo `/live`
**Então** a resposta é 200 (FR-27)

**Dado** uma dependência registrada (banco ou Valkey) inacessível
**Quando** eu chamo `/ready`
**Então** a resposta é 503 e o corpo informa qual dependência falhou (FR-27)

**Dado** os adaptadores de Prisma e Valkey
**Quando** o serviço sobe
**Então** eles registram as próprias checagens automaticamente, sem configuração do dev

**Dado** as rotas de health
**Quando** são chamadas sem token
**Então** respondem normalmente
**E** nunca expõem string de conexão, credencial ou versão de dependência

### Story 3.3: Observabilidade com OpenTelemetry

Como **operador que precisa investigar uma falha que atravessa vários serviços**,
quero que cada serviço gere traces e propague o `traceparent`,
para seguir uma requisição de ponta a ponta sem instrumentar nada à mão (NFR-3).

**Critérios de Aceite:**

**Dado** qualquer serviço construído sobre o `@tecton/core`
**Quando** ele sobe
**Então** o SDK do OpenTelemetry é inicializado com instrumentação automática de Fastify, Prisma e cliente HTTP

**Dado** uma requisição com `traceparent`
**Quando** ela chega
**Então** o trace existente continua; sem `traceparent`, um trace novo é criado

**Dado** um endpoint de exportação OTLP configurado pelo `ConfigProvider`
**Quando** o serviço sobe
**Então** os traces são exportados para ele
**E** sem endpoint configurado, o tracing fica desativado e o startup registra um aviso, sem falhar

**Dado** os logs estruturados do serviço (JSON, em inglês)
**Quando** são escritos dentro de uma requisição
**Então** incluem o `trace_id`

**Dado** qualquer span ou log
**Quando** eu o inspeciono
**Então** o header `Authorization`, tokens, senhas e cookies nunca aparecem

> **Nota:** a propagação de `traceparent` no `ServiceClient` e nos eventos está nas Stories 3.9 e 3.10.

### Story 3.4: Esqueleto hexagonal do domínio gerado e Dockerfile

Como **dev que acabou de gerar um domínio**,
quero que ele já nasça como um serviço completo na estrutura hexagonal, com Dockerfile próprio,
para implementar só as regras de negócio, sem montar servidor, DI, configuração nem build de imagem.

**Critérios de Aceite:**

**Dado** `tecton-admin generate domain <nome>` (Story 1.10)
**Quando** ele roda
**Então** o esqueleto executável da Story 1.10 é reorganizado em `src/core` (handlers das actions), `src/ports`, `src/adapters`, container Awilix e bootstrap do servidor
**E** o bootstrap liga as rotas da Story 1.7, a verificação de token da Story 2.4, a configuração da Story 3.1, os health checks da Story 3.2 e a observabilidade da Story 3.3

**Dado** uma action declarada no manifest
**Quando** o domínio é gerado
**Então** existe um handler stub em `src/core` que responde 501 até ser implementado

**Dado** um arquivo em `src/core` que importa Fastify, Prisma, cliente Valkey ou outra infraestrutura concreta
**Quando** a checagem de arquitetura do domínio roda
**Então** ela falha e indica o import (AD-1)

**Dado** o domínio gerado
**Quando** eu construo a imagem com o Dockerfile dele
**Então** a imagem é construída sem nenhum código de outro domínio (FR-28)
**E** o build é multi-stage e o processo roda com usuário sem privilégio de root

**Dado** o domínio gerado
**Quando** eu inspeciono a configuração
**Então** ele tem schema Prisma próprio e variável própria de URL de banco (persistência por serviço)
**E** o arquivo de exemplo de ambiente do workspace ganha `TECTON_SERVICE_<DOMÍNIO>_URL`, com o nome em maiúsculas e hífen trocado por sublinhado (FR-20)

**Dado** todo o código gerado
**Quando** eu o inspeciono
**Então** identificadores, comentários e mensagens estão em inglês (Constitution §8, eixo 2)

> **Nota:** o comando `tecton-admin migrate` é do Epic 6.

> **Nota de tamanho (pre-mortem de 2026-10-05):** story grande para uma única sessão de agente; candidata a divisão no `bmad-create-story`.

### Story 3.5: `ServiceDiscoveryProvider` estático

Como **dev de um domínio que depende de outro**,
quero resolver o endereço do outro domínio por uma porta, e não lendo variável de ambiente direto,
para que a descoberta dinâmica do roadmap (DNS do Kubernetes) troque só o adaptador, sem mexer no meu código (FR-20).

**Critérios de Aceite:**

**Dado** a interface `ServiceDiscoveryProvider` em `@tecton/providers` e o adaptador estático
**Quando** o núcleo pede o endereço de um domínio
**Então** o adaptador devolve o valor de `TECTON_SERVICE_<DOMÍNIO>_URL`, lido pelo `ConfigProvider`

**Dado** um domínio declarado em `dependencies` sem a variável correspondente, ou com URL inválida
**Quando** o serviço sobe
**Então** o startup falha (fail-fast, Story 3.1)

**Dado** um teste que substitui o adaptador estático por um falso
**Quando** ele roda
**Então** nenhuma linha do código de domínio precisa mudar (FR-20)

**Dado** o código de domínio
**Quando** eu o verifico
**Então** ele nunca lê `TECTON_SERVICE_*` diretamente

### Story 3.6: Gateway fino

Como **dev de um sistema construído com o Tecton**,
quero um Gateway gerado que só roteie, verifique o token como primeira barreira e propague o trace,
para ter um ponto de entrada único sem que ele acumule lógica de negócio (FR-19, AD-8).

**Critérios de Aceite:**

**Dado** um workspace novo
**Quando** eu rodo `tecton-admin new`
**Então** é gerado `apps/gateway`, como código editável do dev que importa `@tecton/core` como dependência versionada (AD-4, AD-8)

**Dado** os manifests do workspace e o serviço de Auth
**Quando** o Gateway é construído
**Então** a tabela de rotas é gerada a partir deles: cada prefixo `/<domínio>/` encaminha para o endereço resolvido pelo `ServiceDiscoveryProvider`, e `/auth/` encaminha para o Auth
**E** um prefixo desconhecido responde 404

**Dado** uma requisição para uma action sem `auth.public: true`
**Quando** o token falta ou é inválido
**Então** o Gateway responde 401 sem encaminhar
**E** quando o token é válido, o Gateway encaminha o header `Authorization` original sem alteração (AD-7)

**Dado** uma requisição externa com `Tecton-On-Behalf-Of` ou com headers de identidade como `x-user-id`
**Quando** ela passa pelo Gateway
**Então** esses headers são removidos antes do encaminhamento, porque só chamadas entre serviços podem usá-los

**Dado** qualquer requisição encaminhada
**Quando** ela passa pelo Gateway
**Então** o `traceparent` é propagado ou criado
**E** corpo e resposta passam sem transformação, sem retry, sem cache e sem agregação de serviços (FR-19)

**Dado** o cookie de refresh com `Path=/auth/refresh` (Story 2.3)
**Quando** o navegador chama o refresh pelo Gateway
**Então** o cookie chega ao Auth e a resposta volta sem alteração

> **Notas:**
> - O `tecton-admin lint:gateway` que vigia as dependências do Gateway é do Epic 6 (FR-17).
> - O roteamento de `/admin` para o Directory entra no Epic 4.
> - O rate limiting está na Story 3.7.

### Story 3.7: Rate limiting no Gateway com fail-open

Como **operador de um sistema construído com o Tecton**,
quero limitar o volume de requisições por cliente no Gateway,
para proteger os serviços de abuso sem derrubar todo o tráfego quando o Valkey falhar.

**Critérios de Aceite:**

**Dado** uma requisição anônima
**Quando** ela passa pelo Gateway
**Então** ela é contada pelo IP do cliente
**E** uma requisição autenticada é contada pelo `sub` do token já verificado pelo Gateway

**Dado** limites configuráveis por prefixo de rota, com um padrão global
**Quando** um cliente ultrapassa o limite
**Então** a resposta é 429 com `Retry-After`

**Dado** várias instâncias do Gateway
**Quando** elas atendem o mesmo cliente
**Então** a contagem é compartilhada pelo Valkey

**Dado** um header `X-Forwarded-For`
**Quando** o Gateway determina o IP do cliente
**Então** ele só confia nesse header se a requisição vier de um proxy configurado como confiável; caso contrário, usa o IP da conexão

**Dado** um Valkey inacessível
**Quando** chega uma requisição
**Então** ela passa sem limite e é registrado um aviso em log (fail-open, FR-19)
**E** o aviso tem limite de frequência, para não inundar o log durante a falha

**Dado** as rotas de health do próprio Gateway
**Quando** são chamadas
**Então** não entram na contagem

### Story 3.8: `Idempotency-Key` respeitado no servidor

Como **dev de um domínio que recebe mutações**,
quero que o framework guarde a resposta de uma mutação feita com `Idempotency-Key` e a devolva numa repetição,
para que o retry do `ServiceClient` (Story 3.9) nunca execute o mesmo efeito duas vezes (FR-26, NFR-5).

**Critérios de Aceite:**

**Dado** uma action sem `idempotent: true` chamada com o header `Idempotency-Key`
**Quando** ela é executada pela primeira vez
**Então** o status e o corpo da resposta são guardados no Valkey, numa chave formada pelo sujeito autenticado, pela action e pela chave de idempotência, com validade configurável (padrão de 24 horas)

**Dado** a mesma chave, o mesmo sujeito e o mesmo corpo
**Quando** a requisição é repetida
**Então** a resposta guardada é devolvida e o handler não é executado de novo

**Dado** a mesma chave com um corpo diferente
**Quando** a requisição chega
**Então** a resposta é 422 e nada é executado

**Dado** uma repetição que chega enquanto a primeira execução ainda está em andamento
**Quando** ela é recebida
**Então** a resposta é 409 e nada é executado de novo

**Dado** uma primeira execução que terminou com erro 5xx
**Quando** a mesma chave é usada de novo
**Então** a action pode ser executada novamente, porque respostas 5xx não são guardadas

**Dado** uma chave de outro sujeito
**Quando** ela é reutilizada
**Então** a resposta guardada nunca é devolvida, porque o escopo inclui o sujeito

**Dado** uma chave com mais de 255 caracteres ou fora de ASCII imprimível
**Quando** ela chega
**Então** a resposta é 400

**Dado** um Valkey inacessível
**Quando** chega uma requisição com `Idempotency-Key`
**Então** ela é rejeitada com 503, porque não há como garantir a idempotência
**E** requisições sem a chave não são afetadas

### Story 3.9: `ServiceClient` gerado a partir de `dependencies`

Como **dev de um domínio que precisa chamar outro de forma síncrona**,
quero um cliente tipado gerado a partir do manifest do outro domínio,
para chamar com segurança, com credencial, timeout e retry corretos, sem escrever nada disso à mão (FR-26).

**Critérios de Aceite:**

**Dado** um domínio declarado em `dependencies`
**Quando** o `@tecton/service-client` gera o cliente
**Então** cada action do domínio de destino vira um método tipado com o `input` e o `output` do manifest dele
**E** chamar um domínio que não está em `dependencies` é erro de tipo na compilação e é recusado em execução

**Dado** uma chamada pelo `ServiceClient`
**Quando** ela é enviada
**Então** o endereço vem do `ServiceDiscoveryProvider` e a chamada vai direto ao serviço de destino, sem passar pelo Gateway
**E** ela leva o token de serviço em `Authorization`, obtido, guardado em cache e renovado automaticamente junto ao Auth (Story 2.7)
**E** quando há um usuário no contexto, o token dele vai em `Tecton-On-Behalf-Of`
**E** o `traceparent` é propagado

**Dado** uma chamada sem timeout explícito
**Quando** ela demora mais de 5000 ms
**Então** ela é abortada com erro de timeout (FR-26)
**E** o timeout pode ser configurado por chamada

**Dado** uma falha de rede, timeout ou erro 5xx
**Quando** a action de destino tem `idempotent: true`, ou a chamada leva `Idempotency-Key`
**Então** a chamada é repetida com backoff exponencial até o limite configurado (padrão de 3 tentativas)
**E** a mesma `Idempotency-Key` é usada em todas as tentativas

**Dado** uma mutação sem `idempotent: true` e sem `Idempotency-Key`
**Quando** ela falha
**Então** não há nenhum retry e o erro é propagado direto (FR-26)

**Dado** a pilha de middlewares do cliente (timeout, retry)
**Quando** um middleware novo é adicionado num teste (simulando um circuit breaker)
**Então** ele entra sem mudança no código do `ServiceClient` (FR-26)

**Dado** uma resposta de erro do serviço de destino
**Quando** ela chega
**Então** é entregue ao chamador como erro tipado, com o formato provisório deste épico

### Story 3.10: Publicação de eventos assinados via outbox transacional

Como **dev de um domínio que publica eventos**,
quero que publicar um evento faça parte da mesma transação de banco da mudança que o originou,
para que nunca exista mudança gravada sem o evento correspondente, nem evento publicado sem a mudança (FR-4, FR-21, decisão E1).

**Critérios de Aceite:**

**Dado** `tecton-admin auth register-service <domínio>` (Story 2.7)
**Quando** ele roda
**Então** passa a gerar também um par de chaves Ed25519 do serviço
**E** a chave privada aparece uma única vez na saída, para ser configurada no serviço como secreta (Story 3.1)
**E** a chave pública é publicada no JWKS do Auth, identificada pelo domínio

**Dado** o domínio gerado (Story 3.4)
**Quando** eu inspeciono o schema Prisma dele
**Então** existe a tabela de outbox no banco do próprio domínio, com sequência crescente, evento serializado e situação de publicação

**Dado** um evento declarado em `events.publishes`
**Quando** o domínio é gerado
**Então** existe um método de publicação tipado com o schema do evento, disponível dentro da unidade de trabalho (Unit of Work) que o handler da action recebe

**Dado** um handler que grava dados e publica um evento na mesma unidade de trabalho
**Quando** a transação é confirmada
**Então** os dados e a linha do outbox são gravados juntos numa única transação Prisma
**E** se a transação falhar ou for desfeita, nem os dados nem o evento ficam gravados

**Dado** uma publicação chamada fora de uma unidade de trabalho
**Quando** ela é executada
**Então** é gravada no outbox numa transação própria, nunca enviada direto ao Valkey

**Dado** um evento gravado no outbox
**Quando** a linha é criada
**Então** o envelope já está completo e assinado: CloudEvents 1.0, `id` em UUID v7, `source` identificando o domínio, `type` no formato `com.tecton.<domínio>.<evento>`, `time` em ISO 8601 UTC, `traceparent` na extensão de distributed tracing e assinatura com a chave privada do serviço, cobrindo envelope e dados, num atributo de extensão com nome válido pela especificação do CloudEvents (só letras minúsculas e dígitos, ex.: `tectonsig`)

**Dado** um payload que não segue o schema do evento
**Quando** a publicação é chamada
**Então** ela falha com erro, nada é gravado no outbox e a transação é desfeita

**Dado** um Valkey inacessível
**Quando** a action é executada
**Então** a action e a gravação no outbox concluem normalmente, porque o envio ao Valkey é responsabilidade do relay (Story 3.11)

**Dado** os bancos suportados (PostgreSQL, MariaDB e MySQL)
**Quando** o job de matriz de bancos da Story 1.1 roda
**Então** o comportamento transacional é o mesmo em todos

**Dado** o registro de chaves de assinatura
**Quando** ele é feito
**Então** segue as mesmas regras da Story 2.7: exige administrador, nunca sobrescreve um registro existente sem `--rotate`, e a rotação retira a chave antiga do JWKS

### Story 3.11: Relay do outbox para Valkey Streams

Como **operador de um sistema construído com o Tecton**,
quero que os eventos gravados no outbox cheguem ao stream do domínio em ordem e sem perda,
para que a entrega at-least-once valha desde a gravação no banco até o consumidor (FR-21).

**Critérios de Aceite:**

**Dado** um serviço de domínio em execução
**Quando** ele sobe
**Então** o relay do outbox começa a rodar no próprio processo, sem configuração do dev

**Dado** linhas pendentes no outbox
**Quando** o relay roda
**Então** ele as envia ao stream único do domínio na ordem da sequência e as marca como publicadas (FR-21)

**Dado** várias instâncias do mesmo domínio
**Quando** todas estão rodando
**Então** só uma de cada vez faz o relay, por meio de um lock com tempo de vida no Valkey
**E** se a instância dona do lock cair, outra assume quando o lock expira, mantendo a ordem

**Dado** um processo que cai depois de enviar ao stream e antes de marcar a linha como publicada
**Quando** o relay volta
**Então** o evento é enviado de novo com o mesmo `id`, e a deduplicação do consumidor (Story 3.12) absorve a duplicata

**Dado** um Valkey inacessível
**Quando** o relay tenta enviar
**Então** as linhas continuam pendentes e o relay tenta de novo com backoff, sem perder nada e sem pular a ordem

**Dado** linhas pendentes há mais tempo que um limite configurável
**Quando** o relay detecta isso
**Então** registra um aviso em log e o `/ready` passa a informar o atraso, sem marcar o serviço como indisponível

**Dado** linhas já publicadas há mais tempo que a retenção configurável (padrão de 7 dias)
**Quando** a limpeza roda
**Então** essas linhas são removidas do outbox

### Story 3.12: Consumo de eventos com deduplicação e dead-letter

Como **dev de um domínio que consome eventos de outro**,
quero implementar só o handler do evento,
para que verificação de assinatura, deduplicação, retry e dead-letter sejam feitos pelo framework (FR-21).

**Critérios de Aceite:**

**Dado** um evento declarado em `events.consumes`
**Quando** o domínio é gerado
**Então** existe um handler stub tipado e um consumer group próprio do domínio no stream do publicador

**Dado** um evento recebido
**Quando** o consumidor o processa
**Então** a assinatura é verificada pelo JWKS antes de chamar o handler
**E** a chave que assinou precisa pertencer ao domínio indicado em `source`, para que um serviço não publique em nome de outro

**Dado** um evento sem assinatura, com assinatura inválida ou assinado por chave de outro domínio
**Quando** ele é recebido
**Então** o handler não é chamado, o evento é confirmado (ACK) e um erro de segurança é registrado em log (FR-21)

**Dado** o JWKS inacessível e a chave ainda fora do cache
**Quando** um evento chega
**Então** o evento não é confirmado nem descartado, e é reprocessado depois, porque "não deu para verificar agora" é diferente de "assinatura inválida"

**Dado** um evento já processado com sucesso por este consumidor
**Quando** ele chega de novo
**Então** é confirmado sem chamar o handler, usando o `id` do evento como chave de deduplicação (FR-21)

**Dado** um handler que aplicou o efeito e o processo caiu antes de registrar a chave de deduplicação
**Quando** o evento é reprocessado
**Então** o handler é chamado de novo, porque a chave só é registrada depois do sucesso (FR-21)

**Dado** um handler que falha repetidamente
**Quando** o número configurável de tentativas é atingido (padrão de 5)
**Então** o evento vai para o stream de dead-letter do consumidor e as mensagens seguintes continuam sendo entregues (FR-21)
**E** um payload que não segue o schema vai direto para a dead-letter

**Dado** eventos do mesmo stream
**Quando** são consumidos
**Então** a ordem de entrega é preservada dentro do stream, sem garantia entre streams diferentes (FR-21)
**E** o `traceparent` do evento continua o trace no consumidor

**Dado** a verificação de assinatura de eventos
**Quando** o consumidor busca o JWKS
**Então** valem as mesmas regras de transporte da Story 2.4: `https` fora do modo de desenvolvimento e nenhum redirecionamento para outro host

### Story 3.13: `tecton-admin dev`

Como **dev no dia a dia**,
quero subir o sistema inteiro com um comando e ver minhas mudanças sem reiniciar nada à mão,
para desenvolver com ciclo curto de feedback (FR-15).

**Critérios de Aceite:**

**Dado** o Dev Services parado
**Quando** eu rodo `tecton-admin dev`
**Então** ele sobe o `docker-compose.dev.yml` e espera banco e Valkey ficarem prontos (FR-15, FR-30)

**Dado** migrations pendentes
**Quando** o `dev` inicia
**Então** elas são aplicadas em cada serviço e registradas na saída (o comando `tecton-admin migrate` do Epic 6 expõe a mesma mecânica de forma avulsa)

**Dado** o workspace
**Quando** o `dev` termina de subir
**Então** Gateway, Auth e todos os domínios estão rodando via `turbo run dev`, com `tsx watch`
**E** a saída mostra, em inglês, o endereço do Gateway
**E** o Directory e a SPA `/admin` entram nessa lista quando existirem (Story 4.7)

**Dado** uma alteração num arquivo de um domínio
**Quando** eu salvo
**Então** só aquele serviço reinicia

**Dado** um serviço que falha ao subir (ex.: configuração inválida)
**Quando** isso acontece
**Então** a saída indica o serviço e o erro, e os outros continuam rodando

**Dado** um workspace sem nenhuma credencial
**Quando** o `dev` sobe
**Então** a saída sugere rodar `tecton-admin auth bootstrap`

**Dado** o modo de desenvolvimento
**Quando** o `dev` sobe ou um domínio novo é gerado
**Então** a credencial de serviço e o par de chaves de assinatura de cada domínio são registrados no Auth automaticamente e gravados no `.env` local do domínio, ignorado pelo Git (Story 3.1)
**E** a verificação de token continua ligada em todos os serviços, sem exceção para desenvolvimento (AD-7)
**E** esse registro automático só existe no `tecton-admin dev`, nunca em build de produção
**E** o endpoint de registro automático só existe quando o Auth sobe com o modo de desenvolvimento ligado de forma explícita na configuração, e nesse modo o startup do Auth registra um aviso; fora dele, o endpoint não existe

**Dado** `Ctrl+C`
**Quando** eu interrompo
**Então** todos os serviços param de forma limpa e o Dev Services continua rodando

> **Nota:** movida do Epic 6 no pre-mortem de 2026-10-05, para eliminar o atrito de subir serviços e copiar credenciais à mão nos Epics 3 a 5.

## Epic 4: Core de Diretório e Domínios Embutidos

Marina administra a estrutura do Tenant: o Directory Service pronto (`@tecton/directory`) guarda Tenant, Usuário e Grupo numa árvore com Closure Table e ACL por herança aditiva, publica eventos para os outros domínios e serve a SPA `/admin` (construída sobre `@tecton/ui`), onde ela navega a árvore, busca objetos e edita atributos por formulário gerado. Vem depois da Interoperabilidade (Epic 3), da qual depende: Gateway, `ServiceClient` e eventos.

**Mensagens de erro na SPA:** o Epic 5 (RFC 9457 com `title`/`detail` traduzidos) vem depois deste. Até lá, a SPA traduz os erros pelo próprio catálogo de i18n a partir do status HTTP do formato provisório; o Epic 5 troca a fonte para `title`/`detail` sem mudar as telas.

### Story 4.1: Serviço `@tecton/directory` com Closure Table

Como **dev de um sistema construído com o Tecton**,
quero um Directory Service pronto que guarde objetos numa hierarquia com Closure Table,
para ter uma árvore de objetos com containment validado, portável entre os bancos suportados.

**Critérios de Aceite:**

**Dado** um workspace novo
**Quando** eu rodo `tecton-admin new`
**Então** é gerado `apps/directory` como instância configurada de `@tecton/directory`, com dependência versionada (AD-2, AD-4)
**E** o Gateway passa a encaminhar o prefixo `/directory/` para ele

**Dado** o schema Prisma do Directory
**Quando** eu o inspeciono
**Então** existe uma tabela de objetos (ID em UUID v7, `objectClass`, nome em coluna própria para busca, atributos como bag JSON) e uma tabela de closure (ancestral, descendente, profundidade)
**E** a bag de atributos é JSONB no PostgreSQL e JSON no MariaDB e no MySQL (no MariaDB, `JSON` é armazenado como texto com checagem de validade; a validação contra o schema continua sendo da aplicação, AD-2)

**Dado** a criação de um objeto sob um pai
**Quando** a classe do pai não está em `allowedParents` do filho, ou a classe do filho não está em `allowedChildren` do pai
**Então** a criação é rejeitada e nada é gravado

**Dado** atributos de um objeto
**Quando** ele é criado ou alterado
**Então** os atributos são validados contra o JSON Schema compilado do `objectClass` (Story 1.5) antes de gravar (AD-2)
**E** atributos marcados com `x-tecton-unique` têm a unicidade verificada pela aplicação

**Dado** a action de mover um objeto (só no backend; a UI do MVP não move nada)
**Quando** ela é executada
**Então** só as linhas de closure da subárvore movida são alteradas, sem renumerar a árvore inteira (FR-6)
**E** mover um objeto para dentro de um descendente dele é rejeitado antes de qualquer alteração (FR-6)
**E** mover para um pai que viola `allowedParents` é rejeitado

**Dado** os testes de persistência do Directory
**Quando** rodam no job de matriz de bancos da Story 1.1, contra PostgreSQL, MariaDB e MySQL
**Então** passam em todos sem mudança de schema nem de código de domínio (FR-6, NFR-4)

**Dado** os manifests dos `objectClass` embutidos
**Quando** o pacote `@tecton/directory` é instalado
**Então** eles ficam disponíveis para o `tecton-admin lint` resolver referências como `Root`, `User` e `Group` (Story 1.6)

**Dado** um atributo `readOnly` no `objectClass`
**Quando** a action genérica de edição de atributos tenta alterá-lo
**Então** a alteração é rejeitada; só actions específicas mudam atributos `readOnly`
**E** nos `objectClass` embutidos, `status` (Tenant e usuário) nasce `readOnly`

### Story 4.2: Domínio Tenant

Como **operador de uma plataforma multi-tenant**,
quero criar Tenants e controlar o status de cada um,
para isolar os dados de cada cliente e suspender ou arquivar um cliente sem apagar nada (FR-9).

**Critérios de Aceite:**

**Dado** um usuário com `tenant:create`
**Quando** ele chama `createTenant`
**Então** é criado um Tenant como raiz de uma árvore própria, com status `active`

**Dado** a permissão `tenant:create`
**Quando** alguém tenta concedê-la
**Então** ela só pode ser concedida na raiz da plataforma (`Root`), nunca dentro de um Tenant
**E** um administrador de Tenant nunca recebe permissão em `Root`

**Dado** qualquer objeto do Directory
**Quando** ele é criado
**Então** pertence, direta ou indiretamente, a um Tenant (FR-9)
**E** não existe caminho para criar objeto fora de um Tenant

**Dado** um usuário autenticado de um Tenant
**Quando** ele tenta ler ou alterar um objeto de outro Tenant
**Então** a resposta é 404, para não revelar que o objeto existe

**Dado** um Tenant `suspended`
**Quando** alguém executa uma action que altera dados num objeto descendente
**Então** a action é rejeitada com erro que indica o status do Tenant
**E** as leituras continuam disponíveis (FR-9)

**Dado** um Tenant `archived`
**Quando** alguém executa qualquer action num objeto descendente
**Então** a action é rejeitada, exceto leitura e `exportTenantData` (FR-9)

**Dado** `exportTenantData`, marcada `sensitive.quorum` no manifest do Tenant
**Quando** ela é executada sem `KeyCustodyProvider`
**Então** gera a exportação em JSON de todos os objetos do Tenant e registra o aviso da Story 2.8

### Story 4.3: Usuários, Grupos e vínculo com o Auth

Como **administrador de um Tenant**,
quero criar usuários e grupos, organizar a estrutura de equipes e associar usuários a grupos,
para representar a organização na árvore e dar a cada usuário uma credencial de acesso (FR-10).

**Critérios de Aceite:**

**Dado** os `objectClass` `User` e `Group`
**Quando** eu os uso
**Então** `Group` pode ficar dentro de um Tenant ou de outro `Group`, e `User` dentro de um Tenant ou de um `Group`, para representar departamento e equipe como containment (FR-10)

**Dado** um usuário e um grupo do mesmo Tenant
**Quando** eu chamo `addMember` ou `removeMember`
**Então** a associação usuário-grupo é gravada à parte do containment, permitindo que um usuário pertença a vários grupos

**Dado** um usuário e um papel
**Quando** eu atribuo o papel ao usuário ou a um grupo sobre um objeto
**Então** a atribuição fica gravada para o cálculo de ACL da Story 4.4

**Dado** `createUser` com uma senha inicial
**Quando** ele é executado
**Então** o Directory cria o objeto `User` e pede ao Auth, pelo `ServiceClient` com token de serviço, a criação da credencial com o mesmo ID de sujeito (FR-10)
**E** para isso o manifest do Directory declara `auth` em `dependencies`, e o Auth ganha a action `create-credential` no próprio manifest
**E** a senha inicial só trafega até o Auth e nunca é gravada nem registrada em log pelo Directory

**Dado** uma falha em qualquer etapa da criação (Auth inacessível, erro ao gravar no Directory)
**Quando** ela acontece
**Então** não sobra usuário sem credencial nem credencial sem usuário, com compensação explícita quando a credencial já tiver sido criada

**Dado** a criação de credencial no Auth
**Quando** ela é chamada por qualquer chamador que não seja `service:directory`
**Então** é recusada

**Dado** um usuário desativado
**Quando** a desativação é concluída
**Então** a credencial dele no Auth é desativada e os tokens dele são revogados (Story 2.5)

**Dado** `tecton-admin auth bootstrap` (Story 2.2)
**Quando** ele roda depois desta story
**Então** cria também o Tenant inicial e o usuário administrador correspondente no Directory
**E** esse administrador é operador da plataforma (permissões em `Root`, incluindo `tenant:create`) e administrador do Tenant inicial

**Dado** um ambiente novo
**Quando** eu sigo a documentação de primeira subida
**Então** a ordem é explícita: Dev Services, Auth, registro das credenciais de serviço do Directory, Directory e por fim `auth bootstrap`
**E** o `auth bootstrap` falha com mensagem clara se o Directory ou a credencial de serviço dele não estiverem prontos

> **Nota de tamanho (pre-mortem de 2026-10-05):** story grande para uma única sessão de agente; candidata a divisão no `bmad-create-story`.

### Story 4.4: ACL por herança aditiva e `perms` do token

Como **administrador de um Tenant**,
quero dar permissão num container e vê-la valer para tudo que está dentro dele,
para gerenciar acesso por estrutura, sem configurar objeto por objeto (FR-7).

**Critérios de Aceite:**

**Dado** uma permissão concedida a um usuário ou grupo num objeto
**Quando** ela é gravada
**Então** é guardada como relação no formato sujeito, relação e objeto, compatível com um motor externo como o OpenFGA, sem precisar migrar dados para adotá-lo (FR-7)

**Dado** um objeto
**Quando** eu consulto as permissões efetivas de um usuário sobre ele
**Então** o resultado é a soma das concessões no próprio objeto e em todos os ancestrais, diretas ou pelos grupos do usuário
**E** a consulta nunca procura bloqueio ou exceção, porque o schema não tem como representar isso (FR-7)

**Dado** a listagem de objetos da árvore
**Quando** um usuário a consulta
**Então** só voltam os objetos em que ele tem permissão de leitura; os outros não aparecem de forma alguma (UX-DR6)
**E** um objeto legível cujo pai não é legível aparece como nó de topo da árvore desse usuário

**Dado** a alteração de atributos de um objeto
**Quando** o usuário não tem permissão de escrita nele (direta ou herdada)
**Então** a alteração é rejeitada

**Dado** um login ou refresh no Auth
**Quando** o access token é emitido
**Então** o Auth, que declara `directory` em `dependencies` no próprio manifest, consulta o Directory pelo `ServiceClient` e preenche `perms` com as permissões que o usuário tem sobre a raiz do Tenant (decisão de 2026-10-02)
**E** as permissões sobre objetos específicos continuam sendo verificadas pelo Directory a cada action

**Dado** um Directory inacessível durante o login ou o refresh
**Quando** o Auth tenta consultar
**Então** o login ou o refresh falha (fail-closed), nunca emite token com `perms` vazio ou antigo
**E** o `/ready` do Auth passa a indicar que o Directory está indisponível

**Dado** a documentação de operação
**Quando** eu a consulto
**Então** ela registra que o Directory é ponto único de falha do login, como consequência aceita da decisão de 2026-10-02
**E** não existe conta de emergência nem caminho de login que pule a verificação de token ou a consulta ao Directory (AD-7)

**Dado** a remoção de uma permissão
**Quando** ela é gravada
**Então** os tokens dos usuários afetados são revogados (Story 2.5), para que a perda de acesso valha imediatamente
**E** a concessão de uma permissão nova vale a partir do próximo login ou refresh

### Story 4.5: Eventos publicados pelo Directory

Como **dev de um domínio de negócio que precisa de dados do Directory**,
quero consumir eventos publicados pelo Directory,
para manter um modelo de leitura local sem nunca acessar o banco dele (AD-2, AD-9).

**Critérios de Aceite:**

**Dado** o manifest do Directory
**Quando** eu o inspeciono
**Então** ele declara em `events.publishes` pelo menos `TenantCreated`, `TenantStatusChanged`, `UserCreated`, `UserDeactivated`, `GroupCreated` e `MembershipChanged`

**Dado** uma action do Directory que gera um desses eventos
**Quando** ela é executada
**Então** o evento é gravado no outbox na mesma transação da mudança (Story 3.10)

**Dado** o payload de qualquer evento do Directory
**Quando** eu o inspeciono
**Então** ele nunca contém senha, hash ou dado de credencial

**Dado** um domínio de teste que declara `consumes` de `directory.UserCreated`
**Quando** um usuário é criado
**Então** o handler do domínio recebe o evento pela Story 3.12 e grava o próprio modelo de leitura, sem nenhum acesso ao banco do Directory

**Dado** o build do Directory
**Quando** o AsyncAPI é gerado (Story 1.8)
**Então** ele documenta todos os eventos publicados pelo Directory

### Story 4.6: `@tecton/ui`: tema padrão, porta `UiThemeProvider` e catálogo de i18n

Como **dev que vai construir telas sobre o Tecton**,
quero um runtime de UI com tema padrão substituível por tokens, slots de componente trocáveis e catálogo de i18n único,
para personalizar a identidade visual sem escrever componente e sem colisão de mensagens entre domínios (AD-10).

**Critérios de Aceite:**

**Dado** o `@tecton/ui`
**Quando** eu inspeciono o tema padrão (Camada 0)
**Então** paleta, tipografia, `rounded` e espaçamento do `DESIGN.md` existem como CSS custom properties com nomes públicos e estáveis (UX-DR1)
**E** os templates e widgets do `@rjsf/core` usam esses tokens, de modo que trocar a identidade visual exige só sobrescrever tokens

**Dado** a porta `UiThemeProvider`
**Quando** eu substituo um dos slots `ObjectTreeView`, `AttributeForm` ou `ScreenLayout`
**Então** só aquele slot muda e os outros continuam no padrão (UX-DR2)
**E** o `Core` resolve os três slots e os entrega já montados ao `ScreenLayout`; um `ScreenLayout` customizado só posiciona o que recebe e nunca resolve outro slot por conta própria

**Dado** uma aplicação que tenta criar um segundo `Core` do `@tecton/ui`
**Quando** isso acontece
**Então** é lançado um erro, porque o runtime é instância única (AD-10)

**Dado** o catálogo de i18n
**Quando** a aplicação inicia
**Então** PT-BR é o idioma padrão e EN o secundário, escolhido pelo idioma do navegador (AD-6)
**E** toda chave segue o formato `<domínio>.<chave>`; uma chave sem namespace ou uma chave repetida entre catálogos gera erro na consolidação (AD-10)

**Dado** os componentes padrão
**Quando** eu verifico o texto exibido ao usuário
**Então** todo texto vem do catálogo, nunca de string literal no componente (UX-DR12)

**Dado** o pacote `@tecton/ui`
**Quando** eu verifico as dependências
**Então** ele não importa `@tecton/directory` (AD-3, AD-10)

**Dado** os itens deixados em aberto pela spine (ferramenta de build da SPA e versão exata do React com o `@rjsf/core` 6.x)
**Quando** a story é concluída
**Então** a escolha e o motivo ficam registrados no README do pacote

### Story 4.7: Shell da SPA `/admin` e tela de login

Como **Marina, administradora de um Tenant**,
quero entrar no `/admin` com meu login e ver o console de dois painéis,
para começar a administrar a estrutura do meu Tenant.

**Critérios de Aceite:**

**Dado** o `@tecton/directory`
**Quando** ele sobe
**Então** serve os arquivos estáticos da SPA em `/admin`, e o Gateway encaminha `/admin` para ele (AD-10)
**E** toda chamada de API da SPA vai para o Gateway, nunca direto ao endereço interno do Directory

**Dado** a tela de login
**Quando** eu informo identificador e senha válidos
**Então** a SPA chama `/auth/login` pelo Gateway e me leva ao console
**E** o access token fica só em memória, nunca em `localStorage` nem `sessionStorage`

**Dado** credenciais inválidas
**Quando** eu tento entrar
**Então** vejo uma mensagem única do catálogo, sem dizer se o erro foi no login ou na senha
**E** com o login bloqueado (Story 2.6), vejo quanto tempo falta para tentar de novo

**Dado** um access token perto de expirar, ou uma resposta 401
**Quando** isso acontece durante o uso
**Então** a SPA chama `/auth/refresh` uma vez e repete a requisição
**E** se o refresh falhar, volto para o login com a mensagem de sessão expirada

**Dado** o console aberto
**Quando** eu o vejo pela primeira vez
**Então** o layout tem a árvore à esquerda e o painel de detalhe à direita, com o texto "Selecione um objeto na árvore à esquerda." (UX-DR3)
**E** só aparecem objetos do meu Tenant

**Dado** a ação de sair
**Quando** eu a uso
**Então** a SPA chama `/auth/logout`, descarta o token da memória e volta para o login

**Dado** `tecton-admin dev` (Story 3.13)
**Quando** ele sobe depois desta story
**Então** o Directory e a SPA `/admin` sobem junto, e o endereço do `/admin` aparece na saída

**Dado** qualquer resposta do `/admin`
**Quando** ela é enviada
**Então** traz Content-Security-Policy restritiva (sem script inline e sem `eval`), `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` e `Referrer-Policy: no-referrer`
**E** o `/admin` não pode ser carregado dentro de iframe de outra origem

### Story 4.8: Árvore de objetos navegável e acessível

Como **Marina**,
quero navegar a árvore do meu Tenant com mouse ou só com o teclado,
para ver a estrutura de equipes e chegar ao objeto que preciso (UX-DR4).

**Critérios de Aceite:**

**Dado** a árvore carregada
**Quando** eu expando um nó pelo chevron ou com duplo clique
**Então** os filhos são carregados sob demanda e exibidos com indentação
**E** um clique simples seleciona o nó e carrega o painel de detalhe

**Dado** os nós exibidos
**Quando** eu os vejo
**Então** cada `objectClass` (Tenant, Grupo, Usuário) tem um ícone visualmente distinto

**Dado** o foco na árvore
**Quando** eu uso `↑`/`↓`, `→`/`←` e `Enter`
**Então** o foco se move entre os nós visíveis, os nós expandem e colapsam, e `Enter` seleciona (UX-DR4)
**E** a ordem de `Tab` é busca, árvore, painel de detalhe e ações

**Dado** um leitor de tela
**Quando** ele lê um nó
**Então** o nó tem papel `treeitem` dentro de um `tree`, com `aria-expanded`, `aria-level`, `aria-selected`, `aria-posinset` e `aria-setsize` corretos, de modo que o leitor anuncia a posição ("item 3 de 12") (UX-DR4)

**Dado** objetos sem permissão de leitura
**Quando** a árvore é exibida
**Então** eles não aparecem de forma alguma, nem como nó cinza ou bloqueado (UX-DR6)

**Dado** qualquer nó
**Quando** eu passo o mouse ou o seleciono
**Então** não há nenhum sinal de arrastar: nem cursor de arraste, nem área de soltar, nem atributo `draggable`

**Dado** qualquer elemento interativo da árvore
**Quando** ele recebe foco
**Então** exibe o anel de foco na cor `primary` (UX-DR11)

### Story 4.9: Busca na árvore

Como **Marina, com uma árvore de centenas de usuários importados**,
quero achar um objeto pelo nome sem abrir grupo por grupo,
para ver onde ele está na hierarquia sem esforço manual (UX-DR5).

**Critérios de Aceite:**

**Dado** o campo de busca no topo do painel da árvore
**Quando** eu digito
**Então** a busca é feita no servidor depois de cerca de 250 ms sem digitar, incluindo objetos que ainda não foram carregados na árvore

**Dado** resultados encontrados
**Quando** a busca termina
**Então** a árvore passa a mostrar só os objetos encontrados e os ancestrais deles, já expandidos
**E** o primeiro resultado recebe rolagem, destaque e foco
**E** o número de resultados é anunciado por uma região `aria-live`

**Dado** nenhum resultado
**Quando** a busca termina
**Então** aparece "Nenhum objeto encontrado para '{termo}'." (UX-DR5)

**Dado** a busca limpa
**Quando** o campo fica vazio
**Então** a árvore volta ao estado de antes da busca

**Dado** objetos sem permissão de leitura que combinam com o termo
**Quando** a busca roda
**Então** eles nunca aparecem nos resultados nem na contagem (UX-DR6)

### Story 4.10: Menu de contexto e painel de detalhe

Como **Marina**,
quero ver os atributos de um objeto e ter as ações dele a um clique direito,
para consultar e partir para a edição sem procurar botões (UX-DR7, UX-DR8).

**Critérios de Aceite:**

**Dado** um nó da árvore
**Quando** eu clico com o botão direito ou uso a tecla de menu de contexto (ou `Shift+F10`)
**Então** abre um menu só com "Ver detalhes" e "Editar atributos" (UX-DR7)
**E** sem permissão de escrita no objeto, "Editar atributos" não aparece, nem esmaecido
**E** nenhum item sugere mover ou arrastar

**Dado** o menu aberto
**Quando** ele aparece
**Então** o foco vai para o primeiro item, as setas navegam entre os itens e `Esc` fecha o menu e devolve o foco ao nó de origem (UX-DR11)

**Dado** um objeto selecionado
**Quando** o painel de detalhe carrega
**Então** mostra os atributos em pares rótulo e valor, somente leitura, com rótulos vindos do catálogo de i18n (UX-DR8)

**Dado** permissão de escrita no objeto, informada pelo backend de acordo com o ACL (Story 4.4)
**Quando** o painel é exibido
**Então** o botão "Editar atributos" aparece
**E** sem essa permissão, o botão não aparece, nem desabilitado com explicação (UX-DR10)

**Dado** um valor de atributo com HTML ou script
**Quando** ele é exibido no painel de detalhe, na árvore ou na busca
**Então** é renderizado como texto, nunca interpretado como HTML

### Story 4.11: Formulário de edição de atributos gerado

Como **Marina**,
quero editar os atributos de um objeto num formulário que reflete o `objectClass`,
para corrigir dados sem que alguém precise escrever tela para cada atributo (FR-8, UX-DR9).

**Critérios de Aceite:**

**Dado** "Editar atributos"
**Quando** eu clico
**Então** o painel vira um formulário gerado pelo `@rjsf/core` a partir do JSON Schema do `objectClass` (Story 1.5), sem nenhum campo escrito à mão (FR-8)

**Dado** um atributo novo adicionado ao `objectClass` no manifest
**Quando** o Directory é atualizado
**Então** o campo aparece no formulário sem mudança de código de UI (FR-8)

**Dado** os rótulos e as mensagens de validação
**Quando** o formulário é exibido em PT-BR ou EN
**Então** todos vêm do catálogo de i18n (FR-8)

**Dado** um valor inválido
**Quando** eu tento salvar
**Então** o erro aparece abaixo do campo, o foco vai para o primeiro campo com erro e o erro é anunciado por `aria-live` (UX-DR9)
**E** cada campo tem `label` associado

**Dado** um salvamento bem-sucedido
**Quando** a resposta chega
**Então** o painel volta ao modo de visualização com o novo valor, sem recarregar a página, e aparece "Salvo."

**Dado** uma falha de servidor ou de rede ao salvar
**Quando** ela acontece
**Então** a mensagem aparece acima do formulário e tudo o que eu digitei é mantido (UX-DR10)

**Dado** "Cancelar" ou `Esc`
**Quando** eu uso
**Então** a edição é descartada sem pedido de confirmação e o painel volta ao modo de visualização

**Dado** um atributo `readOnly`
**Quando** o formulário é gerado
**Então** o campo aparece só para leitura e nunca é enviado na gravação

### Story 4.12: Estados da interface e acessibilidade da superfície

Como **Marina**,
quero que o console sempre explique o que está acontecendo, carregando, vazio ou com erro, e funcione por inteiro só com teclado,
para nunca ficar diante de uma tela em branco ou de um caminho sem saída (UX-DR10, UX-DR11, UX-DR12).

**Critérios de Aceite:**

**Dado** a primeira carga da árvore
**Quando** os dados ainda não chegaram
**Então** aparece um esqueleto de linhas no formato de árvore, não um spinner genérico
**E** ao trocar de objeto, o painel de detalhe mostra um esqueleto de 3 ou 4 linhas no formato rótulo e valor

**Dado** um Tenant sem objetos além da raiz
**Quando** a árvore carrega
**Então** aparece "Nenhum objeto neste Tenant ainda.", sem ação

**Dado** uma falha ao carregar a árvore ou o detalhe
**Quando** ela acontece
**Então** aparece a mensagem de erro traduzida e o botão "Tentar novamente", que refaz a carga
**E** nunca fica tela em branco sem explicação

**Dado** todas as telas e estados do console
**Quando** a verificação automatizada de acessibilidade roda
**Então** não há nenhuma violação de WCAG 2.2 AA (UX-DR11)

**Dado** os fluxos 1 e 2 do `EXPERIENCE.md` (editar o grupo de um colaborador e buscar numa árvore grande)
**Quando** eu os percorro só com teclado
**Então** consigo concluir os dois sem mouse

**Dado** toda mensagem exibida ao usuário
**Quando** eu a reviso
**Então** não tem emoji nem exclamação e nunca mostra erro técnico cru, como status HTTP ou stack trace (UX-DR12)

## Epic 5: Formato de API e Evolução de Contrato

Toda action de todo domínio responde em formato consistente: sucesso como payload puro, erro como RFC 9457 multi-idioma com `type` em URN, pendência como `202 Accepted` com ciclo de aprovação completo. O `test:contracts` garante que a evolução do manifest seja aditiva e nunca quebre um consumidor existente. Substitui o formato de erro provisório dos Epics 2, 3 e 4, enriquecendo em vez de recriar.

### Story 5.1: Sucesso como payload puro

Como **dev ou agente de IA que consome uma action**,
quero que a resposta de sucesso seja exatamente o `output` declarado no manifest,
para não precisar desembrulhar envelope nem lidar com campos que o contrato não promete (FR-23).

**Critérios de Aceite:**

**Dado** uma action executada com sucesso
**Quando** a resposta é enviada
**Então** o corpo é só o `output` declarado, sem campo de metadado como `requestId` ou `meta` (FR-23)
**E** campos que o handler devolveu e que não estão no `output` são removidos pela serialização do schema, nunca vazam

**Dado** qualquer resposta
**Quando** ela é enviada
**Então** carrega o header `traceparent` do trace da requisição, para correlação (FR-23)

### Story 5.2: Erro RFC 9457 com i18n em todo o framework

Como **cliente de um sistema construído com o Tecton**,
quero que todo erro venha num formato único, com mensagem no meu idioma e identificador estável para máquina,
para tratar falhas sem decifrar formatos diferentes por serviço (FR-24, AD-6).

**Critérios de Aceite:**

**Dado** qualquer erro gerado pelo framework (401, 403, 404, 409, 422, 429, 500, 503 e erros de status do Tenant)
**Quando** a resposta é enviada
**Então** ela usa `Content-Type: application/problem+json` com `type`, `title`, `status`, `detail` e `instance` (FR-24)
**E** o `type` é uma URN estável no formato `urn:tecton:problem:<slug>`, igual em qualquer idioma
**E** a resposta traz a extensão `i18nKey` com a chave do catálogo usada

**Dado** uma requisição com `Accept-Language: en`
**Quando** um erro do framework acontece
**Então** `title` e `detail` vêm em inglês

**Dado** uma requisição sem `Accept-Language` ou com idioma não suportado
**Quando** um erro do framework acontece
**Então** `title` e `detail` vêm em Português do Brasil, nunca falham por falta de idioma (FR-24)

**Dado** um erro interno (500)
**Quando** a resposta é enviada
**Então** ela nunca contém stack trace, mensagem de exceção ou nome de tabela
**E** o detalhe técnico vai só para o log interno, ligado pelo `trace_id`

**Dado** os pontos que usavam o formato provisório (Gateway, verificação de token, rate limiting, `Idempotency-Key`, `ServiceClient` e Directory, nos Epics 2, 3 e 4)
**Quando** esta story é concluída
**Então** todos passam a responder no formato RFC 9457 e o formato provisório deixa de existir
**E** a troca é feita só no serializador da abstração única de erro (Story 1.7), sem alterar o código desses pontos

**Dado** a SPA `/admin` (Epic 4)
**Quando** recebe um erro
**Então** passa a exibir `title` e `detail` da resposta, em vez de traduzir pelo status HTTP
**E** nenhuma tela precisa mudar de layout

**Dado** o `ServiceClient` (Story 3.9)
**Quando** recebe um erro RFC 9457
**Então** entrega ao chamador um erro tipado com `type`, `status` e `i18nKey`

### Story 5.3: `invalid-params` em erro de validação de entrada

Como **cliente que enviou dados inválidos**,
quero saber exatamente quais campos estão errados e por quê,
para corrigir de uma vez, sem tentativa e erro (FR-24).

**Critérios de Aceite:**

**Dado** uma requisição cujo corpo não segue o `input` da action
**Quando** a validação falha
**Então** a resposta é 422 em RFC 9457 com a extensão `invalid-params`, listando cada campo inválido com o caminho (JSON Pointer) e o motivo (FR-24)
**E** o motivo de cada campo vem traduzido conforme o `Accept-Language`

**Dado** um corpo com vários campos inválidos
**Quando** ele é validado
**Então** todos aparecem em `invalid-params` de uma vez

**Dado** erros de autorização, de recurso não encontrado ou internos
**Quando** são respondidos
**Então** não têm `invalid-params`, que é exclusivo de erro de validação de entrada (FR-24)

**Dado** o formulário de atributos da SPA (Story 4.11)
**Quando** o servidor rejeita um valor
**Então** cada item de `invalid-params` aparece como erro abaixo do campo correspondente

### Story 5.4: Erros de domínio de terceiros

Como **dev de um domínio de negócio**,
quero lançar erros do meu domínio no mesmo formato do framework, traduzidos se eu quiser,
para que meus clientes tratem meus erros como os do framework, sem eu ser obrigado a traduzir nada (FR-24).

**Critérios de Aceite:**

**Dado** a API de erro de domínio do `@tecton/core`
**Quando** um handler lança um erro com `slug`, status e mensagem
**Então** a resposta sai em RFC 9457 com `type` `urn:tecton:problem:<domínio>.<slug>`

**Dado** um domínio sem catálogo de i18n
**Quando** ele lança um erro
**Então** `title` e `detail` usam a mensagem escrita pelo dev, sem falhar e sem exigir tradução (FR-24)

**Dado** um domínio que fornece catálogo próprio com chaves `<domínio>.<chave>`
**Quando** ele lança um erro com `i18nKey`
**Então** `title` e `detail` vêm traduzidos conforme o `Accept-Language`, com a mesma negociação dos erros do framework

**Dado** um catálogo de domínio com chave fora do namespace do próprio domínio
**Quando** o serviço sobe
**Então** o startup falha com mensagem que indica a chave (AD-10)

**Dado** um handler que lança uma exceção comum, que não é erro de domínio
**Quando** ela acontece
**Então** é tratada como erro interno (500), sem vazar a mensagem da exceção

### Story 5.5: Ciclo de vida da pendência `202 Accepted`

Como **cliente de uma action que exige aprovação**,
quero receber um `202` com um endereço para acompanhar o pedido,
para distinguir "está pendente" de "falhou" sem inspecionar o corpo (FR-25).

**Critérios de Aceite:**

**Dado** uma action com `approval.required: true`, ou `sensitive.quorum` com `KeyCustodyProvider` configurado
**Quando** ela é chamada
**Então** a action não executa; a resposta é `202 Accepted` com `{ status: "pending_approval", requestId, pollUrl }`, nunca em formato de erro (FR-25)
**E** o pedido fica gravado no banco do próprio domínio, com a entrada, quem pediu e a validade

**Dado** uma action `sensitive.quorum` sem `KeyCustodyProvider`
**Quando** ela é chamada
**Então** executa normalmente, conforme a Story 2.8, sem passar por este fluxo (FR-11)

**Dado** um pedido ainda pendente
**Quando** eu consulto `GET /<domínio>/pending/<requestId>`
**Então** recebo o mesmo corpo `202` com `pending_approval` (FR-25)

**Dado** um pedido pendente além do prazo configurável (com valor padrão)
**Quando** eu o consulto
**Então** recebo RFC 9457 indicando expiração (FR-25)

**Dado** um `requestId` desconhecido
**Quando** eu o consulto
**Então** recebo 404 em RFC 9457 (FR-25)

**Dado** um usuário que não é quem pediu nem um aprovador possível
**Quando** ele consulta o pedido
**Então** recebe 404, para não revelar que o pedido existe

> **Nota:** com `sensitive.quorum`, a parte coberta aqui é só a pendência. A decisão de quórum depende da implementação real do `KeyCustodyProvider`, que é roadmap; os testes usam um provider falso.

### Story 5.6: Decisão de `approval`: aprovar ou rejeitar

Como **gestor responsável por aprovar pedidos da minha equipe**,
quero aprovar ou rejeitar um pedido pendente,
para que a action só execute com a minha decisão e quem pediu saiba o resultado (FR-25, FR-3).

**Critérios de Aceite:**

**Dado** um pedido pendente
**Quando** um usuário tenta aprová-lo ou rejeitá-lo
**Então** o framework verifica no Directory, no momento da decisão, se ele cumpre `approval.approver` (papel e escopo, ex.: `role: manager` com `scope: reportingChain` resolvido pelo containment)
**E** quem não cumpre recebe 403, e o pedido continua pendente

**Dado** quem pediu
**Quando** tenta aprovar o próprio pedido
**Então** recebe 403

**Dado** uma aprovação válida
**Quando** ela é registrada
**Então** as permissões atuais de quem pediu são conferidas de novo e a action executa com a entrada original
**E** o evento de `approval.onApprove.emit` é gravado no outbox na mesma transação (Story 3.10)
**E** o `pollUrl` passa a devolver o payload de sucesso, como se a action tivesse executado na hora (FR-25)

**Dado** quem pediu e perdeu a permissão enquanto o pedido esperava
**Quando** a aprovação é registrada
**Então** a action não executa e o `pollUrl` passa a devolver 403 em RFC 9457

**Dado** uma rejeição
**Quando** ela é registrada
**Então** o evento de `approval.onReject.emit` é gravado no outbox
**E** o `pollUrl` passa a devolver RFC 9457 com `type` de rejeição, nunca fica pendente para sempre (FR-25)

**Dado** um pedido já decidido ou expirado
**Quando** alguém tenta decidir de novo
**Então** a resposta é 409 em RFC 9457 e nada muda

> **Nota de tamanho (pre-mortem de 2026-10-05):** story grande para uma única sessão de agente; candidata a divisão no `bmad-create-story`.

### Story 5.7: `tecton-admin test:contracts`

Como **dev que altera o contrato de um domínio**,
quero um comando que teste os dois lados de cada contrato,
para descobrir antes do deploy que quebrei um consumidor (FR-18).

**Critérios de Aceite:**

**Dado** um `ServiceClient` gerado (Story 3.9)
**Quando** ele é gerado
**Então** um snapshot do contrato usado (as actions do provedor com `input` e `output`) fica gravado no domínio consumidor

**Dado** um workspace com provedores e consumidores
**Quando** eu rodo `tecton-admin test:contracts`
**Então** cada snapshot de consumidor é comparado com o manifest atual do provedor, resolvido como na Story 1.6
**E** cada `events.consumes` é comparado com o schema do evento em `publishes` do domínio de origem

**Dado** um `output` alterado no provedor sem atualizar o consumidor
**Quando** o comando roda
**Então** ele falha e indica provedor, action, consumidor e campo (FR-18)

**Dado** o resultado
**Quando** o comando termina
**Então** sai com código 0 sem quebra e diferente de 0 com quebra
**E** aceita `--format json` para consumo por agente de IA, como o lint

> **Nota:** o isolamento com Testcontainers no CI é do Epic 6 (FR-31).

### Story 5.8: Evolução aditiva de contrato verificada

Como **dev que evolui um contrato**,
quero que só mudanças aditivas passem,
para nunca quebrar um consumidor existente por acidente (FR-29, NFR-7).

**Critérios de Aceite:**

**Dado** um campo opcional novo em `input` ou `output` de uma action, ou no schema de um evento
**Quando** o `test:contracts` roda
**Então** ele passa para todos os consumidores existentes (FR-29)

**Dado** um campo existente removido, renomeado ou com tipo alterado
**Quando** o `test:contracts` roda
**Então** ele falha nos três casos da mesma forma (FR-29)

**Dado** um campo obrigatório novo em `input`
**Quando** o `test:contracts` roda
**Então** ele falha, porque consumidores existentes não o enviam

**Dado** uma mudança incompatível feita como action nova (ex.: `createTenantV2`)
**Quando** o `test:contracts` roda
**Então** cada action é testada pelo próprio contrato, e a antiga não precisa continuar existindo nem sincronizada com a nova (FR-29, PRD §8)

**Dado** a mensagem de falha
**Quando** ela aparece
**Então** sugere criar uma action nova em vez de alterar a existente

> **Nota:** o detector automático que compara duas versões do mesmo manifest continua roadmap (PRD, FR-29).

## Epic 6: CLI Completo e Developer Experience

Dev Services e `tecton-admin dev` foram antecipados no pre-mortem de 2026-10-05 (Stories 1.11 e 3.13). Dev tem o ciclo de vida completo do `tecton-admin`: `migrate`, família `lint` (com `lint:gateway` e aviso de quórum sem provider), testes isolados por Testcontainers, e `extract` para migração assistida por Strangler Fig: domínio novo com adaptador legado, `LegacyAuthBridge` com adaptadores prontos, fachada no Gateway com janela de manutenção e script único de dados.

### Story 6.1: `tecton-admin migrate`

Como **dev que alterou o schema de um serviço**,
quero aplicar as migrations de todos os serviços com um comando,
para manter cada banco em dia sem entrar serviço por serviço (FR-15).

**Critérios de Aceite:**

**Dado** um workspace com Auth, Directory e domínios
**Quando** eu rodo `tecton-admin migrate`
**Então** as migrations Prisma pendentes de cada serviço são aplicadas no banco próprio dele
**E** `--domain <nome>` limita a execução a um serviço

**Dado** uma mudança no schema Prisma de um domínio
**Quando** eu rodo `tecton-admin migrate create <domínio> <nome>`
**Então** é criada a migration correspondente no domínio

**Dado** uma falha na migration de um serviço
**Quando** ela acontece
**Então** o comando para, indica o serviço e o erro e lista o que já foi aplicado nos outros

**Dado** uma URL de banco ausente ou inválida
**Quando** o comando roda
**Então** ele falha com a mensagem do `ConfigProvider` (Story 3.1)

**Dado** os bancos suportados (PostgreSQL, MariaDB e MySQL)
**Quando** o job de matriz de bancos da Story 1.1 roda
**Então** o comando funciona em todos

### Story 6.2: `tecton-admin lint:gateway` e template de CI

Como **mantenedor de um sistema construído com o Tecton**,
quero que o build falhe se o Gateway ganhar dependências proibidas,
para que ele nunca acumule circuit breaker, cache ou lógica de domínio sem decisão explícita (FR-17, AD-8).

**Critérios de Aceite:**

**Dado** o `apps/gateway`
**Quando** eu rodo `tecton-admin lint:gateway`
**Então** as dependências do `package.json` e os imports do código são comparados com a allowlist versionada junto com o framework
**E** qualquer pacote de circuit breaker, de cache de resposta, de domínio, `@tecton/directory` ou `@tecton/ui` faz o comando falhar, indicando a dependência e a regra (FR-19, AD-8)

**Dado** o resultado
**Quando** o comando termina
**Então** sai com código 0 sem violação e diferente de 0 com violação, funcionando em qualquer plataforma de CI (FR-17)
**E** aceita `--format json`

**Dado** `tecton-admin lint`
**Quando** ele roda depois desta story
**Então** executa toda a família (manifests e Gateway); os subcomandos continuam disponíveis separadamente

**Dado** um workspace novo
**Quando** eu rodo `tecton-admin new`
**Então** é gerado um workflow do GitHub Actions que roda `lint`, `test:contracts` e os testes, e falha o build numa violação do Gateway (FR-17)

### Story 6.3: Aviso de `sensitive.quorum` sem `KeyCustodyProvider`

Como **dev que marcou actions como `sensitive.quorum`**,
quero ser avisado no build quando o domínio não tem provider de custódia configurado,
para nunca ir para produção achando que existe proteção de quórum quando não existe (FR-17, FR-11).

**Critérios de Aceite:**

**Dado** um domínio com action `sensitive.quorum` e sem `KeyCustodyProvider` na configuração dele
**Quando** eu rodo `tecton-admin lint`
**Então** aparece um aviso (em inglês) por action, com domínio e nome da action (FR-11)
**E** o código de saída não muda por causa do aviso

**Dado** a opção `--strict`
**Quando** o lint encontra esse caso
**Então** o comando falha

**Dado** um domínio com o provider configurado
**Quando** o lint roda
**Então** não há aviso

### Story 6.4: Testcontainers para isolamento de teste e CI

Como **mantenedor que roda testes no CI**,
quero que os testes usem containers descartáveis,
para ter isolamento real entre execuções sem depender de infraestrutura persistente (FR-31).

**Critérios de Aceite:**

**Dado** os testes de integração do framework e os do workspace gerado
**Quando** rodam no CI
**Então** usam Testcontainers para banco e Valkey, descartados ao final de cada execução (FR-31)
**E** não dependem de nenhuma infraestrutura externa persistente (FR-31)

**Dado** duas execuções seguidas de `test:contracts`
**Quando** a segunda roda
**Então** não compartilha nenhum dado com a primeira (FR-31)

**Dado** uma máquina sem Docker disponível
**Quando** um comando que usa Testcontainers roda
**Então** falha com mensagem clara dizendo que precisa de Docker

> **Nota:** a verificação de contrato pelo provedor rodando de verdade (`test:contracts --verify-providers`) saiu do MVP na elicitação de 2026-10-06 e é roadmap logo após o MVP. O FR-31 continua atendido: o `test:contracts` compara schemas sem guardar estado, e os demais testes de CI usam containers descartáveis.

### Story 6.5: `LegacyAuthBridge` com adaptadores prontos

Como **dev migrando um domínio cujos clientes autenticam no monólito**,
quero que o domínio novo aceite a credencial do monólito sem eu escrever código de autenticação,
para que o desvio funcione sem mudar os clientes e sem abrir mão do Zero Trust (FR-16, AD-7, decisão L1).

**Critérios de Aceite:**

**Dado** a porta `LegacyAuthBridge` em `@tecton/providers`
**Quando** uma requisição com credencial do monólito precisa ser verificada por um domínio
**Então** a credencial é verificada pelo próprio domínio através da ponte e o resultado é o sujeito do Tecton, ou uma recusa (AD-7)
**E** a ponte pode ser testada sozinha, sem o adaptador legado da Story 6.6

**Dado** os adaptadores prontos entregues pelo framework
**Quando** eu configuro a ponte por arquivo
**Então** posso escolher entre: (1) endpoint de sessão do monólito, que recebe o cookie ou header repassado e devolve o identificador do usuário; (2) JWT do monólito, verificado por JWKS ou chave pública, com o claim do identificador configurável; (3) introspecção OAuth2 (RFC 7662)
**E** só preciso escrever classe própria se o monólito usar outro mecanismo

**Dado** o adaptador de JWT do monólito (ex.: um Keycloak)
**Quando** ele verifica um token
**Então** confere, além da assinatura, `iss`, `aud` e, quando configurado, `azp`, de modo que um token emitido para outro cliente do mesmo provedor seja recusado

**Dado** um JWT do monólito assinado com segredo compartilhado (HS256)
**Quando** a ponte é configurada para ele
**Então** funciona, mas o startup registra um aviso de que o segredo dá ao domínio o poder de emitir tokens do monólito

**Dado** o identificador do usuário no monólito
**Quando** a ponte o obtém
**Então** ele é convertido no sujeito do Tecton consultando o Directory pelo `ServiceClient`, por um atributo de identificador legado configurável no `User`
**E** um usuário sem correspondência no Directory resulta em 401

**Dado** o adaptador de endpoint de sessão
**Quando** ele valida a mesma credencial várias vezes
**Então** o resultado fica em cache por tempo configurável (padrão de 30 segundos)
**E** esse tempo é o atraso máximo para um logout no monólito valer no domínio novo, e isso está escrito na documentação da ponte

**Dado** o monólito inacessível
**Quando** a ponte precisa verificar uma credencial fora do cache
**Então** a requisição é rejeitada (fail-closed)

**Dado** o `objectClass` `User` embutido no Directory
**Quando** esta story é concluída
**Então** ele ganha o atributo de identificador legado, marcado `readOnly` (mudança aditiva, AD-2)
**E** o Directory ganha a action `setLegacyId`, a única forma de gravar esse atributo, permitida só a administrador ou à credencial de serviço usada pela importação do `extract` (Story 6.8)
**E** a edição genérica de atributos nunca o altera (Story 4.1), para que ninguém troque o próprio identificador legado pelo de outra pessoa

### Story 6.6: `extract`, parte 1: domínio novo e adaptador legado

Como **dev migrando um domínio de um monólito maduro**,
quero gerar o domínio novo e um adaptador que entenda a API antiga,
para que os clientes do monólito continuem chamando os mesmos endereços enquanto o domínio novo assume (FR-16, decisão X1).

**Critérios de Aceite:**

**Dado** um manifest do domínio escrito pelo dev ou por agente de IA
**Quando** eu rodo `tecton-admin extract <domínio> --manifest <arquivo>`
**Então** o domínio é gerado como na Story 3.4, usando esse manifest
**E** o comando não tenta descobrir limites de domínio sozinho (PRD §5)

**Dado** um arquivo de rotas legadas (método, caminho e action de destino)
**Quando** eu o passo com `--legacy-routes <arquivo>`
**Então** é gerado um adaptador de entrada legado em `src/adapters/legacy`, com um tradutor por rota: requisição legada para `input` da action, `output` para resposta legada, e erro para o formato de erro legado
**E** os tradutores nascem como stubs que o dev completa

**Dado** uma requisição recebida pelo adaptador legado
**Quando** ela é traduzida
**Então** a credencial do monólito é verificada pela `LegacyAuthBridge` (Story 6.5) antes de qualquer outra coisa, e credencial ausente ou inválida resulta em 401 no formato de erro legado
**E** a action é executada pelo mesmo caminho de qualquer chamada, com validação e ACL, nunca por atalho

**Dado** a tradução entre os formatos
**Quando** eu verifico onde ela acontece
**Então** acontece só no adaptador do domínio, nunca no Gateway (FR-19, AD-8)

**Dado** um `extract` concluído
**Quando** o agente atualiza a documentação
**Então** o guia o orienta a ler o README do monólito e usar o que for pertinente ao domínio extraído no README do workspace, perguntando ao dev quando faltar informação
**E** a saída do comando lembra o agente de atualizar a seção marcada do `AGENTS.md`

### Story 6.7: `extract`, parte 2: fachada no Gateway e janela de manutenção

Como **dev migrando um domínio**,
quero desviar as rotas legadas para o domínio novo de forma gradual e controlada,
para validar o domínio novo antes de assumir 100% do tráfego (FR-16).

**Critérios de Aceite:**

**Dado** o `extract`
**Quando** ele termina
**Então** o Gateway ganha uma regra de fachada para as rotas legadas do domínio, inicialmente 100% para o monólito

**Dado** a regra de fachada
**Quando** eu a configuro
**Então** posso desviar por rota, por percentual ou por flag (FR-16)
**E** o Gateway só desvia o caminho, sem alterar corpo nem headers (FR-19)

**Dado** um desvio por percentual
**Quando** ele é configurado
**Então** a saída do comando e a documentação avisam que percentual serve só para validação em estágio, nunca como estado estável de produção (FR-16)

**Dado** `tecton-admin extract <domínio> --maintenance start`
**Quando** a janela de manutenção começa
**Então** o Gateway para de aceitar requisições novas para as rotas do domínio, respondendo 503 com `Retry-After`
**E** espera as requisições em andamento para o monólito terminarem antes de liberar o corte (FR-16)

**Dado** `--maintenance end` com a rota em 100% para o domínio novo
**Quando** a janela termina
**Então** o tráfego volta a ser aceito, já atendido pelo domínio novo

**Dado** a migração validada em 100%
**Quando** eu quero remover a fachada, o adaptador legado e a ponte
**Então** é um passo manual, descrito na documentação, que o `extract` não automatiza (FR-16)

### Story 6.8: `extract`, parte 3: exportação e importação única de dados

Como **dev migrando um domínio**,
quero mover os dados das tabelas do monólito para o banco do domínio novo uma única vez, durante a janela de manutenção,
para fazer o corte sem escrever script de migração do zero (FR-16).

**Critérios de Aceite:**

**Dado** a lista de tabelas do monólito indicadas pelo dev e um arquivo de mapeamento para o schema do domínio novo
**Quando** eu rodo `tecton-admin extract <domínio> --data-script`
**Então** é gerado um script de exportação e importação via Prisma, lendo o banco do monólito por introspecção
**E** as transformações de campo nascem como stubs que o dev completa

**Dado** usuários do monólito entre os dados importados
**Quando** o script roda
**Então** ele associa o identificador legado de cada um chamando a action `setLegacyId` do Directory (Story 6.5) pelo `ServiceClient`, nunca gravando no banco do Directory (AD-9)

**Dado** o script
**Quando** ele roda
**Então** ao final compara a contagem de registros de cada tabela de origem com o destino e falha se houver diferença

**Dado** uma falha no meio da importação
**Quando** ela acontece
**Então** a importação daquela tabela é desfeita e o script indica onde parou, para ser rodado de novo sem duplicar dados

**Dado** o banco do monólito em qualquer um dos bancos suportados (PostgreSQL, MariaDB ou MySQL)
**Quando** o script roda no job de matriz de bancos da Story 1.1
**Então** funciona sem mudança

**Dado** o fluxo do corte
**Quando** eu leio a documentação
**Então** ela deixa claro que o script roda uma única vez, dentro da janela de manutenção, sem sincronização contínua (FR-16)

### Story 6.9: Ajuda completa do `tecton-admin`

Como **dev ou agente de IA conhecendo o CLI**,
quero que o `--help` mostre todos os comandos, inclusive os que ainda são roadmap,
para entender a visão completa da ferramenta desde o primeiro dia (nota do FR-18).

**Critérios de Aceite:**

**Dado** `tecton-admin --help`
**Quando** eu o rodo
**Então** aparecem todos os comandos: `new`, `generate`, `dev`, `migrate`, `lint`, `lint:gateway`, `test:contracts`, `extract`, `auth` e `mcp:serve`
**E** `mcp:serve` aparece marcado como roadmap

**Dado** `tecton-admin mcp:serve`
**Quando** eu o rodo
**Então** ele informa que o comando é roadmap e sai com código diferente de 0, sem efeito colateral

**Dado** `--help` de qualquer subcomando
**Quando** eu o rodo
**Então** mostra opções e um exemplo de uso, todo em inglês (Constitution §8, eixo 2)
