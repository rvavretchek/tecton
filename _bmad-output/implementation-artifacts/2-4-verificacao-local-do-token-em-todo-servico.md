---
baseline_commit: e82c35492bb2a784ea8fce874580587277588593
---

# Story 2.4: Verificação local do token em todo serviço

Status: done

## Story

Como **dev de um domínio**,
quero que cada rota gerada verifique o token por conta própria antes de executar a action,
para que nenhum serviço confie em outro, nem no Gateway, para decidir quem está chamando (Zero Trust, AD-7, FR-13).

## Acceptance Criteria

1. **Sem token, 401 antes de tudo.** Dado uma rota gerada para uma action sem `auth.public: true`, quando chega uma requisição sem `Authorization: Bearer <token>`, então a resposta é 401 (`WWW-Authenticate: Bearer`) antes do handler e antes da validação do corpo. Quem não se autenticou não aprende o contrato da action.
2. **Verificação completa.** Dado um token recebido, quando o verificador do `@tecton/core` o processa, então:
   - a assinatura EdDSA é verificada com a chave pública do JWKS em cache;
   - `exp`, `iss` e `aud` são conferidos, e o cabeçalho precisa ter `typ: at+jwt` e `kid`;
   - os claims precisam ter `sub`, `jti`, `typ: user` e `perms` (lista de strings);
   - todo token com `alg` diferente de `EdDSA` é rejeitado, incluindo `none`, `HS256` (inclusive com a chave pública como segredo) e `RS256`.
3. **`kid` desconhecido.** Dado um token com `kid` que não está no cache, quando ele chega, então o JWKS é buscado de novo uma única vez, com limite de frequência (no máximo uma busca a cada 30 s, padrão do `jose`). Se o `kid` continuar desconhecido, a resposta é 401.
   - **Emenda do code review (2026-10-20):** o limite conta desde a última tentativa de busca, com ou sem sucesso. Um `kid` desconhecido logo depois de uma busca não dispara outra e é 401; a rotação em três passos do Auth publica a chave nova antes de assinar, então um `kid` legítimo não cai nesse caso. Depois de uma busca que falhou, nenhuma outra começa por 5 s (503 imediato).
4. **Fail-closed.** Dado um serviço sem JWKS em cache e com o Auth inacessível (ou respondendo erro, conteúdo inválido ou fora do tempo limite), quando chega uma requisição autenticada, então ela é recusada com **503** e `Retry-After`, nunca aceita sem verificação. (Decisão do Boss, 2026-10-20: 503 diz a verdade e evita que a SPA tente refresh e deslogue o usuário durante uma queda do Auth.)
5. **Identidade só do token.** Dado um token válido do usuário A e um header como `x-user-id`, `x-claims` ou `Tecton-On-Behalf-Of` dizendo ser o usuário B, quando a requisição é processada, então o serviço trata a chamada como do usuário A e ignora o header (AD-7). O handler recebe a identidade verificada no contexto (`principal`), nunca um header.
6. **Chamada direta adulterada.** Dado uma chamada direta ao serviço, sem passar pelo Gateway, com token adulterado (assinatura, claims ou cabeçalho alterados), quando ela chega, então o próprio serviço a rejeita com 401 (FR-13).
7. **403 por permissão.** Dado um token válido sem alguma das permissões exigidas em `auth.requires`, quando a action é chamada, então a resposta é 403. Todas as permissões listadas são exigidas (E lógico).
8. **Action pública.** Dado uma action com `auth.public: true`, quando ela é chamada sem token, então ela é executada. Com um token, ele é ignorado (nem verificado).
9. **Transporte do JWKS.** Dado a URL do JWKS configurada no serviço:
   - fora do modo de desenvolvimento, o startup falha se a URL não for `https`;
   - o modo de desenvolvimento é **só** `TECTON_ENV=development` (decisão do Boss, 2026-10-20); sem a variável, valem as regras de produção;
   - um redirecionamento do JWKS é recusado (qualquer 3xx, inclusive para outro host), para que ninguém na rede interna entregue uma chave falsa (AD-7).
10. **Sem verificador, sem rota protegida.** Dado um manifest com alguma action não pública, quando as rotas são registradas sem verificador configurado, então o registro falha com mensagem clara (fail-closed: nunca uma rota protegida sem verificação).

> **Nota (epics.md):** o corpo das respostas 401, 403 e 503 é provisório. O formato final RFC 9457 é do Epic 5 (FR-24).

## Tasks / Subtasks

- [x] **T1. Dependência e erros (AC: 1, 4, 7)**
  - [x] `@tecton/core` → `dependencies`: `jose` 6.2.12, versão fixa (aprovado pelo Boss em 2026-10-20; mesma versão do `@tecton/auth`).
  - [x] `frameworkErrors.forbidden()` (403, `forbidden`, `tecton.error.forbidden`, mensagem genérica que não lista as permissões que faltam).
  - [x] `frameworkErrors.authUnavailable()` (503, `auth-unavailable`, `tecton.error.authUnavailable`, header `retry-after: 5`).
  - [x] Esquema das rotas e OpenAPI: respostas 403 e 503 ao lado das atuais. Para action não pública, `security: [{ bearerAuth: [] }]` e o esquema `bearerAuth` (`http`, `bearer`, `bearerFormat: JWT`) nos `components` do documento. Atualizar `openapi.test.ts`.
- [x] **T2. Verificador (AC: 2, 3, 4, 6, 9)** — `packages/core/src/auth/token-verifier.ts`
  - [x] `createTokenVerifier({ jwksUrl, issuer, audience, devMode, ca?, clock? })`:
    - valida a URL na criação: `https:` sempre; `http:` só com `devMode`; outra coisa é erro (`TokenVerifierConfigError`, sem ecoar credenciais de URL);
    - `issuer` e `audience` obrigatórios e sem espaço nas pontas (mesmos padrões do Auth: `urn:tecton:auth`, `urn:tecton:api`).
  - [x] JWKS por `createRemoteJWKSet` do `jose`, com `[customFetch]`:
    - requisição por `node:https` (ou `node:http` em dev), que nunca segue redirecionamento (3xx é erro);
    - `ca` opcional (PEM) só nessa requisição, nunca global (ASR-4);
    - só 200 com `content-type` JSON; corpo limitado (64 KiB);
    - tempo limite de 5 s (`timeoutDuration`); cooldown de 30 s e cache de 10 min (padrões do `jose`).
    - **Emenda do code review:** cache de 5 min (igual ao `max-age=300` do JWKS do Auth) e cache próprio sobre o `createLocalJWKSet` do `jose`, no lugar do `createRemoteJWKSet` (ver o Debug Log).
  - [x] `verify(authorizationHeader)`:
    - aceita só `Bearer <token>` (esquema sem diferença de maiúsculas, um espaço, token de até 8 KiB);
    - `jwtVerify` com `algorithms: ['EdDSA']`, `issuer`, `audience`, `typ: 'at+jwt'`, `requiredClaims: ['sub', 'jti', 'exp', 'iat']` e `currentDate` da `Clock`;
    - exige `kid` no cabeçalho, `typ: 'user'` e `perms` como lista de strings;
    - devolve `Principal { subject, permissions, tokenId, expiresAt }`, objeto novo a cada chamada;
    - erros: `InvalidTokenError` (todo motivo de token ruim, mensagem única) e `TokenVerificationUnavailableError` (JWKS inacessível, fora do ar, inválido). Separar os dois pelos erros do `jose` (`JWKSTimeout`, `JWKSInvalid`, falha de rede) contra os de token (`JWSSignatureVerificationFailed`, `JWTExpired`, `JWTClaimValidationFailed`, `JOSEAlgNotAllowed`, `JWKSNoMatchingKey`...).
  - [x] `tokenVerifierFromEnv(env)`: `TECTON_JWKS_URL` (obrigatória), `TECTON_AUTH_ISSUER`, `TECTON_AUTH_AUDIENCE` (com os padrões), `TECTON_ENV` (`development` liga o modo dev; qualquer outro valor ou ausência é produção) e `TECTON_JWKS_CA_FILE` (opcional, PEM). Mensagens com o nome da variável, nunca o valor.
- [x] **T3. Rotas (AC: 1, 5, 7, 8, 10)** — `packages/core/src/routes.ts`
  - [x] `registerActionRoutes(app, manifest, handlers, { verifier })`:
    - manifest com action não pública e sem `verifier`: lança erro na hora do registro;
    - action não pública: hook `onRequest` (antes do parse e da validação do corpo) que verifica o header, guarda o `Principal` e confere `auth.requires` contra `principal.permissions` (todas exigidas);
    - `InvalidTokenError` vira `unauthorized()`, `TokenVerificationUnavailableError` vira `authUnavailable()` e falta de permissão vira `forbidden()`;
    - action pública: nenhum hook; o header `Authorization` é ignorado.
  - [x] `ActionContext.principal?: Principal` (presente em toda action não pública). Nada no contexto vem de header de identidade.
  - [x] Preservar: validação do corpo, 501 sem handler, `reply` no contexto, action sem input aceitando requisição sem corpo (2.3), handler de action desconhecida lançando erro.
- [x] **T4. Servidor de domínio e workspace gerado (AC: 9, 10)**
  - [x] `startDomainServer` aceita `verifier` (ou monta um por `tokenVerifierFromEnv(process.env)` quando não recebe) e o passa ao `registerActionRoutes`. Atualizar o comentário do `host` (a verificação agora existe; o padrão `127.0.0.1` continua).
  - [x] Template `domain/src/main.ts`: o verificador sai do ambiente; a configuração é documentada no cabeçalho do arquivo.
  - [x] `.env.example` do Dev Services (`envExample` em `packages/cli/src/dev-services.ts`): `TECTON_ENV=development` e `TECTON_JWKS_URL` apontando para o JWKS do `apps/auth` (`http://127.0.0.1:<porta do auth>/auth/.well-known/jwks.json`), com comentário dizendo que fora do dev a URL precisa ser `https`.
  - [x] O serviço de Auth não muda: todas as actions dele são públicas, então ele não precisa de verificador.
- [x] **T5. Fixtures de teste (ASR-4, R-02)** — `tests/support`
  - [x] `tokenFactory(keys)`: token válido assinado com chave de teste e variantes forjadas — `alg: none`, HS256 com a chave pública como segredo, RS256, `kid` desconhecido, sem `kid`, `exp` vencido, `iss` e `aud` errados, `typ` de cabeçalho errado, `typ: service`, `perms` ausente ou malformado, assinatura adulterada, payload adulterado.
  - [x] `jwksTls()`: gera com `openssl` (decisão do Boss) uma CA e um certificado de servidor para `127.0.0.1`/`localhost` numa pasta temporária, sobe um servidor HTTPS local que serve um JWKS (e, sob comando, um 3xx para outro host, 500, JSON inválido ou atraso), e devolve `{ url, ca, stop }`. Sem `openssl` no PATH, falha com mensagem clara. A CA só vale no verificador do teste; nunca `NODE_TLS_REJECT_UNAUTHORIZED` nem `NODE_EXTRA_CA_CERTS`.
  - [x] Baixar o W2 do Epic 1 no `deferred-work.md` (fixture `jwksTls`).
- [x] **T6. Testes (AC: todos)** — Test Design P0-010 (2), P0-011 (6), P0-012 (2), P0-013 (3), P0-014 (4)
  - [x] Verificador (`token-verifier.test.ts`, contra `jwksTls`):
    - token válido devolve o `Principal`;
    - cada variante forjada do `tokenFactory` é `InvalidTokenError` (P0-011, R-02);
    - `kid` desconhecido: uma busca a mais, e uma rajada de `kid` desconhecidos dentro do cooldown não gera outra (contar as requisições no servidor de teste) (P0-012);
    - JWKS fora do ar, 500, JSON inválido, atraso maior que o limite e 3xx para outro host: `TokenVerificationUnavailableError` (P0-014);
    - `http` sem `devMode` falha na criação; com `devMode` funciona; `ftp:` falha sempre (P0-014);
    - header `Authorization` malformado, esquema errado, token enorme: `InvalidTokenError`.
  - [x] Rotas (`routes.test.ts` ou arquivo novo, com verificador falso e com o real):
    - sem Bearer: 401 e o handler nem a validação rodam (corpo inválido sem token também dá 401, não 400) (P0-010);
    - token adulterado: 401 (P0-010);
    - token válido de A com `x-user-id: B`, `x-claims` e `Tecton-On-Behalf-Of`: o handler recebe o `principal` de A (P0-013);
    - sem uma das permissões de `requires`: 403; com todas: o handler roda (P0-013);
    - action pública sem token executa; com token inválido também executa (P0-013);
    - JWKS indisponível: 503 com `Retry-After` (P0-014);
    - registro sem verificador para manifest com action protegida: lança; manifest só com actions públicas: registra.
  - [x] `tokenVerifierFromEnv`: variáveis obrigatórias, padrões, `TECTON_ENV` diferente de `development` mantém produção, mensagens com o nome da variável.
  - [x] Geração (`new.generation.test.ts`): o domínio `finance` sobe com `TECTON_JWKS_URL` do `apps/auth` e `TECTON_ENV=development`; sem token responde 401; com um token assinado pela mesma chave do `apps/auth` (via `createAccessTokenIssuer` do `@tecton/auth`) e `finance:close`, responde 501.
  - [x] Atualizar testes existentes que sobem domínio com action protegida sem verificador (`domain-server.test.ts`, `generate-domain`).
  - [x] Segredos: o token nunca aparece em log nem em corpo de erro (`assertNoSecretsLeaked`).
  - [x] Fase vermelha por mutação (A3), registrada no Debug Log. No mínimo: `algorithms` sem a restrição a `EdDSA`; sem checar `aud`; sem checar `typ: user`; hook em `preHandler` depois da validação do corpo; `requires` como OU; seguir redirecionamento; `http` aceito fora do dev; erro do JWKS tratado como 401 ou como aceito.
- [x] **T7. Verificação final**
  - [x] `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:persistence` (local pelo túnel se o ubt-host02 responder; os três bancos no CI) e `test:generation`.
  - [x] Code review por story antes da 2.5 (retro A1).

### Review Findings (code review da Story 2.4, 2026-10-20)

> Camadas: Blind Hunter, Edge Case Hunter e Acceptance Auditor (os três pararam no limite de uso da sessão e foram retomados).

- [x] [Review][Decision] D1 Configuração por app — o domínio gerado lia o `.env` inteiro do workspace, com a chave de assinatura e o Pepper do Auth e as URLs de todos os bancos (os três revisores). Boss (2026-10-20): **um `.env` por app**. A raiz fica só com o que é comum e não é segredo (`TECTON_ENV`, `TECTON_JWKS_URL`); `apps/auth/.env` com o banco do Auth, o Pepper, a chave e `PORT=3001`; `apps/domains/<d>/.env` só com o banco do domínio; cada `start` lê a raiz e depois o próprio; o Dev Services gera um `.env.example` por app.
- [x] [Review][Patch] P1 (alta) Aplicar a D1: templates (`start` e `migrate` do `apps/auth`, `start` do domínio), `writeDevServices` gerando `.env.example` na raiz, em `apps/auth` e em cada domínio, `.gitignore` cobrindo `.env` em toda pasta, `JWKS_URL` na porta 3001, e o teste de geração com um `.env` por app [packages/cli/src/dev-services.ts, templates]
- [x] [Review][Patch] P2 (média) Com o JWKS falhando, o cooldown do `jose` nunca começa (só conta busca bem-sucedida): cada requisição dispara uma nova busca de até 5 s contra o Auth. Correção: depois de uma falha, recusar com 503 sem buscar por 5 s (o `Retry-After`) [token-verifier.ts]
- [x] [Review][Patch] P3 (média) O "follow redirect" do A3 não foi testado de verdade: o 3xx aponta para um host que nem resolve. Correção: o 3xx aponta para um segundo servidor local com a chave de um atacante; um token assinado por ela nunca é aceito [tests/support/jwks-tls.ts, token-verifier.test.ts]
- [x] [Review][Patch] P4 (média) A forja "tampered signature" pode sair idêntica à assinatura válida (bits de preenchimento do último caractere base64url): teste instável em ~0,4% das execuções. Correção: alterar um caractere do meio [tests/support/tokens.ts]
- [x] [Review][Patch] P5 (média) `kid` duplicado no JWKS (erro do Auth na rotação) vira 401 para todo token e faz o cliente deslogar. Correção: `JWKSMultipleMatchingKeys` é indisponibilidade (503) [token-verifier.ts]
- [x] [Review][Patch] P6 (média) Sem teste do cache vencido com o Auth fora (o README promete 503) [token-verifier.test.ts]
- [x] [Review][Patch] P7 (baixa) Causa do 503 descartada: nenhum log distingue CA errada de queda. Correção: `cause` no erro e `warn` com nome e código no hook das rotas, sem URL nem token [token-verifier.ts, routes.ts]
- [x] [Review][Patch] P8 (baixa) `TECTON_JWKS_CA_FILE` vazio ou sem PEM válido passa na subida. Correção: validar como certificado X.509 na criação [token-verifier.ts]
- [x] [Review][Patch] P9 (baixa) `jwksTimeoutMs` 0, negativo ou fracionário passa sem validação [token-verifier.ts]
- [x] [Review][Patch] P10 (baixa) O `fetch` próprio não trata conexão fechada no meio do corpo (`close` sem `end`), drena corpos de 3xx/5xx sem limite e não confere `Content-Length` acima de 64 KiB [token-verifier.ts]
- [x] [Review][Patch] P11 (baixa) Manifest montado à mão com `requires: []` em action não pública deixa passar qualquer token; e as duas checagens de "é pública?" (`domain-server` e `routes`) divergem. Correção: recusar no registro e usar uma só função [routes.ts, domain-server.ts]
- [x] [Review][Patch] P12 (baixa) `iat` no futuro aceito e nenhuma tolerância de relógio entre serviços. Correção: `clockTolerance` de 30 s e recusa de `iat` além disso [token-verifier.ts]
- [x] [Review][Patch] P13 (baixa) A cópia do `principal` é rasa: as datas são os mesmos objetos [routes.ts]
- [x] [Review][Patch] P14 (baixa) Erros de URL do `tokenVerifierFromEnv` não citam `TECTON_JWKS_URL` [token-verifier.ts]
- [x] [Review][Patch] P15 (baixa) Forjas mais fiéis: HS256 com a chave pública em PEM como segredo, cabeçalho alterado mantendo o `kid` válido, `perms` com item que não é string [tests/support/tokens.ts]
- [x] [Review][Patch] P16 (baixa) OpenAPI declara `bearerAuth` mesmo sem action protegida [openapi.ts]
- [x] [Review][Patch] P17 (baixa) Ponto de extensão da revogação (2.5) não marcado no verificador [token-verifier.ts]
- [x] [Review][Patch] P18 (baixa) Registros: emendar o AC 3 e a T2 (cooldown desde a última busca bem-sucedida; cache de 5 min, não 10), anotar o `issuedAt` a mais no `Principal` e registrar a mutação só do `algorithms` [story]
- [x] [Review][Defer] W1 401 e 403 sem os atributos do RFC 6750 (`error="invalid_token"`, `insufficient_scope`) [errors/tecton-error.ts] — adiado: formato de erro do Epic 5 (FR-24, RFC 9457)
- Descartados:
  - chave malformada no JWKS dá 503 (o JWKS está quebrado; 503 é o certo);
  - `kid` inventado vira 503 com o Auth fora (inevitável; a P2 limita o custo);
  - verificador próprio que devolve `principal` sem `permissions` dá 500 (fail-closed; erro do código do dev);
  - `Cache-Control` não lido do Auth (constante documentada; a revogação imediata é da 2.5);
  - `principal` opcional no tipo (o handler de action pública também usa o contexto);
  - `http` em dev para qualquer host (em Docker o Auth tem nome de serviço, não loopback);
  - cabeçalhos do `jose` (User-Agent) substituídos no `fetch` próprio;
  - `.env.example` sem JWKS quando não há `apps/auth` (a D1 põe o JWKS na raiz sempre);
  - mutação equivalente do 3xx aceito (a P3 testa o seguimento de verdade).

## Dev Notes

### Decisões desta story

- **`jose` no `@tecton/core` (Boss, 2026-10-20):** versão fixa 6.2.12, igual ao Auth. O `createRemoteJWKSet` já traz o que a story pede: `redirect: "manual"` (um 3xx vira erro, não é seguido), nova busca no máximo a cada 30 s quando aparece `kid` desconhecido (`cooldownDuration`), cache de 10 min (`cacheMaxAge`) e tempo limite de 5 s. O `[customFetch]` é o ponto de injeção da requisição própria (CA, limite de corpo, `http` só em dev).
- **`TECTON_ENV=development` (Boss):** opt-in explícito. Esquecer a variável nunca afrouxa a segurança.
- **503 com `Retry-After` quando a verificação está indisponível (Boss).**
- **Certificado de teste por `openssl` (Boss):** sem dependência nova.
- **Verificação antes do corpo (`onRequest`):** quem não se autenticou recebe 401 mesmo com corpo inválido; nunca 400 revelando o contrato.
- **`requires` em E lógico:** toda permissão listada é exigida. Uma action que aceite qualquer uma de várias permissões fica para quando houver caso real.
- **Só `typ: user` por enquanto:** o token de serviço (`typ: service`, `call:<domínio>`) é da Story 2.7, que estende o verificador.
- **Revogação fora:** checar o `jti` contra o `TokenRevocationStore` é da 2.5; o verificador deve deixar esse ponto de extensão óbvio (um passo depois do `jwtVerify`).
- **Cache vencido com Auth fora:** depois de 10 min sem conseguir buscar o JWKS, o `jose` não usa as chaves antigas; toda requisição autenticada passa a ser 503. É o comportamento fail-closed esperado; documentar no README do `@tecton/core`.

### Código existente que esta story toca

| Arquivo | Hoje | Muda | Preservar |
|---|---|---|---|
| `packages/core/src/routes.ts` | rotas por action, `preValidation` que aceita corpo ausente em action sem input, `reply` no contexto, 501 sem handler, esquema com 400/401/500/501 | opção `verifier`, hook `onRequest` nas actions protegidas, `principal`, 403 e 503 no esquema | tudo o que está em "Hoje"; `registerActionRoutes(app, manifest, handlers)` continua funcionando para manifest só com actions públicas (o Auth usa assim) |
| `packages/core/src/errors/tecton-error.ts` | `unauthorized()` com `WWW-Authenticate` e campo `headers` | `forbidden()`, `authUnavailable()` | erros e mensagens existentes |
| `packages/core/src/openapi.ts` | documento OpenAPI das actions | `security` e `bearerAuth` | testes atuais do OpenAPI |
| `packages/core/src/domain-server.ts` | sobe o domínio em `127.0.0.1` sem verificação | recebe ou monta o verificador | `loadDomainManifest`, padrão de `host` e `port` |
| `packages/cli/templates/domain/src/main.ts` | `startDomainServer` com `PORT`/`HOST` | verificador pelo ambiente | desligamento gracioso, validação de `PORT` |
| `packages/cli/src/dev-services.ts` | `.env.example` com URLs de banco e segredos do Auth comentados | `TECTON_ENV` e `TECTON_JWKS_URL` | o resto do arquivo gerado |
| `tests/support` | `clock`, `containers`, `keys` (`ed25519KeyPairPem`), `secrets`, `network-faults` | `tokenFactory`, `jwksTls` | exports atuais |

### Fora desta story (não fazer)

- Revogação por `jti` e por sujeito (2.5); token de serviço e `call:<domínio>` (2.7); `ServiceClient` (Epic 3).
- Suíte gerada de Zero Trust sobre todos os manifests (R-01, Epics 2 e 3); `withDependencyDown('jwks')` (W3 do Epic 1) só se sair de graça.
- Formato RFC 9457 dos erros (Epic 5).

### Padrões a seguir (Epic 1 e Stories 2.1 a 2.3)

- Código, mensagens, logs e README em inglês. Nunca `\uXXXX` em arquivo novo; cuidado com scripts que convertem `\n` e `\r`.
- Resultado novo a cada chamada; segredos nunca em mensagem nem log (`assertNoSecretsLeaked`); o `Authorization` já é redigido nos logs do Auth (`LOG_REDACTION`); conferir o mesmo para o servidor de domínio.
- Datas da `Clock` (o `jwtVerify` recebe `currentDate`). O cooldown do `jose` usa `Date.now`: nos testes de cooldown, usar timers falsos do Vitest ou contar requisições dentro da janela real.
- Erro único por classe de motivo (como `InvalidCredentialsError` e `InvalidRefreshTokenError`): o 401 nunca diz qual parte do token falhou.
- Docker remoto: túnel SSH do `.env.example`. Esta story não precisa de banco; a persistência roda igual no CI.

### Perguntas ao Boss (antes do desenvolvimento)

1. `jose` 6.2.12 no `@tecton/core`: **aprovado** (2026-10-20).
2. Modo de desenvolvimento: **`TECTON_ENV=development`** (2026-10-20).
3. JWKS indisponível: **503 com `Retry-After`** (2026-10-20).
4. Certificado de teste: **`openssl` na hora do teste** (2026-10-20).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4], Stories 2.5 (revogação no verificador), 2.7 (token de serviço) e 3.6 (Gateway repassa o `Authorization` original)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#AD-7] (verificação em todo serviço, EdDSA, JWKS por `https` sem redirecionamento, nunca HS256), AD-1, AD-3
- [Source: _bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md#FR-13]
- [Source: _bmad-output/test-artifacts/test-design-qa.md#P0-010 a P0-014], `tokenFactory` e `jwksTls`; `test-design-architecture.md` R-01, R-02, ASR-4, TC-4
- [Source: _bmad-output/implementation-artifacts/2-2b-servico-tecton-auth-login-access-token-eddsa-e-jwks.md] (formato do token: `typ: at+jwt`, `kid` por thumbprint, claims) e `2-3-refresh-token-opaco-com-rotacao-e-logout.md`
- [Source: RFC 8725 (JWT BCP: `alg` fixo, `typ` explícito), RFC 9068 (`at+jwt`), RFC 6750 (Bearer)]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- **Desvio do AC 3, semântica do cooldown do `jose`:** a nova busca por `kid` desconhecido só acontece quando a última busca tem mais de 30 s. Logo depois de uma busca, um `kid` desconhecido é 401 sem buscar de novo. O limite de frequência vale desde a última busca, e não desde a primeira falha. O AC continua atendido (uma busca, com limite), e a rotação em três passos do Auth publica a chave nova 5 minutos antes de assinar, então nenhum verificador vê um `kid` legítimo desconhecido. Os testes movem o relógio do sistema (timers falsos do Vitest só para `Date`).
- **Cache de 5 min, e não 10:** `cacheMaxAge` alinhado ao `Cache-Control: max-age=300` do JWKS do Auth.
- **`jwksTimeoutMs`:** opção a mais no verificador (padrão 5000), para o teste de JWKS lento não esperar 5 s.
- **`openssl` desta máquina:** o `OPENSSL_CONF` global aponta para um arquivo do PostgreSQL que não existe, e o `openssl req` falhava. A fixture usa uma configuração mínima própria, numa pasta temporária. Com essa configuração, a CA saiu sem `basicConstraints CA:TRUE` ("unsuitable certificate purpose"); as extensões da CA e do certificado de servidor agora são explícitas.
- **Script Python e `\n`:** duas vezes um heredoc gravou quebra de linha real dentro de string TypeScript (erro já registrado na 2.2b); corrigido com a ferramenta de edição.
- **OpenAPI:** o `buildOpenApiDocument` registra as rotas só para descrevê-las; passa um verificador que recusa tudo, porque o registro agora exige verificador para action protegida.
- **Domínio gerado lê o `.env`:** o `start` do template do domínio passou a `node --env-file-if-exists=../../../.env dist/main.js`, como o `apps/auth` (P5 da 2.2b); sem isso, o `TECTON_JWKS_URL` do `.env` nunca chegaria ao serviço.
- **Fase vermelha por mutação (A3),** cada uma restaurada:

  | Mutação | Testes que falharam |
  |---|---|
  | sem checar `aud` | 2 |
  | sem checar `typ: user` | 2 |
  | sem checar o `typ` do cabeçalho | 4 |
  | verificação em `preHandler` (depois do corpo) | 1 |
  | `requires` como OU | 2 |
  | `http` aceito fora do dev | 4 |
  | JWKS indisponível como 401 | 1 |
  | JWKS indisponível aceito | 9 |
  | registro sem verificador aceito | 1 |
  | sem limite de corpo do JWKS | 1 |
  | pré-checagem do `alg` e `algorithms` removidos juntos | 4 |
  | `principal` compartilhado entre requisições | 1 |

  Duas mutações sobreviveram por serem equivalentes, ambas por haver duas camadas:
  - remover só a pré-checagem do `alg`: o `jwtVerify` com `algorithms: ['EdDSA']` também recusa (removendo as duas, 4 testes falham);
  - aceitar um 3xx no `fetch` próprio: o `jose` exige status 200 e recusa igual.

  A mutação do `principal` compartilhado sobreviveu na primeira rodada porque o verificador real já devolve um objeto novo; o teste passou a usar um verificador falso que reutiliza o mesmo objeto, e agora a pega.

- **Code review (2026-10-20):**
  - **D1, um `.env` por app (Boss):** `rootEnvExample` (só `TECTON_VALKEY_URL`, `TECTON_ENV` e `TECTON_JWKS_URL`) e `appEnvExample` por app; `apps/auth/.env.example` com `PORT=3001` e os segredos comentados; cada domínio com o próprio banco. O `start` (e o `migrate` do Auth) lê `--env-file-if-exists` da raiz e depois do app: o arquivo de depois prevalece e o ambiente do shell ganha dos dois (conferido no Node 24). O teste de geração prova que o processo do domínio não recebe nenhuma variável `TECTON_AUTH_*`.
  - **Cache próprio do JWKS (P2, P5, P10):** o `createRemoteJWKSet` do `jose` só marca o cooldown em busca bem-sucedida, então, com o Auth fora, cada requisição disparava uma busca nova. O verificador passou a usar um cache pequeno sobre o `createLocalJWKSet` (que continua escolhendo a chave): cooldown desde a última tentativa, 5 s sem buscar depois de uma falha, buscas simultâneas unidas, `fetch` próprio que acerta uma vez só (fim, erro, `close`, `timeout`), recusa 3xx, não-JSON e `Content-Length` acima de 64 KiB. `kid` duplicado e JWKS inválido são 503.
  - **`Principal.issuedAt`:** campo a mais em relação à T2 (`iat`), copiado por requisição junto com `expiresAt`.
  - **Fase vermelha das correções (A3),** cada uma restaurada:

    | Mutação | Testes que falharam |
    |---|---|
    | segredo do Auth no `.env` da raiz (P1) | 1 |
    | sem backoff depois de falha (P2) | 1 |
    | seguir o redirecionamento de verdade (P3) | 2 |
    | `kid` duplicado como 401 (P5) | 1 |
    | chaves vencidas usadas (P6) | 1 |
    | sem log do motivo do 503 (P7) | 1 |
    | CA sem validação (P8) | 1 |
    | `jwksTimeoutMs` sem validação (P9) | 4 |
    | `requires` vazio aceito (P11) | 1 |
    | `iat` no futuro aceito (P12) | 1 |
    | datas do `principal` compartilhadas (P13) | 1 |
    | erro sem o nome da variável (P14) | 1 |
    | `perms` com item que não é string (P15) | 2 |
    | `bearerAuth` sempre no OpenAPI (P16) | 1 |

    Duas sobreviveram por serem equivalentes:
    - tirar o tratamento de `close` (P10): o Node 24 emite `error` na resposta abortada, e o `fail` é chamado igual;
    - tirar só o `algorithms: ['EdDSA']`: a pré-checagem do `alg` recusa sozinha (as duas juntas: 4 testes falham, ver a tabela do Dev Story).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Verificador (`@tecton/core`, `auth/token-verifier.ts`):**
  - `createTokenVerifier`: URL do JWKS validada na criação (`https`; `http` só com `devMode`); `issuer` e `audience` com os padrões do Auth;
  - JWKS pelo `createRemoteJWKSet` do `jose` com `fetch` próprio por `node:http(s)`: CA opcional só nessa requisição, nunca segue redirecionamento, só 200 com JSON, até 64 KiB, 5 s de limite, cache de 5 min e nova busca no máximo a cada 30 s;
  - `verify`: `Bearer` de até 8 KiB; `alg: EdDSA` e `kid` obrigatórios; `typ: at+jwt`; `iss`, `aud`, `exp` pela `Clock`; `sub`, `jti`, `iat`, `typ: user` e `perms`;
  - `InvalidTokenError` (todo token ruim) e `TokenVerificationUnavailableError` (chaves indisponíveis);
  - `tokenVerifierFromEnv`: `TECTON_JWKS_URL`, `TECTON_AUTH_ISSUER`, `TECTON_AUTH_AUDIENCE`, `TECTON_ENV` e `TECTON_JWKS_CA_FILE`.
- **Rotas:** hook `onRequest` nas actions protegidas (antes do corpo); 401, 403 (todas as permissões exigidas) e 503 com `Retry-After`; `principal` no contexto, copiado por requisição; registro recusado sem verificador; actions públicas sem hook. OpenAPI com `bearerAuth`, 403 e 503.
- **Erros:** `frameworkErrors.forbidden()` e `authUnavailable()`.
- **Servidor de domínio e workspace:** `startDomainServer` monta o verificador pelo ambiente quando há action protegida; template do domínio documenta as variáveis e lê o `.env`; `.env.example` com `TECTON_ENV=development` e `TECTON_JWKS_URL` do `apps/auth`.
- **Fixtures (`tests/support`):** `tokenFactory` (válido e 19 forjados, assinados com `node:crypto`) e `jwksTls` (CA e certificado por `openssl`, servidor HTTPS com modos de falha e contagem de requisições). W2 do Epic 1 baixado.
- **Testes:** verificador (49), rotas protegidas (34), servidor de domínio (4 novos), OpenAPI (1), Dev Services (1), geração (domínio 401 sem token e 501 com token do `apps/auth`).
- **Verificação local:** build, typecheck, `check:deps` (137 módulos), `lint:examples`, `validate:asyncapi`, `test` (738) e `test:generation` (3). Persistência: pelo CI (a story não toca banco).
- **Code review (A1):** 1 decisão (D1, um `.env` por app), 18 patches (P1 a P18), 1 adiado (W1 no `deferred-work.md`) e 9 descartados, com as três camadas de revisão.
- **Verificação depois do review:** build, typecheck, `check:deps`, `lint:examples`, `validate:asyncapi`, `test` (764) e `test:generation` (3).

### File List

- `packages/core/package.json` (`jose` 6.2.12), `pnpm-lock.yaml`
- `packages/core/src/auth/token-verifier.ts` e teste (novos)
- `packages/core/src/routes.ts`, `routes.test.ts` (modificados); `routes-auth.test.ts` (novo)
- `packages/core/src/errors/tecton-error.ts`, `openapi.ts`, `openapi.test.ts`, `domain-server.ts`, `domain-server.test.ts`, `index.ts` (modificados)
- `packages/core/README.md` (novo)
- `packages/cli/templates/domain/{package.json,src/main.ts}`, `templates/workspace/apps/auth/{package.json,src/main.ts}` (modificados)
- `packages/cli/src/dev-services.ts`, `dev-services.test.ts`, `commands/{generate-domain,new,new.generation}.test.ts` (modificados)
- `packages/auth/README.md` (modificado: um `.env` por app)
- `tests/support/{tokens,jwks-tls}.ts` (novos), `tests/support/index.ts` (modificado)
- `_bmad-output/implementation-artifacts/deferred-work.md`, esta story, `sprint-status.yaml`

## Change Log

- 2026-10-20: Story criada (Create Story), com as decisões do Boss sobre `jose` no core, `TECTON_ENV`, 503 e `openssl`.
- 2026-10-20: Story implementada (Dev Story); status → review.
- 2026-10-20: Code review: D1 decidida pelo Boss (um `.env` por app), P1 a P18 aplicados, W1 adiado; status → done.
