# Story 2.2b: Serviço `@tecton/auth`, parte 2: login, access token EdDSA e JWKS

Status: ready-for-dev

## Story

Como **dev de um sistema construído com o Tecton**,
quero um serviço de Auth pronto que autentique por login e senha e emita access token assinado,
para que todo serviço consiga verificar a identidade por conta própria, sem conseguir forjá-la (FR-12, AD-7).

> Segunda metade da Story 2.2 original, dividida no Create Story de 2026-10-15 (`epics.md`, nota de divisão). A parte 1 (2.2a) entregou credenciais, persistência e `tecton-admin auth bootstrap`.

## Acceptance Criteria

1. **Login.** Dado uma credencial válida (status `active`), quando chamo `POST /auth/login` com identificador e senha, então recebo um access token JWT assinado com EdDSA (Ed25519).
   - O cabeçalho traz `kid`.
   - Claims: `iss`, `sub`, `aud`, `iat`, `exp` (padrão de 15 minutos, configurável), `jti` em UUID v7, `typ: user` e `perms`.
2. **401 sem enumeração.** Dado um identificador inexistente, uma senha errada ou uma credencial `disabled`, quando chamo o login, então a resposta é 401, idêntica nos três casos e com tempo de resposta equivalente, para não revelar quais logins existem. Equivalência por comportamento, não por cronômetro (Test Design P0-006): o Argon2id roda nos três casos (hash fictício para login inexistente).
3. **JWKS.** Dado o serviço de Auth em execução, quando chamo `GET /auth/.well-known/jwks.json`, então recebo só as chaves públicas, nunca a privada. E o JWKS pode conter mais de uma chave, para permitir rotação sem invalidar tokens ainda válidos.
4. **Chave obrigatória.** Dado um serviço de Auth que sobe sem chave privada configurada, ou com uma chave inválida (que não é Ed25519, ou é pública em vez de privada), quando ele inicia, então a inicialização falha com mensagem clara, sem mostrar o valor recebido.
5. **`apps/auth` no workspace novo.** Dado um workspace novo, quando rodo `tecton-admin new`, então é gerado `apps/auth` como instância configurada de `@tecton/auth`, com dependência versionada (AD-4), e o Dev Services ganha o banco `auth`.
6. **Logs sem segredos.** Dado qualquer log do serviço de Auth, quando o inspeciono, então senha, hash, Pepper, chave privada e tokens nunca aparecem.

> **Notas (epics.md):**
> - O JWKS é um endpoint padrão de mercado e por isso usa `GET` em caminho `.well-known`, fora da convenção RPC das actions (Spine, tabela de consistência).
> - Proteção contra força bruta fica com o rate limiting do Gateway (Epic 3, FR-19) e o bloqueio por identificador (Story 2.6).
> - Nesta story, `perms` vem da credencial. No Epic 4, a fonte passa a ser o ACL do Directory.

## Tasks / Subtasks

- [ ] **T1. Dependência `jose` e decisões de `iss`/`aud` (AC: 1, 3)** — ver "Perguntas ao Boss"
  - [ ] `@tecton/auth` → `dependencies`:
    - `jose` (6.x; 6.2.12 é de 2026-09-05, dentro da idade mínima de release);
    - `@tecton/core` (`workspace:*`; o AD-3 permite `auth` → `core`).
  - [ ] Valores padrão (decididos com o Boss):
    - `iss`: `TECTON_AUTH_ISSUER`, padrão `urn:tecton:auth`;
    - `aud`: `TECTON_AUTH_AUDIENCE`, padrão `urn:tecton:api` (um público por workspace: todo serviço do workspace aceita o token; a 2.4 verifica);
    - validade: `TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS`, padrão 900, entre 60 e 3600.
- [ ] **T2. Chaves de assinatura (AC: 3, 4)**
  - [ ] `packages/auth/src/core/signing-keys.ts`, com tipos e regras, sem leitura de ambiente:
    - `SigningKeyConfigError` (mensagem nunca contém o valor);
    - `SigningKeys = { current: { kid, privateKey }, publicJwks: JWK[] }`.
  - [ ] `src/adapters/env/signing-keys-from-env.ts`: `signingKeysFromEnv(env)` lê:
    - `TECTON_AUTH_SIGNING_KEY`: obrigatória. Chave privada Ed25519 em PEM PKCS#8 (`-----BEGIN PRIVATE KEY-----`). Gerar com `openssl genpkey -algorithm ed25519`;
    - `TECTON_AUTH_PREVIOUS_PUBLIC_KEYS`: opcional. Zero ou mais blocos PEM SPKI (`-----BEGIN PUBLIC KEY-----`) de chaves anteriores, publicados no JWKS durante a rotação.

    É leitura mínima própria, como o `pepperFromEnv`; o `ConfigProvider` (3.1) absorve.
  - [ ] Validação com `node:crypto` (`createPrivateKey`, `createPublicKey`):
    - ausente → erro;
    - não é PKCS#8 → erro;
    - `asymmetricKeyType !== 'ed25519'` → erro (recusa RSA, EC e chave pública no lugar da privada);
    - chave anterior inválida → erro.

    Mensagens nunca ecoam o PEM; testar com `assertNoSecretsLeaked`.
  - [ ] `kid` = thumbprint JWK RFC 7638 (`calculateJwkThumbprint` do `jose`) da chave pública. É estável e não precisa de configuração. JWKS: `{ keys: [atual, ...anteriores] }`, cada uma com `kty: OKP`, `crv: Ed25519`, `x`, `kid`, `alg: EdDSA`, `use: sig`.
  - [ ] Garantia estrutural: nenhum JWK publicado tem `d`. Teste explícito, além do `assertNoSecretsLeaked` sobre o corpo com a chave privada como segredo.
- [ ] **T3. Emissão do access token (AC: 1)**
  - [ ] `src/core/access-token.ts`: `createAccessTokenIssuer({ keys, clock, issuer, audience, ttlSeconds })` → `issue(credential): Promise<{ accessToken, tokenType: 'Bearer', expiresIn }>`.
    - `SignJWT` do `jose`, cabeçalho `{ alg: 'EdDSA', kid, typ: 'JWT' }`;
    - claims `iss`, `sub` (= `credential.id`), `aud`, `iat` e `exp` em segundos a partir da `Clock` (nunca `Date.now`);
    - `jti` = `uuid` v7, `typ: 'user'`, `perms` = cópia de `credential.permissions`.
  - [ ] Teste de ida e volta com `jwtVerify` do `jose` contra o JWKS publicado (`createLocalJWKSet`): assinatura, `iss`, `aud`, `exp` e `kid`.
- [ ] **T4. Login (AC: 1, 2)**
  - [ ] `src/core/login.ts`: `login({ store, auth, issuer, dummyHash }, { login, password })`.
    1. `normalizeLogin`; login inválido conta como inexistente.
    2. `findByLogin`.
    3. **Sempre** `auth.verifyPassword(password, credential?.passwordHash ?? dummyHash)`.
    4. Se não houver credencial, ou `valid` for falso, ou `status !== 'active'` → `InvalidCredentialsError` única (a mesma para os três casos).
    5. Se `needsRehash`, regrava o hash: nova operação `updatePasswordHash(id, hash, updatedAt)` na porta `CredentialStore` e no adaptador Prisma. Falha ao regravar é logada e não impede o login.
    6. Emite o token.
  - [ ] `dummyHash`: gerado uma vez na subida com o `AuthProvider` atual (mesmos parâmetros e Pepper atual), para que o custo do Argon2id seja o mesmo do caso real. Fecha o W2 da 2.1.
  - [ ] **Igualdade comportamental (P0-006, sem medir tempo):** teste com `AuthProvider` espião. `verifyPassword` é chamado exatamente uma vez nos três casos de falha, e o corpo e os headers da resposta 401 são idênticos byte a byte.
- [ ] **T5. Serviço HTTP (AC: 1–4, 6)**
  - [ ] `@tecton/core`: `frameworkErrors.unauthorized()` (401, slug `unauthorized`, `i18nKey` `tecton.error.unauthorized`, mensagem `invalid credentials`). O serializador único continua sendo o único lugar que monta corpo de erro.
  - [ ] `src/service.ts`: `startAuthService({ store, auth, keys, clock, issuer, audience, ttlSeconds, port, host, logger })`:
    - `createTectonServer` e `registerActionRoutes(app, authManifest, { login })`. As demais actions (`refresh`, `logout`, `serviceToken`) ficam sem handler e respondem 501 até as 2.3 e 2.7;
    - `GET /auth/.well-known/jwks.json` com `Cache-Control: public, max-age=300`;
    - escuta em `127.0.0.1` por padrão (D2 do review do Epic 1);
    - o manifest é o `tecton.yaml` do pacote, lido pelo caminho do pacote (como o `applyAuthMigrations` resolve `prisma/`).
  - [ ] `startAuthServiceFromEnv(env)` monta tudo a partir de:
    - `TECTON_AUTH_DATABASE_URL`, `pepperFromEnv` e `signingKeysFromEnv`;
    - `iss`/`aud`/TTL (T1);
    - `PORT`/`HOST`, com a mesma validação do `main.ts` de domínio.

    Qualquer configuração inválida falha **antes** de escutar, com uma linha clara e sem segredo.
  - [ ] Logs (AC 6):
    - `createTectonServer` passa a aceitar `logger` com `redact` (`req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`);
    - o Fastify não loga corpo por padrão; não ligar;
    - teste: capturar o log do serviço (stream do pino em memória) durante login com sucesso, login falho e JWKS, e rodar `assertNoSecretsLeaked` com senha, hash, Pepper, PEM privado e o token emitido.
- [ ] **T6. `apps/auth` no workspace gerado (AC: 5)**
  - [ ] Template `packages/cli/templates/workspace/apps/auth/`:
    - `package.json` (`@{{name}}/auth`, `"@tecton/auth": "{{tecton:auth}}"`, scripts `build`, `start` e `migrate`);
    - `tsconfig.json`;
    - `src/main.ts` (`await startAuthServiceFromEnv(process.env)`);
    - `src/migrate.ts` (`applyAuthMigrations` com `TECTON_AUTH_DATABASE_URL`).

    Código e comentários em inglês.
  - [ ] Template `pnpm-workspace.yaml` → `allowBuilds` com `prisma: true` e `'@prisma/engines': true`, com comentário (W3 da 2.2a).
  - [ ] Dev Services:
    - o banco `auth` entra sempre que existir `apps/auth`, além dos domínios de `apps/domains`;
    - o `.env.example` gerado ganha `TECTON_AUTH_DATABASE_URL` (já sai do `envName('auth')`) e linhas **comentadas** para `TECTON_AUTH_PEPPER` e `TECTON_AUTH_SIGNING_KEY`, com os comandos de geração. Nunca um segredo de verdade.
  - [ ] Lint do workspace gerado: hoje o `lintWorkspace` procura pacotes instalados só a partir da raiz e das pastas de domínio. O `@tecton/auth` está no `apps/auth/package.json`, então um domínio com `dependencies: [auth]` não resolveria.
    - Passar a procurar a partir de **todo** `package.json` de pacote do workspace (fora de `node_modules`).
    - Teste no `@tecton/manifest` e teste de geração.
  - [ ] Atualizar os testes do `new` (lista de arquivos gerados) e o guia/README do workspace, se citarem a estrutura.
- [ ] **T7. Pendências herdadas da 2.2a**
  - [ ] **W2, timezone:** teste de persistência no MySQL e no MariaDB que, com `SET GLOBAL time_zone = '+03:00'` (ou equivalente), grava e lê uma credencial e confirma as datas idênticas em UTC. Se divergir, fixar UTC no adaptador (`timezone` do `PrismaMariaDb`; confirmar a opção da 7.10) e registrar.
  - [ ] **W3, pacote empacotado:** teste de geração (`*.generation.test.ts`, nightly) que roda `pnpm pack` do `@tecton/auth` e confere no tarball:
    - `dist/generated/{postgresql,mysql}`;
    - `prisma/{postgresql,mysql}` com migrations e `prisma.config.ts`;
    - `tecton.yaml`;
    - ausência de `src/` e `.tsbuildinfo`.
- [ ] **T8. Testes (todas as ACs; fase vermelha dos negativos registrada, retro A3)**
  - [ ] Unitários (sem banco):
    - chaves: válida, ausente, RSA, pública no lugar da privada, PEM truncado, anteriores inválidas, nenhum `d` no JWKS;
    - emissão: claims exatos, TTL, `kid` e verificação com o `jose`;
    - login: os três 401 iguais, com uma chamada ao Argon2id em cada; rehash quando `needsRehash`; falha do rehash não derruba o login;
    - serviço com `inject`: login 200 com o formato do `output` do manifest, 401 sem enumeração, 400 para corpo inválido, JWKS com duas chaves durante a rotação, 501 nas demais actions, subida falhando sem chave, logs sem segredo.
  - [ ] Persistência (três bancos):
    - `updatePasswordHash`;
    - login ponta a ponta contra o banco real: migrations, bootstrap, `inject` de login e verificação do token com o JWKS;
    - teste de timezone (T7).
  - [ ] Geração: workspace com `apps/auth` instala, builda e o lint resolve `dependencies: [auth]`; pack do `@tecton/auth` (T7).
- [ ] **T9. READMEs e verificação final**
  - [ ] README do `@tecton/auth` (inglês):
    - login, formato do token e claims;
    - variáveis;
    - geração da chave;
    - rotação (como trocar a chave: a antiga vai para `TECTON_AUTH_PREVIOUS_PUBLIC_KEYS` até os tokens dela expirarem, 15 minutos);
    - JWKS;
    - `apps/auth`.
  - [ ] Verificação completa: `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:persistence` (local pelo túnel; os três bancos no CI) e `test:generation`.
  - [ ] Code review por story antes da 2.3 (retro A1).

## Dev Notes

### Decisões desta story

- **`kid` por thumbprint (RFC 7638):** não precisa de configuração, é o mesmo valor em todo lugar que conhece a chave pública, e a 2.4 usa o `kid` para achar a chave no cache do JWKS.
- **Rotação sem segredo extra:** o serviço guarda uma única chave privada (a atual) e publica as públicas anteriores. Ninguém precisa da privada antiga para verificar tokens antigos.
- **Um único `InvalidCredentialsError`:** login inexistente, senha errada, credencial desativada e login inválido (formato) dão a mesma resposta. Login inválido não pode virar 400, senão revelaria a regra de formato, que é pública mas diferente da resposta "não existe".
- **Corpo do 400 por validação de schema** (campo faltando, tipo errado) continua vindo do serializador da 1.7. Não revela existência de login.
- **`dummyHash` na subida:** custa um Argon2id (~50 ms) no startup, uma vez.
- **Corpo do 401 provisório:** `{ status, slug, i18nKey, message }`, como o resto do Epic 1. O RFC 9457 é do Epic 5.

### Código existente que esta story toca

| Arquivo | Situação |
|---|---|
| `packages/core/src/errors/tecton-error.ts` | UPDATE: `unauthorized()`. Preservar os demais `frameworkErrors` |
| `packages/core/src/server.ts` | UPDATE: `logger` aceita opções com `redact`. Preservar o Ajv de requisição (`removeAdditional: false`, `coerceTypes: false`) |
| `packages/auth/src/core/credential-store.ts` e `adapters/prisma/prisma-credential-store.ts` | UPDATE: `updatePasswordHash`. Preservar `createIfEmpty` (transação serializável) e a validação de linha lida |
| `packages/auth/src/index.ts` | UPDATE: exporta serviço, emissor, chaves e `startAuthServiceFromEnv` |
| `packages/cli/templates/workspace/` | UPDATE: `apps/auth`, `allowBuilds`. Preservar `apps/domains/.gitkeep` e as sementes |
| `packages/cli/src/dev-services.ts` | UPDATE: banco `auth`. Preservar validação de domínios, nomes reservados e portas em `127.0.0.1` |
| `packages/manifest/src/lint/lint-workspace.ts` | UPDATE: pastas de busca de pacotes. Preservar a ordem de resolução (workspace → caminho explícito → pacote) |

### Fora desta story (não fazer)

- Refresh e logout (2.3); verificação do token nos serviços (2.4); revogação (2.5); bloqueio por identificador (2.6); token de serviço (2.7).
- Rate limiting (3.7).
- `ConfigProvider` (3.1): a leitura de ambiente fica mínima e isolada.

### Padrões a seguir (Epic 1, 2.1 e 2.2a)

- Código, mensagens, logs e README em inglês. TypeScript só pelo editor; nunca `\uXXXX` em arquivo novo.
- Resultado novo a cada chamada, nunca objeto compartilhado mutável (P1 da 2.1).
- Segredos nunca em mensagem; testar com `assertNoSecretsLeaked`.
- Testes com Docker localmente pelo túnel SSH do `.env.example`.
- Atenção às diferenças entre dialetos já conhecidas:
  - o motor de migrations aceita `mysql://` e o driver aceita `mariadb://` (`withScheme`);
  - collation binária no login.
- `createTectonServer` liga em `127.0.0.1` só via `startDomainServer`; o `startAuthService` deve ter o mesmo padrão.

### Perguntas ao Boss (antes do desenvolvimento)

1. Dependência `jose` 6.x no `@tecton/auth`: **aprovada** (2026-10-19).
2. Padrões de `iss` (`urn:tecton:auth`) e `aud` (`urn:tecton:api`, um público por workspace), ambos configuráveis: **aprovados** (2026-10-19).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2b] e Story 2.4 (o que o verificador espera: EdDSA, `kid`, `exp`, `iss`, `aud`)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#AD-7] (EdDSA, JWKS, nunca HS256), tabela de consistência (exceção `GET /auth/.well-known/jwks.json`), AD-3, AD-4, AD-5
- [Source: _bmad-output/test-artifacts/test-design-qa.md#P0-006] (claims, 401 idêntico com hash fictício, JWKS só pública e várias chaves, sem medir tempo), R-17
- [Source: _bmad-output/implementation-artifacts/2-2a-servico-tecton-auth-credenciais-persistencia-e-bootstrap.md] e `deferred-work.md` (W2, W3 da 2.2a; W2 da 2.1)
- [Source: RFC 7638 (JWK thumbprint), RFC 8037 (OKP/Ed25519 em JOSE), RFC 7519 (JWT)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

## Change Log

- 2026-10-19: Story criada (Create Story), segunda metade da 2.2 dividida.
- 2026-10-19: Aprovações do Boss (`jose`, padrões de `iss`/`aud`).
