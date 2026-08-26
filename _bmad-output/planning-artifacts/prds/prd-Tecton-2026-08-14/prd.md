---
title: PRD — Tecton
status: draft
created: 2026-08-14
updated: 2026-08-14
---

# PRD: Tecton
*Working title — confirma-se com o Product Brief; não é apelido temporário.*

## 0. Document Purpose

Este PRD formaliza os requisitos do framework Tecton a partir do [Product Brief](../../briefs/brief-Tecton-2026-08-10/brief.md) (+ `addendum.md`), já validado em sessões extensas de `bmad-party-mode`. Destina-se ao próprio autor (Boss) como PM/arquiteto/dev solo, e a qualquer colaborador futuro do projeto open source, além de alimentar os workflows seguintes do BMAD Method (UX, Arquitetura, Épicos/Histórias). Vocabulário ancorado no Glossário (§3); FRs numeradas globalmente e aninhadas por feature (§4); suposições marcadas inline com `[ASSUMPTION]` e indexadas em §9.

## 1. Vision

Tecton é um framework React.js + Node.js modular orientado a microsserviços por domínio, construído para quem já passou da fase de "greenfield" — um monólito maduro sofrendo com custo de escalabilidade, ou um legado bem conhecido pelo PO mas sem documentação. Em vez de forçar times a começar do zero em microsserviços, o Tecton assume que o domínio já é conhecido e fornece o que normalmente é reinventado a cada migração: um manifest declarativo que gera interoperabilidade entre serviços sem *plumbing* manual, um core de identidade/diretório hierárquico pronto (inspirado no NDS/NetWare), e domínios embutidos que qualquer sistema multi-tenant sério precisa (Tenant, Usuário/Grupo, Custódia de chave).

O manifest é também o contrato que um agente de IA lê antes de alterar um serviço com segurança — o Tecton é desenhado desde o núcleo para ser operado tanto por um desenvolvedor quanto por um agente como Claude Code ou Codex.

## 2. Target User

### 2.1 Jobs To Be Done

- Como dono de um monólito maduro com dor real de escalabilidade, quero portar um domínio de alto custo pra fora do processo principal sem reescrever o sistema do zero, pra reduzir custo de infra sem arriscar o que já funciona.
- Como dev construindo para um PO que conhece profundamente um domínio legado não documentado, quero que o framework tome as decisões arquiteturais por mim, pra eu focar em especificar bem os limites do domínio.
- Como autor do Tecton, quero uma peça de portfólio pública que demonstre competência real em sistemas distribuídos e prática deliberada — qualquer adoção externa é ganho, não meta.

### 2.2 Non-Users (v1)

- Times começando um domínio do zero (greenfield) sem dor de escala real — Constitution §2: "monólito primeiro" continua a melhor estratégia pra esse caso.
- Quem precisa de Oracle como banco no MVP (ORM Prisma não suporta).
- Quem quer um motor de workflow completo nativo — Tecton integra motores consagrados (`WorkflowEngineProvider`), não reimplementa um.

### 2.3 Key User Journeys

*Escala leve (produto de biblioteca/CLI) — uma frase por jornada.*

- **UJ-1.** Dev com monólito maduro sofrendo custo de escala roda `tecton-admin extract <domínio>` e migra o domínio quente pra um serviço Tecton, com o resto do sistema continuando a funcionar atrás da fachada do gateway.
- **UJ-2.** Dev com domínio bem conhecido mas não documentado roda `tecton-admin generate domain <nome>` e recebe scaffold opinativo completo, sem precisar decidir arquitetura.
- **UJ-3.** Um agente de IA (Claude Code/Codex) lê o `tecton.yaml` de um domínio antes de alterá-lo, entendendo contrato, dependências e o que é seguro tocar sem explorar a base de código inteira.

## 3. Glossário

- **Domínio** — unidade de negócio isolada (Tenant, Usuário/Grupo, Custodiante, ou um domínio de terceiros), com seu próprio manifest, banco e ciclo de vida. Persistência por serviço: nunca compartilha banco com outro domínio.
- **Manifest** (`tecton.yaml`) — arquivo declarativo por domínio (YAML, `manifestVersion` próprio) que declara `objectClass` (opcional), `actions`, `events`, `dependencies`. Fonte única de verdade; gera conectores de mensageria, OpenAPI/AsyncAPI, e é o artefato que um agente de IA lê antes de alterar o domínio.
- **ObjectClass** — declaração opcional no manifest que torna um domínio um objeto gerenciável no Core de Diretório (containment + ACL herdável). Só Tenant, Usuário/Grupo e Custodiante têm.
- **Action** — uma capacidade exposta por um domínio (input/output tipados no manifest); pode ser `sensitive` (exige quórum do Custodiante) ou ter `approval` (aprovação simples de negócio).
- **Event** — mensagem publicada/consumida entre domínios, envelope CloudEvents, transportada via Redis Streams (MVP), entrega at-least-once.
- **Quórum** — número mínimo de Custodiantes que precisam aprovar uma ação sensível (configurável, ex. 3/5).
- **Custodiante** — domínio embutido de custódia de chave de criptografia por limiar; guarda fragmento de chave do tenant, aprova ações sensíveis.
- **Core de Diretório** — subsistema genérico de objeto/hierarquia do framework (persistido em Closure Table), com ACL por herança aditiva simples, gestão por *drag-and-drop*. Todo domínio-objeto é uma classe declarada nele.
- **Case 1 / Case 2** — os dois perfis de adoção do Tecton: Caso 1 é migração assistida de um monólito documentado; Caso 2 é scaffold opinativo para domínio conhecido mas não documentado.
- **`tecton-admin`** — CLI única do framework (`new`, `generate`, `dev`, `migrate`, `extract`, `test:contracts`, `mcp:serve`).
- **Provider** (`AuthProvider`, `KeyCustodyProvider`, `TokenRevocationStore`, `ServiceDiscoveryProvider`, `ConfigProvider`, `WorkflowEngineProvider`) — interface de extensão plugável, nome sem prefixo de projeto, com implementação leve no MVP e integração com ferramenta madura como opção de roadmap.
- **Strangler Fig** — padrão de migração incremental (Martin Fowler) usado por `tecton-admin extract`: serviço novo nasce ao lado do monólito, tráfego migra por trás de uma fachada de roteamento no gateway.

## 4. Features

### 4.1 Manifest Declarativo de Domínio

**Description:** Todo domínio Tecton é descrito por um `tecton.yaml` (`manifestVersion` próprio) contendo `objectClass` opcional, `actions` tipadas, `events` publicados/consumidos, e `dependencies`. O framework gera interoperabilidade, contratos e documentação a partir dele — nunca o contrário. É o artefato que realiza UJ-3 (agente de IA lê antes de alterar).

**Functional Requirements:**

#### FR-1: Declaração de domínio via manifest
Dev pode declarar um novo domínio criando um `tecton.yaml` com `manifestVersion`, `domain`, `version`, `description`.

**Consequences (testable):**
- Framework rejeita (erro de validação) qualquer domínio sem `manifestVersion`.
- `tecton-admin generate domain <nome>` cria o `tecton.yaml` inicial válido.

#### FR-2: ObjectClass opcional
Dev pode declarar `objectClass` (containment + ACL herdável) apenas quando o domínio participa do Core de Diretório.

**Consequences (testable):**
- Domínio sem `objectClass` não aparece na árvore do Core de Diretório nem gera UI de gestão hierárquica.
- Domínio com `objectClass` sem `containment.allowedParents` falha validação.

#### FR-3: Actions tipadas com aprovação/sensibilidade
Dev declara `actions` com `input`/`output` tipados; pode marcar `sensitive.quorum` (exige `description` obrigatória) ou `approval` (aprovação simples reaproveitando ACL).

**Consequences (testable):**
- Manifest com `sensitive` sem `description` falha validação no `tecton-admin lint`.
- Action com `approval.required: true` gera, na execução, um estado pendente em vez de retorno imediato.

#### FR-4: Events publicados/consumidos
Dev declara `events.publishes`/`events.consumes` com schema por evento; framework gera o conector de mensageria (Redis Streams, envelope CloudEvents) automaticamente.

**Consequences (testable):**
- Nenhum código de integração de broker é escrito manualmente pelo dev para um evento declarado no manifest.
- Consumo de evento de outro domínio nunca acessa o banco desse domínio diretamente (persistência por serviço).

#### FR-5: Geração de OpenAPI/AsyncAPI a partir do manifest
Framework gera automaticamente documentação OpenAPI (via `@fastify/swagger`, das rotas Fastify geradas das `actions`) e AsyncAPI (transform do `events`, validado por `@asyncapi/parser`).

**Consequences (testable):**
- Alterar um `input`/`output` de action e rodar o build atualiza o OpenAPI gerado sem edição manual.
- Documento AsyncAPI gerado é validado com sucesso por `@asyncapi/parser` em CI.

**Notes:** `[NOTE FOR PM]` — o formato v0 do manifest (fechado hoje) deve evoluir durante o desenvolvimento; `manifestVersion` existe pra isso, mas nenhuma política de migração entre versões do próprio formato foi definida ainda — candidato a Open Question.

### 4.2 Core de Diretório Hierárquico

**Description:** Subsistema genérico que persiste qualquer domínio com `objectClass` como objeto numa hierarquia, com controle de acesso por herança. MVP entrega navegação, leitura e edição via formulário — não *drag-and-drop* (ver §5 Non-Goals).

**Functional Requirements:**

#### FR-6: Persistência agnóstica de banco via Closure Table
Framework persiste a hierarquia de objetos via Closure Table, através do Prisma (PostgreSQL, MySQL, MS-SQL).

**Consequences (testable):**
- Trocar o banco configurado (entre os três suportados) não exige mudança de schema ou código de domínio.
- Mover um objeto na árvore é uma operação localizada (linhas do nó movido), nunca uma renumeração de árvore inteira.

#### FR-7: Controle de acesso por herança aditiva
Permissão setada num container flui para os descendentes por padrão; framework nunca oferece bloqueio/override por nó no MVP.

**Consequences (testable):**
- Consultar "quais permissões um objeto tem" nunca exige verificar exceção/override em nenhum ancestral — só soma de heranças.
- Schema de relações permite evoluir para um motor externo (ex. OpenFGA) sem migração de dados.

#### FR-8: Navegação e edição de objetos (sem drag-and-drop no MVP)
Dev/usuário final navega a árvore de objetos (somente leitura de estrutura) e edita atributos de um objeto via formulário gerado (`react-jsonschema-form`) a partir de `objectClass.attributes`.

**Consequences (testable):**
- Reordenar/mover um objeto na árvore via UI **não** está disponível no MVP — só leitura da hierarquia.
- Formulário de edição reflete automaticamente qualquer novo atributo adicionado ao `objectClass` sem código de UI escrito à mão.

**Out of Scope:**
- Mover objeto por *drag-and-drop* na UI — roadmap, herdado da implementação do Aether (ver §5 Non-Goals).

### 4.3 Domínios Embutidos

**Description:** Três domínios que qualquer sistema multi-tenant sério precisa, prontos no framework como classes de objeto do Core de Diretório: Tenant, Usuário/Grupo, Custodiante.

**Functional Requirements:**

#### FR-9: Domínio Tenant
Framework fornece o domínio Tenant como raiz da árvore — criação, status (`active`/`suspended`/`archived`), isolamento multi-tenant.

**Consequences (testable):**
- Todo objeto no Core de Diretório pertence, direta ou indiretamente, a um Tenant.
- Ação de exportação de dados do tenant (`exportTenantData`) é marcada `sensitive` no manifest — mesmo sem o Custodiante implementado no MVP (ver FR-11), a marcação existe desde já.

#### FR-10: Domínio Usuário/Grupo
Framework fornece Usuário e Grupo como objetos do Core de Diretório, contidos num Tenant, com associação usuário-grupo e atribuição de papel.

**Consequences (testable):**
- Estrutura de equipe/departamento é representável como containment na árvore (necessário pra FR-7, herança de ACL por "gerente aprova gente do seu time").
- Autenticação (Feature 4.4) referencia Usuário como a identidade autenticável.

#### FR-11: Domínio Custodiante — interface no MVP, implementação no roadmap
Framework declara a interface `KeyCustodyProvider` (agnóstica de fornecedor) e o conceito de ação `sensitive.quorum` no manifest. A implementação real (custódia de chave por limiar, integração com OpenBAO, aprovação x/n criptograficamente forçada, log de auditoria encadeado) é roadmap, não MVP.

**Consequences (testable):**
- Sem `KeyCustodyProvider` configurado, uma action `sensitive.quorum` **executa normalmente** (não bloqueia) — decisão explícita: não travar velocidade de desenvolvimento no MVP.
- `tecton-admin lint` emite aviso de build/CI quando um domínio declara `sensitive.quorum` sem `KeyCustodyProvider` configurado (mesma família do `lint:gateway`).
- Em runtime, a execução sem proteção real é logada com aviso explícito e consistente (ex.: `⚠️ action "exportTenantData" é sensitive.quorum mas nenhum KeyCustodyProvider está configurado — executando sem proteção de quórum`) — nunca falha silenciosamente.
- `KeyCustodyProvider` sem implementação concreta não impede o restante do framework de funcionar.

### 4.4 Autenticação e Zero Trust

**Description:** Autenticação centralizada via serviço de Auth, com verificação criptográfica independente em cada serviço de domínio — nenhuma chamada interna é confiada só por "vir da rede".

**Functional Requirements:**

#### FR-12: AuthProvider com JWT e refresh confinado
Framework fornece `AuthProvider` (Argon2id + Pepper para hash local), emitindo JWT de acesso e refresh token confinado ao serviço de Auth.

**Consequences (testable):**
- Nenhum serviço de domínio jamais recebe ou processa um refresh token.
- Gateway valida a assinatura do access token e propaga *claims* via header para os serviços de domínio.

#### FR-13: Verificação independente por serviço (Zero Trust)
Todo serviço de domínio verifica a assinatura do token recebido por conta própria — nunca aceita um header pré-decodificado sem verificação criptográfica local.

**Consequences (testable):**
- Uma chamada direta a um serviço de domínio (sem passar pelo gateway) com um token inválido/adulterado é rejeitada pelo próprio serviço.
- Toda chamada serviço-a-serviço (não só gateway→serviço) carrega uma credencial verificável.

#### FR-14: Revogação de token via TokenRevocationStore
Framework fornece `TokenRevocationStore` com implementação Redis-backed real no MVP (não interface vazia).

**Consequences (testable):**
- Revogar um token o torna inválido em requisições subsequentes em até o tempo de propagação do Redis, sem esperar expiração natural do JWT.

**Feature-specific NFRs:**
- Toda comunicação leste-oeste (serviço-a-serviço) segue Constitution §9 (Zero Trust) — verificação própria obrigatória, sem exceção por "ambiente de confiança".

### 4.5 CLI (`tecton-admin`)

**Description:** Binário único que cobre todo o ciclo de vida — criação de projeto, geração de domínio, desenvolvimento local, migração, testes de contrato, lint. Vocabulário compartilhado com o `aether-admin`.

**Functional Requirements:**

#### FR-15: Comandos essenciais do ciclo de vida
`tecton-admin new <projeto>` (scaffold do workspace), `generate <tipo> <nome...>` (variádico, aceita múltiplos nomes ou `--from <arquivo>` para lote), `dev` (sobe gateway+domínios+Redis com live reload via `tsx watch`/`turbo run dev`), `migrate` (roda migrations Prisma).

**Consequences (testable):**
- `tecton-admin generate domain financeiro materiais comercial` cria os três domínios numa chamada.
- `tecton-admin dev` sobe o ambiente completo sem passo manual de infraestrutura (Dev Services via `docker-compose.dev.yml`).

#### FR-16: `extract` para migração assistida (Caso 1)
`tecton-admin extract <domínio>` gera scaffold do domínio + configuração de fachada de roteamento no gateway (Strangler Fig) + script de export/import único de dados.

**Consequences (testable):**
- Após `extract`, o domínio antigo (no monólito) e o novo (Tecton) coexistem, com o gateway roteando por regra explícita (rota/percentual/flag).
- Corte de dados é uma operação única, executada sob janela de manutenção — sem sincronização contínua no MVP.

#### FR-17: Família de lint (`tecton-admin lint`)
CLI oferece checagens automatizadas: `lint:gateway` (allowlist de dependência do gateway) e aviso de `sensitive.quorum` sem `KeyCustodyProvider` (FR-11).

**Consequences (testable):**
- CI configurado com o template GitHub Actions gerado falha o build se o gateway importar dependência fora da allowlist.
- Script é agnóstico de plataforma de CI (roda via código de saída, não depende de sintaxe específica).

#### FR-18: `test:contracts`
CLI roda testes de contrato gerados dos dois lados do manifest (publisher vs. `output`; consumer vs. `events.publishes`).

**Consequences (testable):**
- Mudar o `output` de uma action sem atualizar o consumidor correspondente falha `test:contracts`.

**Notes:** `extract` e `mcp:serve` (roadmap) aparecem no `--help` mesmo antes de implementados, para comunicar a visão completa desde o dia 1.

### 4.6 Interoperabilidade (Gateway, Discovery, Mensageria, Config)

**Description:** Camada de plumbing entre domínios — roteamento, descoberta, mensageria assíncrona e configuração — com fronteiras de responsabilidade explícitas para não crescer sem controle.

**Functional Requirements:**

#### FR-19: Gateway fino com responsabilidades proibidas
Gateway roteia (a partir do manifest), valida token, aplica rate limiting (Redis) e propaga `traceparent`. **Nunca** faz circuit breaker, retry automático em mutação, cache de resposta, transformação de payload, agregação de múltiplos serviços, ou autorização por regra de negócio.

**Consequences (testable):**
- `tecton-admin lint:gateway` falha se o pacote do gateway importar uma dependência de circuit breaker, cache, ou qualquer pacote de domínio específico.

#### FR-20: Service Discovery estático
Cada domínio expõe seu endereço via variável de ambiente gerada (`TECTON_SERVICE_<DOMÍNIO>_URL`); sem descoberta dinâmica em runtime no MVP.

**Consequences (testable):**
- `tecton-admin new`/`generate domain` gera a variável correspondente automaticamente.

#### FR-21: Comunicação assíncrona via CloudEvents sobre Redis Streams
Eventos entre domínios usam envelope CloudEvents, transportados por Redis Streams com garantia at-least-once.

**Consequences (testable):**
- Handler de evento gerado a partir de `events.consumes` é idempotente por design (chave de deduplicação) — reprocessar o mesmo evento não duplica efeito.
- Ordem é garantida dentro de um stream (por domínio), não é garantida entre streams diferentes.

#### FR-22: ConfigProvider com validação tipada
Configuração via env vars/`.env`, validada e tipada no startup — serviço falha rápido (não sobe) se a config estiver incompleta/inválida.

**Consequences (testable):**
- Subir um serviço com variável de ambiente obrigatória faltando falha antes de aceitar tráfego, com mensagem de erro identificando o campo.

### 4.7 Formato de Resposta de API

**Description:** Formato padronizado de sucesso, erro e estado pendente, adotando specs existentes em vez de inventar.

**Functional Requirements:**

#### FR-23: Sucesso como payload puro
Resposta de sucesso é o `output` do manifest, sem envelope; correlação via header `traceparent` (W3C Trace Context).

**Consequences (testable):**
- Corpo de uma resposta de sucesso nunca contém campo de metadado (`requestId`, `meta`, etc.) — só o payload declarado.

#### FR-24: Erro como RFC 9457 Problem Details
Toda resposta de erro segue RFC 9457 (`type`/`title`/`status`/`detail`/`instance`), com extensão `invalid-params` para erro de validação de campo.

**Consequences (testable):**
- Erro de validação de `input` de uma action retorna `invalid-params` listando cada campo inválido e a razão.

#### FR-25: Estado pendente como 202 Accepted dedicado
Ação `sensitive.quorum`/`approval` pendente retorna `202 Accepted` com `{ status: "pending_approval", requestId, pollUrl }` — nunca usa o formato de erro.

**Consequences (testable):**
- Cliente consegue distinguir programaticamente entre "falhou" (RFC 9457) e "está pendente" (202) sem inspecionar o corpo manualmente.

### 4.8 Resiliência e Operação

**Description:** Tolerância a falha em chamadas síncronas entre domínios (exceção, não regra — o padrão é evento) e operação básica de cada serviço.

**Functional Requirements:**

#### FR-26: ServiceClient com retry/timeout seguro
Chamada síncrona direta entre domínios (declarada em `dependencies`) usa um `ServiceClient` gerado, com retry apenas em ação idempotente por natureza ou mutação com `Idempotency-Key` explícito — nunca retry cego.

**Consequences (testable):**
- Retry automático de uma mutação sem `Idempotency-Key` declarado nunca acontece — falha propaga direto.
- Timeout configurável por chamada, com valor padrão sensato se não especificado.

#### FR-27: Health checks padrão por serviço
Todo serviço expõe `/health`, `/ready`, `/live` automaticamente, seguindo a convenção de probes do Kubernetes.

**Consequences (testable):**
- `/ready` retorna não-saudável se uma dependência real (banco, Redis) estiver inacessível.
- `/live` responde independente do estado das dependências — só confirma o processo de pé.

#### FR-28: Dockerfile por domínio
`tecton-admin generate domain` gera um Dockerfile próprio por domínio, permitindo build/deploy independente.

**Consequences (testable):**
- Cada domínio pode ser construído em imagem própria sem depender do código de outro domínio.

**Notes:** Circuit breaker e bulkhead (biblioteca candidata: `opossum`) e pipeline de CI/CD com release independente por serviço ficam roadmap — não fazem parte do MVP.
