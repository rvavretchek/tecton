# Story 2.4: Verificação local do token em todo serviço

Status: ready-for-dev

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

- [ ] **T1. Dependência e erros (AC: 1, 4, 7)**
  - [ ] `@tecton/core` → `dependencies`: `jose` 6.2.12, versão fixa (aprovado pelo Boss em 2026-10-20; mesma versão do `@tecton/auth`).
  - [ ] `frameworkErrors.forbidden()` (403, `forbidden`, `tecton.error.forbidden`, mensagem genérica que não lista as permissões que faltam).
  - [ ] `frameworkErrors.authUnavailable()` (503, `auth-unavailable`, `tecton.error.authUnavailable`, header `retry-after: 5`).
  - [ ] Esquema das rotas e OpenAPI: respostas 403 e 503 ao lado das atuais. Para action não pública, `security: [{ bearerAuth: [] }]` e o esquema `bearerAuth` (`http`, `bearer`, `bearerFormat: JWT`) nos `components` do documento. Atualizar `openapi.test.ts`.
- [ ] **T2. Verificador (AC: 2, 3, 4, 6, 9)** — `packages/core/src/auth/token-verifier.ts`
  - [ ] `createTokenVerifier({ jwksUrl, issuer, audience, devMode, ca?, clock? })`:
    - valida a URL na criação: `https:` sempre; `http:` só com `devMode`; outra coisa é erro (`TokenVerifierConfigError`, sem ecoar credenciais de URL);
    - `issuer` e `audience` obrigatórios e sem espaço nas pontas (mesmos padrões do Auth: `urn:tecton:auth`, `urn:tecton:api`).
  - [ ] JWKS por `createRemoteJWKSet` do `jose`, com `[customFetch]`:
    - requisição por `node:https` (ou `node:http` em dev), que nunca segue redirecionamento (3xx é erro);
    - `ca` opcional (PEM) só nessa requisição, nunca global (ASR-4);
    - só 200 com `content-type` JSON; corpo limitado (64 KiB);
    - tempo limite de 5 s (`timeoutDuration`); cooldown de 30 s e cache de 10 min (padrões do `jose`).
  - [ ] `verify(authorizationHeader)`:
    - aceita só `Bearer <token>` (esquema sem diferença de maiúsculas, um espaço, token de até 8 KiB);
    - `jwtVerify` com `algorithms: ['EdDSA']`, `issuer`, `audience`, `typ: 'at+jwt'`, `requiredClaims: ['sub', 'jti', 'exp', 'iat']` e `currentDate` da `Clock`;
    - exige `kid` no cabeçalho, `typ: 'user'` e `perms` como lista de strings;
    - devolve `Principal { subject, permissions, tokenId, expiresAt }`, objeto novo a cada chamada;
    - erros: `InvalidTokenError` (todo motivo de token ruim, mensagem única) e `TokenVerificationUnavailableError` (JWKS inacessível, fora do ar, inválido). Separar os dois pelos erros do `jose` (`JWKSTimeout`, `JWKSInvalid`, falha de rede) contra os de token (`JWSSignatureVerificationFailed`, `JWTExpired`, `JWTClaimValidationFailed`, `JOSEAlgNotAllowed`, `JWKSNoMatchingKey`...).
  - [ ] `tokenVerifierFromEnv(env)`: `TECTON_JWKS_URL` (obrigatória), `TECTON_AUTH_ISSUER`, `TECTON_AUTH_AUDIENCE` (com os padrões), `TECTON_ENV` (`development` liga o modo dev; qualquer outro valor ou ausência é produção) e `TECTON_JWKS_CA_FILE` (opcional, PEM). Mensagens com o nome da variável, nunca o valor.
- [ ] **T3. Rotas (AC: 1, 5, 7, 8, 10)** — `packages/core/src/routes.ts`
  - [ ] `registerActionRoutes(app, manifest, handlers, { verifier })`:
    - manifest com action não pública e sem `verifier`: lança erro na hora do registro;
    - action não pública: hook `onRequest` (antes do parse e da validação do corpo) que verifica o header, guarda o `Principal` e confere `auth.requires` contra `principal.permissions` (todas exigidas);
    - `InvalidTokenError` vira `unauthorized()`, `TokenVerificationUnavailableError` vira `authUnavailable()` e falta de permissão vira `forbidden()`;
    - action pública: nenhum hook; o header `Authorization` é ignorado.
  - [ ] `ActionContext.principal?: Principal` (presente em toda action não pública). Nada no contexto vem de header de identidade.
  - [ ] Preservar: validação do corpo, 501 sem handler, `reply` no contexto, action sem input aceitando requisição sem corpo (2.3), handler de action desconhecida lançando erro.
- [ ] **T4. Servidor de domínio e workspace gerado (AC: 9, 10)**
  - [ ] `startDomainServer` aceita `verifier` (ou monta um por `tokenVerifierFromEnv(process.env)` quando não recebe) e o passa ao `registerActionRoutes`. Atualizar o comentário do `host` (a verificação agora existe; o padrão `127.0.0.1` continua).
  - [ ] Template `domain/src/main.ts`: o verificador sai do ambiente; a configuração é documentada no cabeçalho do arquivo.
  - [ ] `.env.example` do Dev Services (`envExample` em `packages/cli/src/dev-services.ts`): `TECTON_ENV=development` e `TECTON_JWKS_URL` apontando para o JWKS do `apps/auth` (`http://127.0.0.1:<porta do auth>/auth/.well-known/jwks.json`), com comentário dizendo que fora do dev a URL precisa ser `https`.
  - [ ] O serviço de Auth não muda: todas as actions dele são públicas, então ele não precisa de verificador.
- [ ] **T5. Fixtures de teste (ASR-4, R-02)** — `tests/support`
  - [ ] `tokenFactory(keys)`: token válido assinado com chave de teste e variantes forjadas — `alg: none`, HS256 com a chave pública como segredo, RS256, `kid` desconhecido, sem `kid`, `exp` vencido, `iss` e `aud` errados, `typ` de cabeçalho errado, `typ: service`, `perms` ausente ou malformado, assinatura adulterada, payload adulterado.
  - [ ] `jwksTls()`: gera com `openssl` (decisão do Boss) uma CA e um certificado de servidor para `127.0.0.1`/`localhost` numa pasta temporária, sobe um servidor HTTPS local que serve um JWKS (e, sob comando, um 3xx para outro host, 500, JSON inválido ou atraso), e devolve `{ url, ca, stop }`. Sem `openssl` no PATH, falha com mensagem clara. A CA só vale no verificador do teste; nunca `NODE_TLS_REJECT_UNAUTHORIZED` nem `NODE_EXTRA_CA_CERTS`.
  - [ ] Baixar o W2 do Epic 1 no `deferred-work.md` (fixture `jwksTls`).
- [ ] **T6. Testes (AC: todos)** — Test Design P0-010 (2), P0-011 (6), P0-012 (2), P0-013 (3), P0-014 (4)
  - [ ] Verificador (`token-verifier.test.ts`, contra `jwksTls`):
    - token válido devolve o `Principal`;
    - cada variante forjada do `tokenFactory` é `InvalidTokenError` (P0-011, R-02);
    - `kid` desconhecido: uma busca a mais, e uma rajada de `kid` desconhecidos dentro do cooldown não gera outra (contar as requisições no servidor de teste) (P0-012);
    - JWKS fora do ar, 500, JSON inválido, atraso maior que o limite e 3xx para outro host: `TokenVerificationUnavailableError` (P0-014);
    - `http` sem `devMode` falha na criação; com `devMode` funciona; `ftp:` falha sempre (P0-014);
    - header `Authorization` malformado, esquema errado, token enorme: `InvalidTokenError`.
  - [ ] Rotas (`routes.test.ts` ou arquivo novo, com verificador falso e com o real):
    - sem Bearer: 401 e o handler nem a validação rodam (corpo inválido sem token também dá 401, não 400) (P0-010);
    - token adulterado: 401 (P0-010);
    - token válido de A com `x-user-id: B`, `x-claims` e `Tecton-On-Behalf-Of`: o handler recebe o `principal` de A (P0-013);
    - sem uma das permissões de `requires`: 403; com todas: o handler roda (P0-013);
    - action pública sem token executa; com token inválido também executa (P0-013);
    - JWKS indisponível: 503 com `Retry-After` (P0-014);
    - registro sem verificador para manifest com action protegida: lança; manifest só com actions públicas: registra.
  - [ ] `tokenVerifierFromEnv`: variáveis obrigatórias, padrões, `TECTON_ENV` diferente de `development` mantém produção, mensagens com o nome da variável.
  - [ ] Geração (`new.generation.test.ts`): o domínio `finance` sobe com `TECTON_JWKS_URL` do `apps/auth` e `TECTON_ENV=development`; sem token responde 401; com um token assinado pela mesma chave do `apps/auth` (via `createAccessTokenIssuer` do `@tecton/auth`) e `finance:close`, responde 501.
  - [ ] Atualizar testes existentes que sobem domínio com action protegida sem verificador (`domain-server.test.ts`, `generate-domain`).
  - [ ] Segredos: o token nunca aparece em log nem em corpo de erro (`assertNoSecretsLeaked`).
  - [ ] Fase vermelha por mutação (A3), registrada no Debug Log. No mínimo: `algorithms` sem a restrição a `EdDSA`; sem checar `aud`; sem checar `typ: user`; hook em `preHandler` depois da validação do corpo; `requires` como OU; seguir redirecionamento; `http` aceito fora do dev; erro do JWKS tratado como 401 ou como aceito.
- [ ] **T7. Verificação final**
  - [ ] `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:persistence` (local pelo túnel se o ubt-host02 responder; os três bancos no CI) e `test:generation`.
  - [ ] Code review por story antes da 2.5 (retro A1).

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

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

## Change Log

- 2026-10-20: Story criada (Create Story), com as decisões do Boss sobre `jose` no core, `TECTON_ENV`, 503 e `openssl`.
