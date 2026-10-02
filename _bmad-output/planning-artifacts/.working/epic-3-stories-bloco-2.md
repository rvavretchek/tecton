# Epic 3: Interoperabilidade entre Domínios (rascunho do bloco 2, Stories 3.7 a 3.11)

> Rascunho para revisão. Depois de aprovado, entra no `epics.md` logo após a Story 3.6.

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
para que o retry do `ServiceClient` (Story 3.9) nunca execute o mesmo efeito duas vezes.

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

### Story 3.10: Publicação de eventos assinados

Como **dev de um domínio que publica eventos**,
quero publicar um evento declarado chamando um método tipado,
para que o envelope, a assinatura e o envio sejam feitos pelo framework (FR-4, FR-21, decisão E1).

**Critérios de Aceite:**

**Dado** `tecton-admin auth register-service <domínio>` (Story 2.7)
**Quando** ele roda
**Então** passa a gerar também um par de chaves Ed25519 do serviço
**E** a chave privada aparece uma única vez na saída, para ser configurada no serviço como secreta (Story 3.1)
**E** a chave pública é publicada no JWKS do Auth, identificada pelo domínio

**Dado** um evento declarado em `events.publishes`
**Quando** o domínio é gerado
**Então** existe um método de publicação tipado com o schema do evento

**Dado** uma publicação
**Quando** ela é enviada
**Então** o envelope segue CloudEvents 1.0, com `id` em UUID v7, `source` identificando o domínio, `type` no formato `com.tecton.<domínio>.<evento>`, `time` em ISO 8601 UTC e `traceparent` na extensão de distributed tracing
**E** o evento é assinado com a chave privada do serviço, cobrindo envelope e dados, e a assinatura vai num atributo de extensão
**E** todos os eventos do domínio vão para um único stream do domínio (FR-21)

**Dado** um payload que não segue o schema do evento
**Quando** a publicação é chamada
**Então** ela falha com erro e nada é publicado

**Dado** um Valkey inacessível
**Quando** a publicação é chamada
**Então** ela falha com erro para o chamador, nunca descarta o evento em silêncio

> **Nota:** a publicação não é atômica com a transação de banco do domínio (padrão outbox). Se o processo cair entre gravar no banco e publicar, o evento se perde. O outbox fica registrado como item de roadmap.

### Story 3.11: Consumo de eventos com deduplicação e dead-letter

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
