# Epic 2: Autenticação e Zero Trust (rascunho do bloco 1, Stories 2.1 a 2.4)

> Rascunho para revisão. Depois de aprovado, entra no `epics.md` na seção do Epic 2. Base: FR-11 a FR-14 e AD-7 com a emenda de 2026-10-01 (D1 `@tecton/auth`, D2 EdDSA + JWKS, D3 token de serviço).

### Story 2.1: `AuthProvider` com Argon2id e Pepper

Como **dev que precisa guardar senhas com segurança**,
quero um `AuthProvider` que gere e verifique hash de senha com Argon2id e Pepper,
para que nenhuma senha seja guardada de forma recuperável, mesmo se o banco vazar.

**Critérios de Aceite:**

**Dado** a interface `AuthProvider` em `@tecton/providers` e o adaptador de referência Argon2id
**Quando** eu gero o hash de uma senha
**Então** a senha passa primeiro por HMAC-SHA256 com o Pepper como chave e depois por Argon2id, com parâmetros mínimos configuráveis (padrão: 19 MiB de memória, 2 iterações, paralelismo 1)
**E** o resultado guardado está no formato PHC, com os parâmetros e o identificador da versão do Pepper usado

**Dado** uma senha correta e outra incorreta
**Quando** eu as verifico contra o hash guardado
**Então** a correta retorna verdadeiro e a incorreta retorna falso, com comparação em tempo constante e sem lançar exceção que revele o motivo

**Dado** um hash guardado com parâmetros mais fracos que a configuração atual
**Quando** a senha é verificada com sucesso
**Então** o provider indica que o hash precisa ser refeito

**Dado** um serviço que inicia sem Pepper configurado, ou com Pepper menor que 32 bytes
**Quando** ele sobe
**Então** a inicialização falha com mensagem clara, sem gerar nenhum hash

**Dado** qualquer log, erro ou registro persistido
**Quando** eu o inspeciono
**Então** o Pepper e a senha em texto puro nunca aparecem

**Dado** o núcleo de um serviço que usa o `AuthProvider`
**Quando** eu verifico os imports
**Então** ele depende só da interface, nunca da biblioteca de Argon2id diretamente (AD-1)

> **Nota:** a leitura do Pepper usa validação mínima própria. O `ConfigProvider` formal com fail-fast é do Epic 4 (FR-22) e vai absorver essa leitura.

### Story 2.2: Serviço `@tecton/auth`: login, access token EdDSA e JWKS

Como **dev de um sistema construído com o Tecton**,
quero um serviço de Auth pronto que autentique por login e senha e emita access token assinado,
para que todo serviço consiga verificar a identidade por conta própria, sem conseguir forjá-la.

**Critérios de Aceite:**

**Dado** o pacote `@tecton/auth`
**Quando** ele sobe
**Então** ele guarda só credenciais (ID de sujeito em UUID v7, identificador de login normalizado e único, hash, status e lista de permissões) no próprio banco, via Prisma
**E** nenhum outro serviço acessa esse banco (AD-9)

**Dado** um workspace sem nenhuma credencial
**Quando** eu rodo `tecton-admin auth bootstrap`
**Então** a primeira credencial administrativa é criada
**E** a senha é lida da entrada padrão ou de variável de ambiente, nunca de argumento da linha de comando

**Dado** uma credencial válida
**Quando** eu chamo `POST /auth/login` com identificador e senha
**Então** recebo um access token JWT assinado com EdDSA (Ed25519), com `kid` no cabeçalho e os claims `iss`, `sub`, `aud`, `iat`, `exp` (padrão de 15 minutos, configurável), `jti` em UUID v7, `typ: user` e `perms`

**Dado** um identificador inexistente ou uma senha errada
**Quando** eu chamo o login
**Então** a resposta é 401, idêntica nos dois casos e com tempo de resposta equivalente, para não revelar quais logins existem

**Dado** o serviço de Auth em execução
**Quando** eu chamo `GET /auth/.well-known/jwks.json`
**Então** recebo só as chaves públicas, nunca a privada
**E** o JWKS pode conter mais de uma chave, para permitir rotação sem invalidar tokens ainda válidos

**Dado** um serviço de Auth que sobe sem chave privada configurada
**Quando** ele inicia
**Então** a inicialização falha com mensagem clara

**Dado** um workspace novo
**Quando** eu rodo `tecton-admin new`
**Então** é gerado `apps/auth` como instância configurada de `@tecton/auth`, com dependência versionada (AD-4)

**Dado** qualquer log do serviço de Auth
**Quando** eu o inspeciono
**Então** senha, hash, Pepper, chave privada e tokens nunca aparecem

> **Notas:**
> - O JWKS é um endpoint padrão de mercado e por isso usa `GET` em caminho `.well-known`, fora da convenção RPC das actions.
> - Proteção contra força bruta fica com o rate limiting do Gateway (Epic 4, FR-19).
> - Nesta story, `perms` vem da credencial. No Epic 3, a fonte passa a ser o ACL do Directory.

### Story 2.3: Refresh token opaco com rotação e logout

Como **usuário final de um sistema construído com o Tecton**,
quero continuar autenticado sem digitar a senha a cada 15 minutos,
para usar o sistema sem interrupção e sem que um refresh token roubado sirva para alguma coisa por muito tempo.

**Critérios de Aceite:**

**Dado** um login bem-sucedido
**Quando** a resposta é enviada
**Então** ela traz um cookie de refresh com valor aleatório opaco de pelo menos 256 bits, com os atributos `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/auth/refresh`
**E** o corpo da resposta nunca contém o refresh token
**E** o banco do Auth guarda só o hash do refresh, com identificador de família e validade (padrão de 7 dias, configurável)

**Dado** um refresh válido
**Quando** eu chamo `POST /auth/refresh`
**Então** recebo um novo access token e um novo refresh, e o refresh anterior fica marcado como usado

**Dado** um refresh que já foi usado
**Quando** ele é apresentado de novo
**Então** a resposta é 401, toda a família desse refresh é revogada e um evento de segurança é registrado em log (em inglês)

**Dado** um refresh expirado ou desconhecido
**Quando** ele é apresentado
**Então** a resposta é 401

**Dado** uma sessão ativa
**Quando** eu chamo `POST /auth/logout`
**Então** a família do refresh é revogada e o cookie é apagado

**Dado** um serviço de domínio qualquer
**Quando** ele recebe requisições
**Então** nunca recebe nem processa refresh token (FR-12), garantido pelo `Path` do cookie e pela ausência do token no corpo das respostas

> **Nota:** a revogação imediata do access token no logout depende do `TokenRevocationStore` e é coberta na Story 2.5.

### Story 2.4: Verificação local do token em todo serviço

Como **dev de um domínio**,
quero que cada rota gerada verifique o token por conta própria antes de executar a action,
para que nenhum serviço confie em outro, nem no Gateway, para decidir quem está chamando (Zero Trust, AD-7).

**Critérios de Aceite:**

**Dado** uma rota gerada pela Story 1.7 para uma action sem `auth.public: true`
**Quando** chega uma requisição sem `Authorization: Bearer`
**Então** a resposta é 401 antes de chegar ao handler

**Dado** um token recebido
**Quando** o plugin de verificação do `@tecton/core` o processa
**Então** ele verifica a assinatura EdDSA com a chave pública do JWKS em cache, além de `exp`, `iss` e `aud`
**E** rejeita qualquer token com `alg` diferente de `EdDSA`, incluindo `none` e `HS256`

**Dado** um token com `kid` que não está no cache
**Quando** ele chega
**Então** o JWKS é buscado de novo uma única vez, com limite de frequência
**E** se o `kid` continuar desconhecido, a resposta é 401

**Dado** um serviço sem JWKS em cache e com o serviço de Auth inacessível
**Quando** chega uma requisição autenticada
**Então** ela é rejeitada, nunca aceita sem verificação (fail-closed)

**Dado** um token válido do usuário A e um header como `x-user-id` ou `x-claims` dizendo ser o usuário B
**Quando** a requisição é processada
**Então** o serviço trata a chamada como do usuário A e ignora o header (AD-7)

**Dado** uma chamada direta ao serviço, sem passar pelo Gateway, com token adulterado
**Quando** ela chega
**Então** o próprio serviço a rejeita com 401 (FR-13)

**Dado** um token válido sem a permissão exigida em `auth.requires`
**Quando** a action é chamada
**Então** a resposta é 403

**Dado** uma action com `auth.public: true`
**Quando** ela é chamada sem token
**Então** ela é executada

> **Nota:** o corpo das respostas 401 e 403 é provisório. O formato final RFC 9457 é do Epic 5 (FR-24).
