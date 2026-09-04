---
title: PRD — Tecton
status: final
created: 2026-08-14
updated: 2026-08-31
---

# PRD: Tecton
*Working title — confirma-se com o Product Brief; não é apelido temporário.*

## 0. Document Purpose

Este PRD formaliza os requisitos do framework Tecton a partir do [Product Brief](../../briefs/brief-Tecton-2026-08-10/brief.md) (+ `addendum.md`), já validado em sessões extensas de `bmad-party-mode`. Destina-se ao próprio autor (Boss) como PM/arquiteto/dev solo, e a qualquer colaborador futuro do projeto open source, além de alimentar os workflows seguintes do BMAD Method (UX, Arquitetura, Épicos/Histórias). Vocabulário ancorado no Glossário (§3); FRs numeradas globalmente e aninhadas por feature (§4); suposições marcadas inline com `[ASSUMPTION]` e indexadas em §10.

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
- **Event** — mensagem publicada/consumida entre domínios, envelope CloudEvents, transportada via Valkey Streams (MVP), entrega at-least-once.
- **Quórum** — número mínimo de Custodiantes que precisam aprovar uma ação sensível (configurável, ex. 3/5).
- **Custodiante** — domínio embutido de custódia de chave de criptografia por limiar; guarda fragmento de chave do tenant, aprova ações sensíveis.
- **Core de Diretório** — subsistema genérico de objeto/hierarquia do framework (persistido em Closure Table), com ACL por herança aditiva simples, gestão por *drag-and-drop*. Todo domínio-objeto é uma classe declarada nele.
- **Case 1 / Case 2** — os dois perfis de adoção do Tecton: Caso 1 é migração assistida de um monólito documentado; Caso 2 é scaffold opinativo para domínio conhecido mas não documentado.
- **`tecton-admin`** — CLI única do framework (`new`, `generate`, `dev`, `migrate`, `extract`, `test:contracts`, `mcp:serve`).
- **Provider** (`AuthProvider`, `KeyCustodyProvider`, `TokenRevocationStore`, `ServiceDiscoveryProvider`, `ConfigProvider`, `WorkflowEngineProvider`) — interface de extensão plugável, nome sem prefixo de projeto, com implementação leve no MVP e integração com ferramenta madura como opção de roadmap.
- **Strangler Fig** — padrão de migração incremental (Martin Fowler) usado por `tecton-admin extract`: serviço novo nasce ao lado do monólito, tráfego migra por trás de uma fachada de roteamento no gateway.
- **i18nKey** — campo de extensão no corpo de erro RFC 9457 (FR-24) e nas mensagens de UI (FR-8) que identifica a mensagem de forma neutra de idioma, pra lookup de tradução do lado do cliente; `title`/`detail` continuam o texto já negociado por `Accept-Language`.

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
- `tecton-admin lint` valida `containment.allowedParents` contra os manifests dos domínios referenciados, mesmo quando vivem em repositório/serviço distinto; referência a um `objectClass` não resolvível falha o lint explicitamente, nunca passa silenciosamente como válida.

#### FR-3: Actions tipadas com aprovação/sensibilidade
Dev declara `actions` com `input`/`output` tipados; pode marcar `sensitive.quorum` (exige `description` obrigatória) ou `approval` (aprovação simples reaproveitando ACL).

**Consequences (testable):**
- Manifest com `sensitive` sem `description` falha validação no `tecton-admin lint`.
- Action com `approval.required: true` gera, na execução, um estado pendente em vez de retorno imediato.
- `sensitive.quorum` e `approval` são mutuamente exclusivos na mesma action — manifest com os dois marcados falha validação; cada action usa só um primitivo de aprovação.
- Action pode declarar `idempotent: true` quando é idempotente por natureza (leitura, ou mutação já idempotente por design, ex. upsert); o `ServiceClient` (FR-26) usa essa declaração para decidir retry automático, além do caminho explícito via `Idempotency-Key`.

#### FR-4: Events publicados/consumidos
Dev declara `events.publishes`/`events.consumes` com schema por evento; framework gera o conector de mensageria (Valkey Streams, envelope CloudEvents) automaticamente.

**Consequences (testable):**
- Nenhum código de integração de broker é escrito manualmente pelo dev para um evento declarado no manifest.
- Consumo de evento de outro domínio nunca acessa o banco desse domínio diretamente (persistência por serviço).

#### FR-5: Geração de OpenAPI/AsyncAPI a partir do manifest
Framework gera automaticamente documentação OpenAPI (via `@fastify/swagger`, das rotas Fastify geradas das `actions`) e AsyncAPI (transform do `events`, validado por `@asyncapi/parser`).

**Consequences (testable):**
- Alterar um `input`/`output` de action e rodar o build atualiza o OpenAPI gerado sem edição manual.
- Documento AsyncAPI gerado é validado com sucesso por `@asyncapi/parser` em CI.

**Notes:** Política de migração entre versões do próprio formato do manifest, resolvida em §8 (API Contracts e Versionamento): nenhuma política formal pré-v1.0, por decisão deliberada do autor — ver §8.

### 4.2 Core de Diretório Hierárquico

**Description:** Subsistema genérico que persiste qualquer domínio com `objectClass` como objeto numa hierarquia, com controle de acesso por herança. MVP entrega navegação, leitura e edição via formulário — não *drag-and-drop* (ver §5 Non-Goals).

**Functional Requirements:**

#### FR-6: Persistência agnóstica de banco via Closure Table
Framework persiste a hierarquia de objetos via Closure Table, através do Prisma (PostgreSQL, MySQL, MS-SQL).

**Consequences (testable):**
- Trocar o banco configurado (entre os três suportados) não exige mudança de schema ou código de domínio.
- Mover um objeto na árvore é uma operação localizada (linhas do nó movido), nunca uma renumeração de árvore inteira.
- Mover um objeto para dentro de um de seus próprios descendentes é rejeitado com erro de validação — a Closure Table detecta o ciclo antes de aplicar a operação.

#### FR-7: Controle de acesso por herança aditiva
Permissão setada num container flui para os descendentes por padrão; framework nunca oferece bloqueio/override por nó no MVP.

**Consequences (testable):**
- Consultar "quais permissões um objeto tem" nunca exige verificar exceção/override em nenhum ancestral — só soma de heranças.
- Schema de relações permite evoluir para um motor externo (ex. OpenFGA) sem migração de dados.

#### FR-8: Navegação e edição de objetos (sem drag-and-drop no MVP)
Dev/usuário final navega a árvore de objetos (somente leitura de estrutura, sem *drag-and-drop* — ver §6.2) e edita atributos de um objeto via formulário gerado (`@rjsf/core`, projeto react-jsonschema-form sob o namespace ativo `@rjsf` — o pacote `react-jsonschema-form` original no npm está abandonado desde ~2019) a partir de `objectClass.attributes`.

**Consequences (testable):**
- Reordenar/mover um objeto na árvore via UI **não** está disponível no MVP — só leitura da hierarquia.
- Formulário de edição reflete automaticamente qualquer novo atributo adicionado ao `objectClass` sem código de UI escrito à mão.
- Labels e mensagens de validação do formulário gerado são multi-idioma (decisão de Arquitetura, 2026-08-28): PT-BR como padrão, EN como secundário, mesma infraestrutura de i18n da FR-24.

**Out of Scope:**
- Mover objeto por *drag-and-drop* na UI — roadmap (ver `docs/aether-tecton-compatibility.md`).

### 4.3 Domínios Embutidos

**Description:** Três domínios que qualquer sistema multi-tenant sério precisa, prontos no framework como classes de objeto do Core de Diretório: Tenant, Usuário/Grupo, Custodiante.

**Functional Requirements:**

#### FR-9: Domínio Tenant
Framework fornece o domínio Tenant como raiz da árvore — criação, status (`active`/`suspended`/`archived`), isolamento multi-tenant.

**Consequences (testable):**
- Todo objeto no Core de Diretório pertence, direta ou indiretamente, a um Tenant.
- Ação de exportação de dados do tenant (`exportTenantData`) é marcada `sensitive` no manifest — mesmo sem o Custodiante implementado no MVP (ver FR-11), a marcação existe desde já.
- Tenant `suspended` bloqueia execução de actions mutáveis em todos os objetos descendentes, mantendo leitura disponível; Tenant `archived` bloqueia toda execução de action (mutável ou não) nos descendentes, restando só leitura/exportação para fins de auditoria.

#### FR-10: Domínio Usuário/Grupo
Framework fornece Usuário e Grupo como objetos do Core de Diretório, contidos num Tenant, com associação usuário-grupo e atribuição de papel.

**Consequences (testable):**
- Estrutura de equipe/departamento é representável como containment na árvore (necessário pra FR-7, herança de ACL por "gerente aprova gente do seu time").
- Autenticação (Feature 4.4) referencia Usuário como a identidade autenticável.

#### FR-11: Domínio Custodiante — interface no MVP, implementação no roadmap
Framework declara a interface `KeyCustodyProvider` (agnóstica de fornecedor) e o conceito de ação `sensitive.quorum` no manifest. A implementação real (custódia de chave por limiar, integração com OpenBAO, aprovação x/n criptograficamente forçada, log de auditoria encadeado) é roadmap, não MVP.

**Consequences (testable):**
- Sem `KeyCustodyProvider` configurado, uma action `sensitive.quorum` **executa normalmente** (não bloqueia) — decisão explícita: não travar velocidade de desenvolvimento no MVP. Isso tem precedência sobre o `202 pending_approval` da FR-25: o 202 só existe quando há de fato uma aprovação pendente pra aguardar (quórum real com provider configurado, ou `approval` de negócio, que nunca depende de `KeyCustodyProvider`) — sem provider, não existe pendência real pra reportar.
- `tecton-admin lint` emite aviso de build/CI quando um domínio declara `sensitive.quorum` sem `KeyCustodyProvider` configurado (mesma família do `lint:gateway`).
- Em runtime, a execução sem proteção real é logada com aviso explícito e consistente (ex.: `⚠️ action "exportTenantData" é sensitive.quorum mas nenhum KeyCustodyProvider está configurado — executando sem proteção de quórum`) — nunca falha silenciosamente.
- `KeyCustodyProvider` sem implementação concreta não impede o restante do framework de funcionar.
- Quando a implementação real sair do roadmap, a interceptação de `sensitive.quorum` precisa acontecer no nível de acesso ao dado, nunca só num middleware de rota HTTP — um middleware restrito a uma rota específica é contornável por outro serviço, script de manutenção ou acesso direto ao banco (alerta de segurança registrado no addendum). Isso restringe o design aceitável do `KeyCustodyProvider` desde já, mesmo com implementação em roadmap.

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
Framework fornece `TokenRevocationStore` com implementação Valkey-backed real no MVP (não interface vazia).

**Consequences (testable):**
- Revogar um token o torna inválido em requisições subsequentes em até o tempo de propagação do Valkey, sem esperar expiração natural do JWT.
- Se o Valkey do `TokenRevocationStore` estiver inacessível no momento da checagem, o serviço trata como falha e rejeita a requisição (fail closed) — nunca assume "não revogado" sem conseguir verificar, consistente com Zero Trust (Constitution §9).

**Feature-specific NFRs:**
- Toda comunicação leste-oeste (serviço-a-serviço) segue Constitution §9 (Zero Trust) — verificação própria obrigatória, sem exceção por "ambiente de confiança".

### 4.5 CLI (`tecton-admin`)

**Description:** Binário único que cobre todo o ciclo de vida — criação de projeto, geração de domínio, desenvolvimento local, migração, testes de contrato, lint. Vocabulário compartilhado com o `aether-admin`.

**Functional Requirements:**

#### FR-15: Comandos essenciais do ciclo de vida
`tecton-admin new <projeto>` (scaffold do workspace), `generate <tipo> <nome...>` (variádico, aceita múltiplos nomes ou `--from <arquivo>` para lote), `dev` (sobe gateway+domínios+Valkey com live reload via `tsx watch`/`turbo run dev`), `migrate` (roda migrations Prisma).

**Consequences (testable):**
- `tecton-admin generate domain financeiro materiais comercial` cria os três domínios numa chamada.
- `tecton-admin dev` sobe o ambiente completo sem passo manual de infraestrutura (Dev Services via `docker-compose.dev.yml`).

#### FR-16: `extract` para migração assistida (Caso 1)
`tecton-admin extract <domínio>` gera scaffold do domínio + configuração de fachada de roteamento no gateway (Strangler Fig) + script de export/import único de dados.

**Consequences (testable):**
- Após `extract`, o domínio antigo (no monólito) e o novo (Tecton) coexistem, com o gateway roteando por regra explícita (rota/percentual/flag).
- Corte de dados é uma operação única, executada sob janela de manutenção — sem sincronização contínua no MVP.
- Roteamento por percentual serve só para validação em estágio (ex.: canário de tráfego de leitura) antes do corte — nunca é um estado estável de produção: como o corte de dados é único e sem sync contínuo, a migração só é considerada viável/completa em produção quando o roteamento chega a 100% para o domínio novo. Um monólito em produção e um serviço recém-migrado, em arquiteturas diferentes, não sustentam divisão de tráfego mutável por tempo indefinido.
- Requisições em andamento contra o domínio antigo no início da janela de manutenção são drenadas (aguardadas até concluir) antes do corte — nenhuma requisição nova é aceita durante a janela.
- Decomissionar a fachada de roteamento e o código legado do domínio antigo, depois da migração validada em 100%, é um passo manual do dev — `tecton-admin extract` não automatiza remoção no MVP.

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
Gateway roteia (a partir do manifest), valida token, aplica rate limiting (Valkey) e propaga `traceparent`. **Nunca** faz circuit breaker, retry automático em mutação, cache de resposta, transformação de payload, agregação de múltiplos serviços, ou autorização por regra de negócio.

**Consequences (testable):**
- `tecton-admin lint:gateway` falha se o pacote do gateway importar uma dependência de circuit breaker, cache, ou qualquer pacote de domínio específico.
- Se o Valkey do rate limiting estiver inacessível, o gateway falha aberto (deixa passar, com aviso de log) em vez de recusar todo tráfego — postura diferente do fail-closed de autenticação (FR-13/FR-14): rate limiting é proteção de recurso, não fronteira de segurança Zero Trust.

#### FR-20: Service Discovery estático
Cada domínio expõe seu endereço via variável de ambiente gerada (`TECTON_SERVICE_<DOMÍNIO>_URL`); sem descoberta dinâmica em runtime no MVP. Resolução de endereço fica atrás de uma interface `ServiceDiscoveryProvider` prevista desde já, para que descoberta dinâmica via DNS nativo do Kubernetes (roadmap) troque a implementação sem exigir mudança no código de domínio que a consome.

**Consequences (testable):**
- `tecton-admin new`/`generate domain` gera a variável correspondente automaticamente.

#### FR-21: Comunicação assíncrona via CloudEvents sobre Valkey Streams
Eventos entre domínios usam envelope CloudEvents, transportados por Valkey Streams com garantia at-least-once. Como qualquer tráfego serviço-a-serviço, publicar/consumir evento carrega credencial verificável — Zero Trust (Constitution §9) não é exceção pra tráfego assíncrono.

**Consequences (testable):**
- Handler de evento gerado a partir de `events.consumes` é idempotente por design (chave de deduplicação) — reprocessar o mesmo evento não duplica efeito.
- A chave de deduplicação é registrada só depois do efeito do handler ser aplicado com sucesso, nunca antes — se o processo falhar entre aplicar o efeito e registrar a chave, o evento é reprocessado (duplicata seguramente absorvida pelo handler idempotente), nunca perdido.
- Ordem é garantida dentro de um stream (por domínio), não é garantida entre streams diferentes.
- Um domínio publica todos os seus `events.publishes` num único stream (um stream por domínio, não por tipo de evento) — preserva ordem causal entre tipos de evento distintos do mesmo publisher.
- Uma mensagem que falha processamento repetidamente após um número configurável de tentativas vai para uma stream de dead-letter, sem bloquear a entrega das mensagens seguintes do mesmo stream.
- Um evento consumido sem credencial verificável do publisher é rejeitado pelo consumidor e tratado como ACK (removido do stream, logado como erro de segurança) — nunca um NACK que reentrega o mesmo evento indefinidamente, o que travaria o consumo do restante do stream.

#### FR-22: ConfigProvider com validação tipada
Configuração via env vars/`.env`, validada e tipada no startup — serviço falha rápido (não sobe) se a config estiver incompleta/inválida. Candidato de roadmap para um config server real: **OpenBAO** (não Vault), mesma lógica de interface agnóstica de fornecedor do `KeyCustodyProvider`; AWS Parameter Store/Secrets Manager como alternativa opcional pra quem já vive em AWS.

**Consequences (testable):**
- Subir um serviço com variável de ambiente obrigatória faltando falha antes de aceitar tráfego, com mensagem de erro identificando o campo.
- Uma variável presente mas com formato/tipo inválido (ex.: URL malformada, valor não numérico onde se espera número) falha o startup da mesma forma que uma variável ausente, com mensagem identificando o campo e o formato esperado vs. recebido.

### 4.7 Formato de Resposta de API

**Description:** Formato padronizado de sucesso, erro e estado pendente, adotando specs existentes em vez de inventar.

**Functional Requirements:**

#### FR-23: Sucesso como payload puro
Resposta de sucesso é o `output` do manifest, sem envelope; correlação via header `traceparent` (W3C Trace Context).

**Consequences (testable):**
- Corpo de uma resposta de sucesso nunca contém campo de metadado (`requestId`, `meta`, etc.) — só o payload declarado.

#### FR-24: Erro como RFC 9457 Problem Details
Toda resposta de erro segue RFC 9457 (`type`/`title`/`status`/`detail`/`instance`), com extensão `invalid-params` para erro de validação de campo. `title`/`detail` são multi-idioma (decisão de Arquitetura, 2026-08-28): `type` continua uma URI estável neutra de idioma; `title`/`detail` são negociados por `Accept-Language`, com extensão `i18nKey` para lookup de máquina — framework entrega PT-BR (padrão) e EN (secundário) para os erros que ele mesmo gera, e disponibiliza a mesma infraestrutura de i18n para erros de actions de domínios de terceiros, sem obrigar tradução do código do dev.

**Consequences (testable):**
- Erro de validação de `input` de uma action retorna `invalid-params` listando cada campo inválido e a razão.
- Erro de autorização negada, recurso não encontrado, ou erro interno também retorna o formato base RFC 9457 (`type`/`title`/`status`/`detail`/`instance`), sem o campo `invalid-params` — exclusivo de erro de validação de input.
- Um erro do framework (ex.: token inválido, validação de manifest) sem `Accept-Language` reconhecido retorna `title`/`detail` em Português do Brasil por padrão, nunca falha por falta de locale.

#### FR-25: Estado pendente como 202 Accepted dedicado
Ação `sensitive.quorum`/`approval` pendente retorna `202 Accepted` com `{ status: "pending_approval", requestId, pollUrl }` — nunca usa o formato de erro. Aplica-se apenas quando existe aprovação real pendente — quórum com `KeyCustodyProvider` configurado, ou `approval` de negócio (que nunca depende de provider); sem provider configurado, `sensitive.quorum` segue a FR-11 (executa normalmente com aviso), não este fluxo.

**Consequences (testable):**
- Cliente consegue distinguir programaticamente entre "falhou" (RFC 9457) e "está pendente" (202) sem inspecionar o corpo manualmente.
- Consultar `pollUrl` enquanto ainda pendente repete o mesmo corpo `202`/`pending_approval`.
- Quando a aprovação resolve com sucesso, `pollUrl` passa a retornar o payload de sucesso (FR-23) como se a action tivesse executado de forma síncrona.
- Quando a aprovação/quórum é rejeitada, `pollUrl` retorna um erro RFC 9457 (FR-24) com `type` identificando rejeição — nunca fica pendente indefinidamente nem é descartada silenciosamente.
- Uma aprovação pendente expira após um timeout configurável (com valor padrão); passado esse prazo, `pollUrl` retorna RFC 9457 indicando expiração, e um `requestId` desconhecido ou já expirado retorna `404` no mesmo formato.

### 4.8 Resiliência e Operação

**Description:** Tolerância a falha em chamadas síncronas entre domínios (exceção, não regra — o padrão é evento) e operação básica de cada serviço.

**Functional Requirements:**

#### FR-26: ServiceClient com retry/timeout seguro
Chamada síncrona direta entre domínios (declarada em `dependencies`) usa um `ServiceClient` gerado, com retry apenas em ação idempotente por natureza ou mutação com `Idempotency-Key` explícito — nunca retry cego. Como toda chamada serviço-a-serviço, carrega credencial verificável (Constitution §9, Zero Trust) — não é caminho especial.

**Consequences (testable):**
- Retry automático de uma mutação sem `Idempotency-Key` declarado nunca acontece — falha propaga direto.
- Timeout configurável por chamada; default de 5000ms (5s) se não especificado — sujeito a ajuste fino na Arquitetura (§9 OQ1).
- Uma chamada do `ServiceClient` sem credencial verificável é rejeitada pelo serviço de destino, igual a qualquer outra chamada leste-oeste (FR-13).
- O middleware de retry/timeout é desenhado como plugável, para acomodar circuit breaker/bulkhead (roadmap, candidato `opossum`) sem reforma do `ServiceClient` já existente.

#### FR-27: Health checks padrão por serviço
Todo serviço expõe `/health`, `/ready`, `/live` automaticamente, seguindo a convenção de probes do Kubernetes.

**Consequences (testable):**
- `/ready` retorna não-saudável se uma dependência real (banco, Valkey) estiver inacessível.
- `/live` responde independente do estado das dependências — só confirma o processo de pé.

#### FR-28: Dockerfile por domínio
`tecton-admin generate domain` gera um Dockerfile próprio por domínio, permitindo build/deploy independente.

**Consequences (testable):**
- Cada domínio pode ser construído em imagem própria sem depender do código de outro domínio.

**Notes:** Circuit breaker e bulkhead (biblioteca candidata: `opossum`) e pipeline de CI/CD com release independente por serviço ficam roadmap — não fazem parte do MVP.

### 4.9 Evolução de Contrato

**Description:** Postura padrão de mudança de manifest que preserva compatibilidade sem exigir ferramental novo — absorve os dois itens do Bloco C do `Tecton.md` que ainda não tinham FR própria (CQRS leve já é nativo via FR-4/FR-21; Contract Testing já é FR-18).

**Functional Requirements:**

#### FR-29: Evolução aditiva de contrato por padrão
Mudança em `input`/`output` de uma action, ou em schema de um `event`, é aditiva por padrão — nunca remove ou renomeia um campo existente, só adiciona campo opcional. Mudança genuinamente incompatível exige uma nova action explícita (ex.: `createTenantV2`) em vez de alterar a existente.

**Consequences (testable):**
- Adicionar um campo opcional novo a `input`/`output` de uma action existente nunca quebra `test:contracts` (FR-18) dos consumidores já existentes.
- Remover ou renomear um campo existente sem criar uma nova action é o sinal de quebra que `test:contracts`/lint deve capturar.
- Mudar o tipo de um campo existente (ex.: `string` para `number`) sem removê-lo ou renomeá-lo conta como a mesma quebra de remover/renomear — `test:contracts` (FR-18) captura os três casos igualmente.
- Criar uma action nova para uma mudança incompatível (ex.: `createTenantV2`) não obriga manter a antiga funcional indefinidamente nem sincronizada com a nova — mesma política de §8 (sem depreciação formal pré-v1.0); `test:contracts` testa cada action pelo seu próprio contrato, não a consistência entre versões.

**Notes:** Detector automático de quebra de compatibilidade comparando duas versões do manifest (mesma família de ferramenta do `lint:gateway`, FR-19) fica roadmap — no MVP a regra é de disciplina de autoria, verificada indiretamente pelo `test:contracts` já existente.

### 4.10 Developer Experience

**Description:** Conveniências de loop de desenvolvimento e isolamento de teste que reduzem fricção sem exigir infraestrutura externa — absorve os itens do Bloco D do `Tecton.md` que ainda não tinham FR própria (OpenAPI/AsyncAPI já é FR-5; UI Generation via `@rjsf/core` já é FR-8; Live Reload já está coberto como consequência da FR-15; Fastify é decisão de mecanismo, não comportamento observável novo).

**Functional Requirements:**

#### FR-30: Dev Services
`tecton-admin new` gera um `docker-compose.dev.yml` com a infra de desenvolvimento (Valkey + banco escolhido), sem exigir setup manual.

**Consequences (testable):**
- Subir `docker-compose.dev.yml` deixa o ambiente pronto para `tecton-admin dev` sem passo adicional de infraestrutura.

#### FR-31: Testcontainers para isolamento de teste/CI
`test:contracts` (FR-18) e demais testes de CI rodam contra containers efêmeros via Testcontainers, descartados ao final de cada execução — isolamento real, distinto da conveniência de loop de dev do Dev Services.

**Consequences (testable):**
- Rodar `test:contracts` duas vezes em sequência nunca compartilha estado de dados entre as execuções.
- CI não depende de infraestrutura externa persistente para rodar `test:contracts`.

## 5. Non-Goals (Explicit)

- **Tecton não compete com "comece em microsserviços"** — Constitution §2. Para um domínio greenfield sem dor real de escala, a recomendação do próprio framework é monólito primeiro; o Tecton não serve esse caso de uso.
- **Tecton não é o Aether** — Constitution §1. Aether é um framework monolítico separado, mesmo autor; nenhuma decisão de identidade ou framing do Tecton se apoia ou se confunde com o Aether, exceto os subsistemas explicitamente listados em `docs/aether-tecton-compatibility.md`. Decisão concreta de compartilhamento de código real entre os dois fica para quando houver código suficiente dos dois lados para avaliar — ver `docs/aether-tecton-compatibility.md`.
- **Tecton não constrói nenhuma aplicação de demonstração fictícia** (e-commerce, ingressos, billing) para provar a arquitetura — Constitution §4. Os domínios embutidos (Tenant, Usuário/Grupo, Custodiante) são a prova de conceito.
- **Tecton nunca reimplementa primitivo criptográfico sensível** (ex.: secret sharing por limiar) — Constitution §7. Funcionalidades de custódia de chave sempre integram um cofre/HSM auditado (candidato inicial: OpenBAO) atrás de uma interface agnóstica de fornecedor, nunca a implementação própria do primitivo.
- **Tecton não tenta descobrir limites de domínio automaticamente.** `tecton-admin extract` assume que o dev já sabe o que extrair (premissa do próprio Caso 1) e cuida do *como* (scaffold + fachada + export/import), não do *o quê* — descoberta automática de bounded context é problema de pesquisa não resolvido de forma confiável.
- **Tecton não persegue adoção externa ou comunidade como critério de sucesso** — Constitution §10. É gratuito e aberto desde o início, sem prazo e sem cliente além do próprio autor; adoção real é ganho, nunca meta.
- **Tecton não pretende ser um motor de workflow completo nativo.** Processos com paralelismo, compensação ou espera durável são delegados a um motor externo consagrado via `WorkflowEngineProvider` (candidato: Temporal) — o framework integra, não reimplementa orquestração de workflow.

## 6. MVP Scope

### 6.1 In Scope

- **Manifest declarativo** (FR-1 a FR-5): declaração de domínio, `objectClass` opcional, actions tipadas com `sensitive`/`approval`, events publicados/consumidos, geração automática de OpenAPI/AsyncAPI.
- **Core de Diretório Hierárquico** (FR-6 a FR-8): Closure Table via Prisma, ACL por herança aditiva simples, navegação e edição de objetos via formulário gerado — sem *drag-and-drop*.
- **Domínios embutidos** (FR-9 a FR-11): Tenant, Usuário/Grupo completos; Custodiante como interface (`KeyCustodyProvider`) e conceito `sensitive.quorum`, sem implementação real de custódia.
- **Autenticação e Zero Trust** (FR-12 a FR-14): `AuthProvider` (Argon2id + Pepper, JWT + refresh confinado), verificação independente de assinatura por serviço, `TokenRevocationStore` Valkey-backed real.
- **CLI `tecton-admin`** (FR-15 a FR-18): `new`, `generate` (variádico/`--from`), `dev`, `migrate`, `extract` (Caso 1, corte único), família `lint` (`lint:gateway` + aviso de `sensitive.quorum` sem provider), `test:contracts`.
- **Interoperabilidade** (FR-19 a FR-22): gateway fino com responsabilidades proibidas explícitas, service discovery estático por variável de ambiente, CloudEvents sobre Valkey Streams (at-least-once), `ConfigProvider` tipado com fail-fast no startup.
- **Formato de resposta de API** (FR-23 a FR-25): sucesso sem envelope + `traceparent`, erro RFC 9457 + `invalid-params`, pendente como `202 Accepted` dedicado.
- **i18n de superfícies expostas ao usuário final** (FR-8, FR-24): PT-BR padrão + EN secundário via `Accept-Language`/`i18nKey`, infraestrutura extensível pelo dev — nunca obrigatório para código de domínio de terceiros.
- **Resiliência e operação** (FR-26 a FR-28): `ServiceClient` com retry/timeout seguro (nunca retry cego), health checks `/health`/`/ready`/`/live` por serviço, Dockerfile por domínio.
- **Evolução de contrato** (FR-29): postura aditiva por padrão no manifest.
- **Developer Experience** (FR-30 a FR-31): Dev Services via `docker-compose.dev.yml`, Testcontainers para isolamento de `test:contracts`/CI.
- **DI/IoC leve**: container de injeção de dependência tipo Awilix dentro de cada serviço de domínio — barato, sem framework de DI pesado.
- **Persistência**: Prisma sobre PostgreSQL, MySQL ou MS-SQL.
- **Observabilidade distribuída** via OpenTelemetry (propagação de `traceparent` já é FR-19/FR-23).
- **TypeScript full-stack** e Turborepo/Nx no scaffold gerado para apps construídas com o Tecton (não no repositório do próprio framework).

### 6.2 Out of Scope for MVP

*(Todos os itens abaixo já passaram por triagem completa no brief/addendum — Bloco A-D do `Tecton.md`, 2026-08-13 — com veredito "roadmap" e razão registrada; aqui apenas consolidados.)*

- **Árvore com *drag-and-drop* ciente de ACL** — MVP entrega só navegação/leitura (FR-8); roadmap (ver `docs/aether-tecton-compatibility.md`).
- **Implementação real do domínio Custodiante** — integração com OpenBAO/Vault/HSM, quórum criptograficamente forçado, log de auditoria encadeado/assinado. `[NOTE FOR PM]` esse é o item roadmap mais emocionalmente carregado do brief (motivou a entrada ad hoc do especialista de segurança na sessão de fundação) — revisitar assim que houver capacidade de engenharia dedicada.
- **`WorkflowEngineProvider`** com implementação real (candidato Temporal) — MVP entrega só a interface prevista.
- **MCP por domínio** — 100% roadmap; o manifest já contém tudo que a geração futura vai precisar, sem preparação extra necessária agora.
- **Circuit breaker e bulkhead** no `ServiceClient` (candidato: `opossum`) — MVP entrega só retry+timeout seguro.
- **Sincronização contínua/CDC** para migração sem downtime (Caso 1) — MVP usa corte único com janela de manutenção.
- **Detector automático de quebra de compatibilidade** comparando manifests, e versionamento explícito de API (`v2`) — MVP aplica só a regra de evolução aditiva (FR-29).
- **Pipeline de CI/CD com release independente por serviço** — MVP entrega Dockerfile por domínio (seam) e template GitHub Actions para lint.
- **`tecton-admin generate k8s`** e **`generate ci <plataforma>`** além do template GitHub Actions — sob demanda, sem evidência de necessidade dia 1.
- **Event Sourcing completo por domínio** (`persistence: eventSourced: true`, replay/snapshot) — reservado a domínios com exigência real de reconstrução no tempo (o próprio Custodiante, quando implementado).
- **Kubernetes Native** (NetworkPolicies inclusas) e **mTLS/service mesh** (Istio/Linkerd, SPIFFE/SPIRE) — maturidade avançada de Zero Trust além da verificação por serviço já MVP (Constitution §9).
- **Compilação AOT** e **Continuous Testing** — não servem os dois objetivos do produto com força suficiente agora.
- **External API Consumption** (consumo padronizado de APIs externas por um domínio) — genérico, sem urgência identificada.
- **Rejeitados** (não roadmap, descartados): Single-File Applications (contradiz identidade modular, Constitution §1); Chaos Engineering (prematuro para projeto solo de portfólio).

## 7. Success Metrics

*Funcionar bem pesa mais que provar ao mundo que funciona — decisão explícita do autor. As duas métricas primárias são internas (migração real), não public-facing.*

**Primary**
- **SM-1**: Migrar com sucesso pelo menos um domínio real do **Arandu** (projeto irmão do autor, monólito maduro com domínios bem definidos e bem documentado) para o Tecton via `tecton-admin extract`, sem exigir mudança de arquitetura no core do framework depois do fato. Validates FR-1 a FR-5 (manifest), FR-16 (extract).
- **SM-2**: Repetir o mesmo para o **Tupã** (segundo projeto irmão, mesmo perfil de monólito maduro/documentado). Provar que o Caso 1 generaliza — não é solução ajustada às particularidades de um único monólito. Validates FR-1 a FR-5, FR-16.

*Fallback*: se Arandu e/ou Tupã não estiverem em estado migrável quando o Tecton chegar a feature-complete, o caminho de validação alternativo é extrair um domínio sintético/interno equivalente (mesmo perfil: monólito maduro, domínio bem definido) só para exercitar `extract` de ponta a ponta — SM-1/SM-2 continuam a validação preferida, isso é só o plano B.

**Secondary**
- **SM-3**: Portfólio — repositório público no GitHub com código real rodando (não apenas conceito), documentação clara, e arquitetura que um revisor técnico reconheça como bem fundamentada, não "microsserviços por microsserviços", medido por pelo menos uma revisão de arquitetura externa registrada (ex.: code review público linkável, ou avaliação de um par técnico convidado).

**Counter-metrics (do not optimize)**
- **SM-C1**: Estrelas/forks/adoção externa no GitHub — Constitution §10 já trata adoção externa como ganho, nunca meta; perseguir esse número ativamente desviaria decisão de arquitetura da qualidade real das migrações (SM-1/SM-2), que é o que realmente importa aqui.

## 8. API Contracts e Versionamento

*Cluster "Developer Products" do template — Public Surface e Versioning/Deprecation Policy. Performance Budgets e Language/Runtime Targets são decisão de Arquitetura, não de PRD — ver Open Question em §9.*

**Public Surface**: schema do manifest (`tecton.yaml`/`manifestVersion`), comandos/flags do `tecton-admin`, e interfaces de Provider (`AuthProvider`, `KeyCustodyProvider`, `TokenRevocationStore`, `ServiceDiscoveryProvider`, `ConfigProvider`, `WorkflowEngineProvider`) são tratados como a mesma classe de contrato público — mesma prioridade, mesma política de versionamento, nenhum tratado como mais ou menos estável que o outro.

**Versioning/Deprecation Policy**: antes de um v1.0 (sem prazo definido), esses contratos podem quebrar livremente entre commits/releases — decisão explícita do autor. O changelog é a única garantia de compatibilidade nessa fase; não há política formal de depreciação, aviso prévio ou período de transição no MVP. Isso resolve a pendência aberta na FR-1 sobre política de migração entre versões do `manifestVersion`: não existe uma, por ora, por decisão deliberada.

## 9. Open Questions

1. **Performance Budgets e Runtime Targets** (cluster "Developer Products", deferido do PRD): existe orçamento de latência/overhead que o framework deve respeitar (ex.: overhead do manifest sobre uma rota Fastify pura), e qual a política de versão mínima de Node.js/TypeScript? Decisão de Arquitetura, não de PRD — revisitar em `bmad-architecture`.
2. **Configuração de escopo de criptografia do Custodiante**: criptografar todos os campos ou só campos escolhidos é configurável no setup — mecânica exata (por domínio? por atributo do `objectClass`?) ainda não especificada; só relevante quando a implementação real do Custodiante sair do roadmap.
3. **Hospedagem do MCP por domínio**: voto provisório do autor é serviço dedicado (isolamento de risco) — a confirmar com evidência quando o roadmap de MCP chegar.
4. **Decisão final de motor para `WorkflowEngineProvider`**: Temporal é candidato forte (SDK TypeScript oficial, não prende nuvem específica), mas a decisão de motor está formalmente em aberto.
5. **Comparativo técnico formal vs. Moleculer.js/Dapr/NestJS microservices**: a pesquisa do brief (2026-08-11) foi por busca web, não auditoria exaustiva — antes de qualquer alegação pública de diferenciação, falta o comparativo técnico escrito mais profundo que o PM já havia sinalizado como pendente. Detalhe em `addendum.md`.

## 10. Assumptions Index

*Nenhum `[ASSUMPTION]` inline sobrevive no corpo do PRD — os dois candidatos vinham do brief:*
- **Critérios de Sucesso** (brief, `[ASSUMPTION — validar com o Boss]`) — resolvido com o autor na §7 Success Metrics (SM-1/SM-2/SM-3/SM-C1).
- **Visão de longo prazo** ("torna-se a referência open-source... idealmente com comunidade mantendo o projeto", brief, `[ASSUMPTION — validar com o Boss]`) — resolvido: adoção/comunidade nunca é critério de sucesso (Constitution §10, §5 Non-Goals, SM-C1); a aspiração permanece registrada no brief como aspiração, não como meta do PRD.

`[NOTE FOR PM]` ativo: item roadmap do Custodiante real, marcado em §6.2, como o mais emocionalmente carregado do backlog — revisitar quando houver capacidade de engenharia dedicada.
