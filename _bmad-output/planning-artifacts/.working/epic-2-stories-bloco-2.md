# Epic 2: Autenticação e Zero Trust (rascunho do bloco 2, Stories 2.5 a 2.8)

> Rascunho para revisão. Depois de aprovado, entra no `epics.md` logo após a Story 2.4. A Story 2.6 (bloqueio por identificador) foi incluída a pedido do autor em 2026-10-02, por sugestão do Vex.

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

> **Nota:** o Dev Services com Valkey local é do Epic 6 (FR-30). Os testes desta story rodam contra um Valkey real em container.

### Story 2.6: Bloqueio de login por identificador

Como **operador de um sistema construído com o Tecton**,
quero que um login seja bloqueado temporariamente depois de várias senhas erradas, venham de onde vierem,
para que um ataque distribuído contra uma única conta não escape do rate limit por origem do Gateway.

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

### Story 2.7: Token de serviço para chamadas entre serviços

Como **dev de um domínio que chama outro domínio**,
quero que toda chamada entre serviços leve uma credencial própria do serviço chamador,
para que quem recebe saiba qual serviço está chamando e em nome de qual usuário, verificando os dois por conta própria (FR-13, D3).

**Critérios de Aceite:**

**Dado** um domínio sem credencial de serviço
**Quando** eu rodo `tecton-admin auth register-service <domínio>`
**Então** é criada uma credencial `service:<domínio>` e o segredo aparece uma única vez na saída
**E** o Auth guarda só o hash do segredo, gerado pelo `AuthProvider` da Story 2.1

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

> **Nota:** esta story entrega emissão e verificação. A anexação automática dos tokens no `ServiceClient` e na publicação e consumo de eventos é do Epic 4 (FR-21, FR-26).

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
