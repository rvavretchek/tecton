# Story 2.3: Refresh token opaco com rotação e logout

Status: ready-for-dev

## Story

Como **usuário final de um sistema construído com o Tecton**,
quero continuar autenticado sem digitar a senha a cada 15 minutos,
para usar o sistema sem interrupção e sem que um refresh token roubado sirva para alguma coisa por muito tempo (FR-12, AD-7).

> Emenda do Create Story (2026-10-20, decisão do Boss): o cookie usa `Path=/auth`, e não `Path=/auth/refresh`. O navegador só envia um cookie a caminhos dentro do `Path`, então `POST /auth/logout` nunca receberia um cookie restrito a `/auth/refresh`. Com `/auth`, o cookie chega só às rotas do serviço de Auth, e nenhum domínio o recebe (FR-12 mantido). O `epics.md` foi emendado na 2.3 e na 3.6.

## Acceptance Criteria

1. **Cookie no login.** Dado um login bem-sucedido, quando a resposta é enviada, então ela traz o cookie `tecton_refresh`:
   - valor aleatório opaco de 256 bits (32 bytes de `randomBytes`, em base64url, 43 caracteres);
   - atributos `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/auth` e `Max-Age` igual ao que falta para a família expirar, sem `Domain`.
   - O corpo da resposta nunca contém o refresh token (continua `{ accessToken, tokenType, expiresIn }`).
   - O banco do Auth guarda só o hash do refresh (SHA-256), com identificador de família e validade.
2. **Validade fixa da família.** A família expira 7 dias depois do login (`TECTON_AUTH_REFRESH_TOKEN_TTL_SECONDS`, padrão 604800, inteiro decimal entre 3600 e 7776000). A rotação não estende a validade: todo refresh da família vence junto com ela.
3. **Rotação.** Dado um refresh válido, quando chamo `POST /auth/refresh`, então:
   - recebo um novo access token no corpo e um novo cookie `tecton_refresh`;
   - o refresh anterior fica marcado como usado;
   - as `perms` do novo access token vêm da credencial lida agora, não da sessão.
4. **Reuso revoga a família.** Dado um refresh que já foi usado, quando ele é apresentado de novo, então:
   - a resposta é 401;
   - toda a família é revogada, inclusive o refresh mais novo dela;
   - um evento de segurança é registrado em log, em inglês, nível `warn`, com o identificador da família e o sujeito, nunca o token nem o hash.
5. **Expirado, desconhecido, revogado ou credencial inativa.** Dado um refresh expirado, desconhecido, malformado, de família revogada ou de credencial que não está mais `active` (ou que não existe mais), quando ele é apresentado, então a resposta é 401, idêntica em todos os casos. Na credencial inativa, a família também é revogada.
6. **Logout.** Dado uma sessão ativa, quando chamo `POST /auth/logout`, então a família do refresh é revogada e o cookie é apagado (`tecton_refresh=; Max-Age=0` com os mesmos `Path` e atributos). O logout é idempotente: sem cookie, com cookie desconhecido ou de família já revogada, a resposta é a mesma 200 `{}`, e o cookie é apagado igual.
7. **Refresh confinado ao Auth (FR-12).** Dado um serviço de domínio qualquer, quando ele recebe requisições, então nunca recebe nem processa refresh token: o `Path=/auth` só cobre rotas do Auth, e nenhuma resposta traz o token no corpo.
8. **Sem cache e sem segredo em log.** As respostas de login, refresh e logout trazem `Cache-Control: no-store`. Nenhum log contém o refresh token, o hash dele ou o cookie.

> **Nota (epics.md):** a revogação imediata do access token no logout e na detecção de reuso depende do `TokenRevocationStore` e é coberta na Story 2.5.

## Tasks / Subtasks

- [ ] **T1. Schema e migration (AC: 1, 2)**
  - [ ] Nos dois `schema.prisma` (idênticos, salvo os `@db.*`; o `schema-parity.test.ts` compara), dois models novos:
    - `RefreshFamily` (`refresh_families`): `id` (UUID v7, `Char(36)`), `credentialId` (`credential_id`, relação com `Credential`, `onDelete: Cascade`), `createdAt`, `expiresAt`, `revokedAt` (opcional), `revokedReason` (opcional, `VarChar(16)`: `logout`, `reuse`, `inactive`);
    - `RefreshToken` (`refresh_tokens`): `id` (UUID v7), `familyId` (`family_id`, relação com `RefreshFamily`, `onDelete: Cascade`), `tokenHash` (`token_hash`, `Char(64)`, `@unique`, SHA-256 em hexadecimal minúsculo), `createdAt`, `usedAt` (opcional).
    - Índice em `credential_id` da família (a revogação por sujeito da 2.5 vai usar).
    - Timestamps vêm da porta `Clock`, nunca de default do banco (padrão da 2.2a). Tipos: `Timestamptz(3)` no PostgreSQL, `DateTime(3)` no MySQL.
  - [ ] Migration `0002_refresh_tokens` por dialeto, gerada sem banco: `prisma migrate diff --config prisma/<dialeto>/prisma.config.ts --from-schema <schema da 0001> --to-schema prisma/<dialeto>/schema.prisma --script`. O schema anterior sai de `git show HEAD:packages/auth/prisma/<dialeto>/schema.prisma` para um arquivo temporário. Confirmar os flags com `pnpm exec prisma migrate diff --help`.
    - Conferir no SQL do PostgreSQL que não aparece `CREATE SCHEMA` (P16 da 2.2a).
  - [ ] `schema-parity.test.ts`: lista de models passa a `['Credential', 'RefreshFamily', 'RefreshToken']`.
  - [ ] `pnpm generate` regenera os dois clientes.
- [ ] **T2. Portas e regras no núcleo (AC: 1 a 6)**
  - [ ] `src/core/refresh-token.ts`:
    - `generateRefreshToken()`: 32 bytes de `randomBytes` em base64url;
    - `hashRefreshToken(token)`: SHA-256 em hexadecimal; não precisa de Argon2id nem de Pepper, porque o valor tem 256 bits de entropia;
    - `isWellFormedRefreshToken(value)`: `/^[A-Za-z0-9_-]{43}$/`; um valor malformado vira "desconhecido", sem consulta ao banco.
  - [ ] `src/core/refresh-token-store.ts`, porta `RefreshTokenStore` (o núcleo nunca importa Prisma, AD-1):
    - `openFamily({ family, token })`: cria a família e o primeiro token numa transação;
    - `rotate(tokenHash, newToken, now)`: atômico. Devolve `{ kind: 'rotated', family }`, `{ kind: 'reused', family }` (e revoga a família com `reuse` na mesma transação), `{ kind: 'expired' }`, `{ kind: 'revoked' }` ou `{ kind: 'unknown' }`;
      - marcar como usado é condicional (`usedAt` nulo): de duas rotações simultâneas do mesmo token, uma ganha e a outra vira `reused`;
      - a validade é conferida contra `now` (da `Clock`), nunca contra `NOW()` do banco;
    - `revokeFamilyOf(tokenHash, now, reason)`: revoga a família de um token em qualquer estado; devolve se achou;
    - `close()`.
  - [ ] `CredentialStore.findById(id)` (porta e adaptador), com a mesma validação de linha de `findByLogin` (`InvalidCredentialError` em linha corrompida).
  - [ ] `src/core/session.ts` (ou nome equivalente):
    - `openSession`: chamado pelo login depois de autenticar; gera o token, abre a família com validade `now + ttl` e devolve `{ refreshToken, expiresAt }`;
    - `refreshSession`: valida o formato, chama `rotate`, lê a credencial por `findById`, revoga a família (`inactive`) se ela não estiver `active` ou não existir, emite o access token e devolve o novo refresh;
    - `endSession` (logout): revoga a família se o token for bem formado e conhecido; nunca falha por token desconhecido.
  - [ ] Um único `InvalidRefreshTokenError` para todo 401 do refresh (desconhecido, malformado, expirado, revogado, reusado, credencial inativa ou corrompida). Credencial corrompida se comporta como no login (`onCorruptCredential`).
  - [ ] Reuso: callback `onReuseDetected({ familyId, subject })`, que o serviço liga ao log de segurança.
  - [ ] `login` (núcleo) passa a abrir a sessão e devolve o access token mais o refresh. Preservar tudo da 2.2b: um Argon2id em todo caso, `dummyHash`, rehash condicional, `InvalidCredentialsError` único.
- [ ] **T3. Adaptador Prisma (AC: 1 a 6)**
  - [ ] Um único cliente Prisma por processo para as duas portas. Extrair a criação do cliente (escolha de dialeto, `PrismaPg` com `schema`, `PrismaMariaDb` com `withScheme`) para `adapters/prisma/client.ts`, e criar `createPrismaRefreshTokenStore` sobre esse cliente. O `createPrismaCredentialStore({ databaseUrl })` continua funcionando como hoje, porque o `tecton-admin auth bootstrap` o usa.
  - [ ] `rotate` numa transação interativa (`$transaction(async (tx) => ...)`):
    - acha o token pelo hash, com a família;
    - ordem das checagens: desconhecido → família revogada → família expirada → já usado (reuso: revoga a família) → `updateMany` condicional em `usedAt: null`; contagem 0 é reuso concorrente (revoga a família) → cria o token novo.
    - Token já usado de família já revogada devolve `revoked`, mas o núcleo registra o mesmo evento de segurança (replay depois da revogação), sem revogar de novo.
    - O resultado `reused` precisa sobreviver ao commit (a revogação é gravada mesmo com a resposta 401).
  - [ ] Conflito de escrita ou deadlock na rotação simultânea (`isWriteConflict` da 2.2a) conta como reuso concorrente, nunca como 500. Confirmar o comportamento nos três bancos (T7).
  - [ ] Linha de família ou token inválida (datas ausentes, motivo fora da lista) é tratada como desconhecida, sem lançar 500 (fail closed).
- [ ] **T4. Cookie e `ActionContext` (AC: 1, 6, 7)**
  - [ ] `@tecton/core`: `ActionContext` ganha `reply: FastifyReply` (aditivo; preservar `domain`, `action`, `request` e os testes de rotas).
  - [ ] `src/adapters/http/refresh-cookie.ts` (ou nome equivalente), sem dependência nova:
    - `REFRESH_COOKIE = 'tecton_refresh'` e `REFRESH_COOKIE_PATH = '/auth'`;
    - `serializeRefreshCookie(token, maxAgeSeconds)` e `clearRefreshCookie()`;
    - `readRefreshCookie(cookieHeader)`: lê só `tecton_refresh`; vários valores com esse nome ou valor malformado contam como desconhecido.
  - [ ] Nada de `@fastify/cookie`: é dependência nova e o parsing necessário é mínimo. Se o dev achar indispensável, HALT e pedir aprovação.
- [ ] **T5. Serviço (AC: 1 a 8)**
  - [ ] `createAuthService` recebe `refreshTokens: RefreshTokenStore` e `refreshTtlSeconds`, e implementa os handlers `refresh` e `logout` do manifest. O `serviceToken` continua em 501 (Story 2.7).
  - [ ] Login: além do corpo atual, `Set-Cookie` com o refresh.
  - [ ] Refresh: lê o cookie, chama `refreshSession`, devolve o access token e o novo cookie. `InvalidRefreshTokenError` vira `frameworkErrors.unauthorized()` e apaga o cookie na mesma resposta.
  - [ ] Logout: 200 `{}` sempre, com o cookie apagado.
  - [ ] Corpo das actions sem input: o manifest declara `input: {}`. Testar o que acontece com corpo vazio, sem `content-type`, e com `{}`. Documentar no README o que o cliente deve mandar; se o corpo vazio der 400, o cliente manda `{}`.
  - [ ] `Cache-Control: no-store` e `Pragma: no-cache` em login, refresh e logout (hoje só no login).
  - [ ] Log de segurança do reuso: `app.log.warn({ event: 'auth.refresh_token.reuse', familyId, subject }, 'refresh token reuse detected; family revoked')`.
  - [ ] `onClose` fecha o cliente Prisma uma vez só.
  - [ ] `startAuthServiceFromEnv`: lê `TECTON_AUTH_REFRESH_TOKEN_TTL_SECONDS` (`integerFromEnv`, AuthConfigError com o nome da variável) e cria as duas portas sobre o mesmo cliente. Preservar a limpeza na falha de subida (P13 da 2.2b).
  - [ ] Manifest (`tecton.yaml`): ajustar as descrições de `refresh` e `logout` (cookie `tecton_refresh` em `Path=/auth`; o logout sempre responde 200). Contratos de input e output não mudam.
- [ ] **T6. Exportações e README (AC: todos)**
  - [ ] `src/index.ts`: portas, erros, funções de sessão, helpers do cookie e `createPrismaRefreshTokenStore`.
  - [ ] README do `@tecton/auth` (inglês):
    - refresh e logout: cookie, atributos, rotação, validade fixa da família, reuso revoga a família;
    - o Gateway (Story 3.6) roteia `/auth/*` para o Auth sem mexer no cookie;
    - refresh concorrente: duas chamadas com o mesmo cookie contam como reuso e derrubam a sessão; a SPA precisa de single-flight (Story 4.7, R-16);
    - a variável nova na tabela;
    - `Secure` em desenvolvimento: Chrome e Firefox aceitam cookie `Secure` em `http://localhost`, mas não é garantido em todo navegador; fora de `localhost`, só `https`.
- [ ] **T7. Testes (AC: todos)** — Test Design P0-008 (8), P0-009 (1), P1-010 (2), com a `clock` injetável.
  - [ ] Núcleo (`session.test.ts`, com store em memória que segue o contrato da porta):
    - rotação devolve token novo e marca o anterior;
    - reuso revoga a família, inclusive o token mais novo, e chama `onReuseDetected` uma vez;
    - expirado pela `clock` (avançar 7 dias) dá 401 sem revogar;
    - a rotação não estende a validade da família;
    - credencial desativada ou removida dá 401 e revoga a família;
    - `perms` lidas da credencial atual;
    - malformado não consulta o store.
  - [ ] HTTP (`app.inject`):
    - atributos exatos do `Set-Cookie` (P0-008), sem `Domain`;
    - o token não aparece em nenhum corpo de login, refresh ou logout (P0-009);
    - 401 idêntico byte a byte para desconhecido, malformado, expirado, revogado, reusado e credencial inativa;
    - logout revoga e apaga o cookie; logout idempotente nos quatro casos;
    - `Cache-Control: no-store` nas três rotas;
    - log capturado: evento de reuso presente, em inglês, e `assertNoSecretsLeaked` com o token, o hash e o cookie;
    - refresh concorrente (P1-010): duas chamadas em paralelo com o mesmo cookie dão um 200 e um 401, e depois o cookie do 200 também é recusado. Comportamento documentado no README.
  - [ ] Persistência (`*.persistence.test.ts`, nos três bancos pelo `TECTON_TEST_DB`):
    - migrations `0001` + `0002` aplicadas;
    - `openFamily`, `rotate` nos cinco resultados e `revokeFamilyOf`;
    - rotação simultânea real (`Promise.all`) com exatamente um `rotated`;
    - cascata: apagar a credencial apaga famílias e tokens;
    - fluxo completo pelo serviço: login, refresh, reuso e logout contra o banco real.
  - [ ] Config: `TECTON_AUTH_REFRESH_TOKEN_TTL_SECONDS` aceita o padrão e os limites e recusa hexadecimal, expoente e fora da faixa, com o nome da variável na mensagem.
  - [ ] Fase vermelha por mutação (retro A3), registrada no Debug Log. No mínimo: marcar como usado sem condição; reuso sem revogar a família; rotação estendendo a validade; cookie sem `HttpOnly`; token no corpo da resposta; refresh com credencial desativada aceito.
- [ ] **T8. Verificação final**
  - [ ] `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:persistence` (local pelo túnel se o ubt-host02 responder; os três bancos no CI) e `test:generation`.
  - [ ] Code review por story antes da 2.4 (retro A1).

## Dev Notes

### Decisões desta story

- **`Path=/auth` (Boss, 2026-10-20):** ver a emenda no topo. O cookie chega a login, refresh e logout. Na `GET /auth/.well-known/jwks.json` ele também chegaria, mas quem busca o JWKS são serviços, sem cookie.
- **Validade fixa da família (Boss, 2026-10-20):** 7 dias a partir do login, sem estender na rotação. Novo login a cada 7 dias no máximo. Sem teto separado nem inatividade.
- **SHA-256, não Argon2id:** o refresh tem 256 bits aleatórios, então um hash rápido basta e permite busca por índice único. A comparação é a própria busca pelo hash.
- **Nome `tecton_refresh`, sem prefixo `__Host-`:** `__Host-` exige `Path=/`, o que mandaria o cookie a todo domínio pelo Gateway e quebraria o FR-12.
- **Reuso estrito, sem janela de tolerância:** dois refresh simultâneos do mesmo token derrubam a sessão (R-16). Quem evita isso é a SPA, com single-flight (Story 4.7). A janela de tolerância enfraqueceria a detecção de roubo.
- **Logout sempre 200:** não revela se a sessão existia. Exige só o cookie, então funciona mesmo com o access token vencido.
- **CSRF:** `SameSite=Strict` impede que outro site dispare refresh ou logout com o cookie. Nenhum header anti-CSRF extra nesta story.
- **Corpo do 401 provisório,** igual à 2.2b (`unauthorized()` com `WWW-Authenticate: Bearer`). O RFC 9457 é do Epic 5.

### Código existente que esta story toca

| Arquivo | Hoje | Muda | Preservar |
|---|---|---|---|
| `packages/core/src/routes.ts` | `ActionContext { domain, action, request }`; handler recebe o body validado; 501 sem handler | `reply` no contexto | Validação do body, 501, respostas 400/401/500/501 no schema, erro para handler de action desconhecida |
| `packages/auth/src/service.ts` | `createAuthService` com `login`, JWKS e hook `no-store` só no `LOGIN_PATH`; `startAuthServiceFromEnv` com limpeza na falha | handlers `refresh` e `logout`, cookie, `no-store` nas três rotas, cliente compartilhado | `dummyHash` na subida, `safeError`, `LOG_REDACTION`, JWKS `max-age=300`, `onClose` |
| `packages/auth/src/core/login.ts` | autentica e emite o access token | também abre a sessão | um Argon2id sempre, `InvalidCredentialsError` único, rehash condicional, credencial corrompida como inexistente |
| `packages/auth/src/core/credential-store.ts` e `adapters/prisma/prisma-credential-store.ts` | `count`, `findByLogin`, `create`, `createIfEmpty`, `updatePasswordHash`, `close` | `findById`; cliente extraído | transação serializável do `createIfEmpty`, `isLoginTaken`, `toCredential` |
| `packages/auth/prisma/*` | só `credentials`, migration `0001_init` editada à mão (collation binária no MySQL; sem `CREATE SCHEMA` no PostgreSQL) | dois models e `0002` | não tocar na `0001` |
| `packages/auth/tecton.yaml` | `refresh` e `logout` já declarados, `input: {}` | só descrições | contratos de input e output |
| `packages/auth/src/adapters/env/config-from-env.ts` | `integerFromEnv` estrito | variável do TTL do refresh | mensagens com o nome da variável, nunca o valor |

O CLI (`auth bootstrap`) e o template `apps/auth` não precisam mudar: o `main.ts` gerado usa `startAuthServiceFromEnv`, e a migration nova sai junto no pacote (`prisma/` já está em `files`).

### Fora desta story (não fazer)

- Revogar o access token no logout e no reuso (2.5).
- Verificação do token nos serviços (2.4), bloqueio por identificador (2.6), token de serviço (2.7).
- Limpeza periódica de famílias e tokens vencidos: registrar no `deferred-work.md` como pendência da operação.
- Single-flight na SPA (4.7); repasse do cookie pelo Gateway (3.6).

### Padrões a seguir (Epic 1, 2.1, 2.2a e 2.2b)

- Código, mensagens, logs e README em inglês. Nunca `\uXXXX` em arquivo novo; cuidado com scripts que convertem `\n` e `\r` (erros registrados na 2.2b).
- Resultado novo a cada chamada, nunca objeto compartilhado mutável.
- Segredos nunca em mensagem nem em log; `assertNoSecretsLeaked` nos testes.
- Datas da `Clock`; UUID v7 pela biblioteca `uuid` (AD-5).
- Dialetos: `mysql://` para o motor de migrations e `mariadb://` para o driver (`withScheme`); timezone da sessão já coberto pelo teste `+03:00` da 2.2b.
- Docker remoto: túnel SSH do `.env.example`. Se o ubt-host02 não responder, a persistência fica com o CI, e isso é registrado.

### Perguntas ao Boss (antes do desenvolvimento)

1. Caminho do cookie e logout: **`Path=/auth`** (2026-10-20).
2. Validade: **7 dias fixos da família** (2026-10-20).
3. Nenhuma dependência nova prevista (cookie lido e escrito à mão).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3], Story 2.5 (logout e reuso revogam o access token), Story 3.6 (cookie atravessa o Gateway) e Story 4.7 (refresh na SPA)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#AD-7] (refresh opaco, hash só no banco do Auth, rotação, reuso revoga a família, cookie restrito), AD-1, AD-5, AD-9
- [Source: _bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md#FR-12] (nenhum domínio recebe refresh)
- [Source: _bmad-output/test-artifacts/test-design-qa.md#P0-008, P0-009, P1-010] e R-16 (`test-design-architecture.md`)
- [Source: _bmad-output/implementation-artifacts/2-2b-servico-tecton-auth-login-access-token-eddsa-e-jwks.md] (padrões do serviço e do review)
- [Source: RFC 6265 (cookies, `Path`), RFC 6265bis (`SameSite`, prefixos `__Host-`/`__Secure-`), OAuth 2.0 Security BCP (RFC 9700, rotação e detecção de reuso do refresh)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

## Change Log

- 2026-10-20: Story criada (Create Story), com as decisões do Boss sobre `Path=/auth` e validade fixa da família.
