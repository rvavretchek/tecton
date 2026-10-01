# Epic 1: Manifest Declarativo e Scaffold Inicial (rascunho do bloco 2, Stories 1.6 a 1.10)

> Rascunho para revisão. Depois de aprovado, entra no `epics.md` logo após a Story 1.5. Os critérios de aceite usam Dado/Quando/Então/E.

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
