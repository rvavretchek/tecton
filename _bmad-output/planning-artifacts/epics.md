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

This document provides the complete epic and story breakdown for Tecton, decomposing the requirements from the PRD, UX Design (Directory Service admin, restricted scope), and Architecture Spine into implementable stories. Tecton is the framework itself (packages `@tecton/manifest`, `core`, `providers`, `directory`, `service-client`, `ui`, `cli`) — these epics build the framework, not an app built with it.

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
- AD-3: Direção de dependência entre pacotes do framework: `manifest` não depende de nada interno; `core`/`providers`/`service-client`/`ui` podem depender de `manifest`; `directory` depende de `manifest` e de `ui`; `cli` depende de todos; nunca o inverso
- AD-4: Todo scaffold gerado declara `@tecton/*` como dependência versionada; nenhum comando do CLI grava código-fonte de pacote do framework no repo do dev
- AD-5: UUID v7 canônico (36 caracteres, minúsculas, forma `8-4-4-4-12`) para todo identificador de entidade e `id` de evento, gerado por biblioteca padrão do ecossistema
- AD-6: `i18nKey` como campo de extensão de lookup de máquina em toda mensagem/erro exposta ao usuário final
- AD-7: Todo serviço (Directory incluído) verifica a assinatura do token ele mesmo, sempre, e decide autorização só a partir das claims que ele mesmo extraiu — nunca de header/claim repassado por outro serviço
- AD-8: Gateway nunca importa pacote de circuit breaker, cache de resposta, ou pacote de domínio específico — `lint:gateway` enforça isso em CI
- AD-9: Único jeito de um domínio A obter dado de domínio B é `ServiceClient` (síncrono, exceção) ou consumir `events.publishes` (padrão) — nunca import direto de código nem acesso direto a banco de outro domínio, Directory Service incluído
- AD-10: `@tecton/ui` como único runtime de renderização schema→tela; tema default (tokens CSS) + porta `UiThemeProvider` (slots substituíveis, compostos pelo `Core`, nunca resolvidos pelo slot substituto); namespace de `i18nKey` `<domínio>.<chave>`; `ObjectTreeView` exclusivo do Directory (containment/ACL), `AttributeForm` reusável por qualquer domínio via `@tecton/manifest` (nunca import direto de `@tecton/directory`); SPA admin embutida em `@tecton/directory`, servida em `/admin`; toda chamada de API da SPA (não só o shell inicial) atravessa o Gateway
- Stack fixado: Node.js 24.x, TypeScript 6.0.3, Fastify 5.12.x, Prisma 8.x, Valkey 9.1.x, React 19.x, `@rjsf/core` 6.1.2, OpenTelemetry, Awilix, Testcontainers
- Estrutura de monorepo do framework: pnpm workspaces, pacotes `packages/{manifest,core,providers,directory,service-client,ui,cli}`; app gerada por `tecton-admin new` usa Turborepo/Nx com `apps/{gateway,directory,domains/<nome>}`
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
