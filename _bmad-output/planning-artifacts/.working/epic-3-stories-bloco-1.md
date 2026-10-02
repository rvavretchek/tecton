# Epic 3: Interoperabilidade entre Domínios (rascunho do bloco 1, Stories 3.1 a 3.6)

> Rascunho para revisão. Depois de aprovado, entra no `epics.md` na seção do Epic 3. Lembrete da nota de dependência do épico: o formato de erro aqui é provisório (status HTTP + corpo básico); o RFC 9457 final é do Epic 5.

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
**Então** o domínio passa a nascer também com `src/core` (handlers das actions), `src/ports`, `src/adapters`, container Awilix e bootstrap do servidor
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
