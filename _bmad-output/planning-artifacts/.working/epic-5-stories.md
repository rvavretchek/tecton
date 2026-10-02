# Epic 5: Formato de API e Evolução de Contrato (rascunho, Stories 5.1 a 5.8)

> Rascunho para revisão. Depois de aprovado, entra no `epics.md` na seção do Epic 5. Decisões de 2026-10-02 já registradas na spine: `type` do RFC 9457 como URN (`urn:tecton:problem:<slug>`) e `pollUrl` como `GET /<domínio>/pending/<requestId>`.

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
