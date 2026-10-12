# Epic 3: Interoperabilidade entre Domínios (rascunho do bloco 3, Stories 3.10 a 3.12, revisadas)

> Rascunho para revisão. Substitui as Stories 3.10 e 3.11 do bloco 2: a publicação passa a usar Transactional Outbox (decisão de 2026-10-02), o que acrescenta a Story 3.11 (relay do outbox) e renumera o consumo para 3.12.

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
**Então** o envelope já está completo e assinado: CloudEvents 1.0, `id` em UUID v7, `source` identificando o domínio, `type` no formato `com.tecton.<domínio>.<evento>`, `time` em ISO 8601 UTC, `traceparent` na extensão de distributed tracing e assinatura com a chave privada do serviço, cobrindo envelope e dados, num atributo de extensão

**Dado** um payload que não segue o schema do evento
**Quando** a publicação é chamada
**Então** ela falha com erro, nada é gravado no outbox e a transação é desfeita

**Dado** um Valkey inacessível
**Quando** a action é executada
**Então** a action e a gravação no outbox concluem normalmente, porque o envio ao Valkey é responsabilidade do relay (Story 3.11)

**Dado** os três bancos suportados (PostgreSQL, MySQL e MS-SQL)
**Quando** os testes desta story rodam
**Então** o comportamento transacional é o mesmo nos três

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
