# Epic 1: Manifest Declarativo e Scaffold Inicial (rascunho do bloco 1, Stories 1.1 a 1.5)

> Rascunho para revisão. Depois de aprovado, entra no `epics.md` na seção do Epic 1. Os critérios de aceite usam Dado/Quando/Então/E.

### Story 1.1: Scaffold do monorepo do framework

Como **contribuidor do framework (humano ou agente de IA)**,
quero um monorepo pnpm com os 7 pacotes e a direção de dependência verificada automaticamente,
para que cada story seguinte tenha onde nascer sem violar o AD-3.

**Critérios de Aceite:**

**Dado** um clone limpo do repositório
**Quando** eu rodo `pnpm install` e `pnpm build`
**Então** os pacotes `@tecton/{manifest,core,providers,directory,service-client,ui,cli}` compilam com TypeScript 6.0.3, com `engines.node` fixado em 24.x
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
