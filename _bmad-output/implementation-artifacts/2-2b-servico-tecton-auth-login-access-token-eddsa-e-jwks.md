---
baseline_commit: f890ecd6bc98897f5ca565eb52c66bb7be38dbb7
---

# Story 2.2b: Serviço `@tecton/auth`, parte 2: login, access token EdDSA e JWKS

Status: review

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

- [x] **T1. Dependência `jose` e decisões de `iss`/`aud` (AC: 1, 3)** — ver "Perguntas ao Boss"
  - [x] `@tecton/auth` → `dependencies`:
    - `jose` (6.x; 6.2.12 é de 2026-09-05, dentro da idade mínima de release);
    - `@tecton/core` (`workspace:*`; o AD-3 permite `auth` → `core`).
  - [x] Valores padrão (decididos com o Boss):
    - `iss`: `TECTON_AUTH_ISSUER`, padrão `urn:tecton:auth`;
    - `aud`: `TECTON_AUTH_AUDIENCE`, padrão `urn:tecton:api` (um público por workspace: todo serviço do workspace aceita o token; a 2.4 verifica);
    - validade: `TECTON_AUTH_ACCESS_TOKEN_TTL_SECONDS`, padrão 900, entre 60 e 3600.
- [x] **T2. Chaves de assinatura (AC: 3, 4)**
  - [x] `packages/auth/src/core/signing-keys.ts`, com tipos e regras, sem leitura de ambiente:
    - `SigningKeyConfigError` (mensagem nunca contém o valor);
    - `SigningKeys = { current: { kid, privateKey }, publicJwks: JWK[] }`.
  - [x] `src/adapters/env/signing-keys-from-env.ts`: `signingKeysFromEnv(env)` lê:
    - `TECTON_AUTH_SIGNING_KEY`: obrigatória. Chave privada Ed25519 em PEM PKCS#8 (`-----BEGIN PRIVATE KEY-----`). Gerar com `openssl genpkey -algorithm ed25519`;
    - `TECTON_AUTH_PREVIOUS_PUBLIC_KEYS`: opcional. Zero ou mais blocos PEM SPKI (`-----BEGIN PUBLIC KEY-----`) de chaves anteriores, publicados no JWKS durante a rotação.

    É leitura mínima própria, como o `pepperFromEnv`; o `ConfigProvider` (3.1) absorve.
  - [x] Validação com `node:crypto` (`createPrivateKey`, `createPublicKey`):
    - ausente → erro;
    - não é PKCS#8 → erro;
    - `asymmetricKeyType !== 'ed25519'` → erro (recusa RSA, EC e chave pública no lugar da privada);
    - chave anterior inválida → erro.

    Mensagens nunca ecoam o PEM; testar com `assertNoSecretsLeaked`.
  - [x] `kid` = thumbprint JWK RFC 7638 (`calculateJwkThumbprint` do `jose`) da chave pública. É estável e não precisa de configuração. JWKS: `{ keys: [atual, ...anteriores] }`, cada uma com `kty: OKP`, `crv: Ed25519`, `x`, `kid`, `alg: EdDSA`, `use: sig`.
  - [x] Garantia estrutural: nenhum JWK publicado tem `d`. Teste explícito, além do `assertNoSecretsLeaked` sobre o corpo com a chave privada como segredo.
- [x] **T3. Emissão do access token (AC: 1)**
  - [x] `src/core/access-token.ts`: `createAccessTokenIssuer({ keys, clock, issuer, audience, ttlSeconds })` → `issue(credential): Promise<{ accessToken, tokenType: 'Bearer', expiresIn }>`.
    - `SignJWT` do `jose`, cabeçalho `{ alg: 'EdDSA', kid, typ: 'JWT' }`;
    - claims `iss`, `sub` (= `credential.id`), `aud`, `iat` e `exp` em segundos a partir da `Clock` (nunca `Date.now`);
    - `jti` = `uuid` v7, `typ: 'user'`, `perms` = cópia de `credential.permissions`.
  - [x] Teste de ida e volta com `jwtVerify` do `jose` contra o JWKS publicado (`createLocalJWKSet`): assinatura, `iss`, `aud`, `exp` e `kid`.
- [x] **T4. Login (AC: 1, 2)**
  - [x] `src/core/login.ts`: `login({ store, auth, issuer, dummyHash }, { login, password })`.
    1. `normalizeLogin`; login inválido conta como inexistente.
    2. `findByLogin`.
    3. **Sempre** `auth.verifyPassword(password, credential?.passwordHash ?? dummyHash)`.
    4. Se não houver credencial, ou `valid` for falso, ou `status !== 'active'` → `InvalidCredentialsError` única (a mesma para os três casos).
    5. Se `needsRehash`, regrava o hash: nova operação `updatePasswordHash(id, hash, updatedAt)` na porta `CredentialStore` e no adaptador Prisma. Falha ao regravar é logada e não impede o login.
    6. Emite o token.
  - [x] `dummyHash`: gerado uma vez na subida com o `AuthProvider` atual (mesmos parâmetros e Pepper atual), para que o custo do Argon2id seja o mesmo do caso real. Fecha o W2 da 2.1.
  - [x] **Igualdade comportamental (P0-006, sem medir tempo):** teste com `AuthProvider` espião. `verifyPassword` é chamado exatamente uma vez nos três casos de falha, e o corpo e os headers da resposta 401 são idênticos byte a byte.
- [x] **T5. Serviço HTTP (AC: 1–4, 6)**
  - [x] `@tecton/core`: `frameworkErrors.unauthorized()` (401, slug `unauthorized`, `i18nKey` `tecton.error.unauthorized`, mensagem `invalid credentials`). O serializador único continua sendo o único lugar que monta corpo de erro.
  - [x] `src/service.ts`: `startAuthService({ store, auth, keys, clock, issuer, audience, ttlSeconds, port, host, logger })`:
    - `createTectonServer` e `registerActionRoutes(app, authManifest, { login })`. As demais actions (`refresh`, `logout`, `serviceToken`) ficam sem handler e respondem 501 até as 2.3 e 2.7;
    - `GET /auth/.well-known/jwks.json` com `Cache-Control: public, max-age=300`;
    - escuta em `127.0.0.1` por padrão (D2 do review do Epic 1);
    - o manifest é o `tecton.yaml` do pacote, lido pelo caminho do pacote (como o `applyAuthMigrations` resolve `prisma/`).
  - [x] `startAuthServiceFromEnv(env)` monta tudo a partir de:
    - `TECTON_AUTH_DATABASE_URL`, `pepperFromEnv` e `signingKeysFromEnv`;
    - `iss`/`aud`/TTL (T1);
    - `PORT`/`HOST`, com a mesma validação do `main.ts` de domínio.

    Qualquer configuração inválida falha **antes** de escutar, com uma linha clara e sem segredo.
  - [x] Logs (AC 6):
    - `createTectonServer` passa a aceitar `logger` com `redact` (`req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`);
    - o Fastify não loga corpo por padrão; não ligar;
    - teste: capturar o log do serviço (stream do pino em memória) durante login com sucesso, login falho e JWKS, e rodar `assertNoSecretsLeaked` com senha, hash, Pepper, PEM privado e o token emitido.
- [x] **T6. `apps/auth` no workspace gerado (AC: 5)**
  - [x] Template `packages/cli/templates/workspace/apps/auth/`:
    - `package.json` (`@{{name}}/auth`, `"@tecton/auth": "{{tecton:auth}}"`, scripts `build`, `start` e `migrate`);
    - `tsconfig.json`;
    - `src/main.ts` (`await startAuthServiceFromEnv(process.env)`);
    - `src/migrate.ts` (`applyAuthMigrations` com `TECTON_AUTH_DATABASE_URL`).

    Código e comentários em inglês.
  - [x] Template `pnpm-workspace.yaml` → `allowBuilds` com `prisma: true` e `'@prisma/engines': true`, com comentário (W3 da 2.2a).
  - [x] Dev Services:
    - o banco `auth` entra sempre que existir `apps/auth`, além dos domínios de `apps/domains`;
    - o `.env.example` gerado ganha `TECTON_AUTH_DATABASE_URL` (já sai do `envName('auth')`) e linhas **comentadas** para `TECTON_AUTH_PEPPER` e `TECTON_AUTH_SIGNING_KEY`, com os comandos de geração. Nunca um segredo de verdade.
  - [x] Lint do workspace gerado: hoje o `lintWorkspace` procura pacotes instalados só a partir da raiz e das pastas de domínio. O `@tecton/auth` está no `apps/auth/package.json`, então um domínio com `dependencies: [auth]` não resolveria.
    - Passar a procurar a partir de **todo** `package.json` de pacote do workspace (fora de `node_modules`).
    - Teste no `@tecton/manifest` e teste de geração.
  - [x] Atualizar os testes do `new` (lista de arquivos gerados) e o guia/README do workspace, se citarem a estrutura.
- [x] **T7. Pendências herdadas da 2.2a**
  - [x] **W2, timezone:** teste de persistência no MySQL e no MariaDB que, com `SET GLOBAL time_zone = '+03:00'` (ou equivalente), grava e lê uma credencial e confirma as datas idênticas em UTC. Se divergir, fixar UTC no adaptador (`timezone` do `PrismaMariaDb`; confirmar a opção da 7.10) e registrar.
  - [x] **W3, pacote empacotado:** teste de geração (`*.generation.test.ts`, nightly) que roda `pnpm pack` do `@tecton/auth` e confere no tarball:
    - `dist/generated/{postgresql,mysql}`;
    - `prisma/{postgresql,mysql}` com migrations e `prisma.config.ts`;
    - `tecton.yaml`;
    - ausência de `src/` e `.tsbuildinfo`.
- [x] **T8. Testes (todas as ACs; fase vermelha dos negativos registrada, retro A3)**
  - [x] Unitários (sem banco):
    - chaves: válida, ausente, RSA, pública no lugar da privada, PEM truncado, anteriores inválidas, nenhum `d` no JWKS;
    - emissão: claims exatos, TTL, `kid` e verificação com o `jose`;
    - login: os três 401 iguais, com uma chamada ao Argon2id em cada; rehash quando `needsRehash`; falha do rehash não derruba o login;
    - serviço com `inject`: login 200 com o formato do `output` do manifest, 401 sem enumeração, 400 para corpo inválido, JWKS com duas chaves durante a rotação, 501 nas demais actions, subida falhando sem chave, logs sem segredo.
  - [x] Persistência (três bancos):
    - `updatePasswordHash`;
    - login ponta a ponta contra o banco real: migrations, bootstrap, `inject` de login e verificação do token com o JWKS;
    - teste de timezone (T7).
  - [x] Geração: workspace com `apps/auth` instala, builda e o lint resolve `dependencies: [auth]`; pack do `@tecton/auth` (T7).
- [x] **T9. READMEs e verificação final**
  - [x] README do `@tecton/auth` (inglês):
    - login, formato do token e claims;
    - variáveis;
    - geração da chave;
    - rotação (como trocar a chave: a antiga vai para `TECTON_AUTH_PREVIOUS_PUBLIC_KEYS` até os tokens dela expirarem, 15 minutos);
    - JWKS;
    - `apps/auth`.
  - [x] Verificação completa: `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:persistence` (local pelo túnel; os três bancos no CI) e `test:generation`.
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

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- **Desvio da T5, `fastify` direto:** a primeira versão do `service.ts` importava o tipo `FastifyInstance`, o que exigiria `fastify` como dependência direta do `@tecton/auth` (não aprovada). Trocado por `ReturnType<typeof createTectonServer>` (`AuthServiceApp`), sem dependência nova.
- **Template `apps/auth`, `link:` errado** (pego pelo teste de geração, que falhou com `Cannot find module '@tecton/auth'`): o `renderTemplate` calculava o caminho relativo do `link:` a partir da raiz do workspace, e não da pasta do arquivo. Para `apps/auth/package.json`, dois níveis abaixo, o link ficava errado. Agora usa a pasta de cada arquivo; os templates existentes não mudam, porque os `package.json` deles estão na raiz do template.
- **Nome `auth` reservado no `generate domain`,** não previsto na story: ele criaria um domínio `auth` com o mesmo banco do serviço de Auth. `BUILT_IN_SERVICES` no Dev Services e recusa no `generate`.
- **Teste de empacotamento:** o `tar` do Git Bash não entendeu o caminho do Windows e devolveu a listagem vazia. Trocado por `pnpm pack --dry-run --json`, que é portátil e segue as mesmas regras do tarball.
- **Script Python e caractere de controle:** um script Python gravou um CR literal numa regex do teste de geração (a barra invertida virou caractere de controle). Corrigido montando a string por código. O teste de higiene de fonte (A2) não pega CR solto, porque CR é permitido como quebra de linha.
- **Docker remoto inacessível nesta sessão:** a máquina estava em outra rede (192.168.15.x), e os dois IPs do ubt-host02 não responderam. Os testes de persistência novos (login ponta a ponta, `updatePasswordHash` e timezone) rodam no CI nos três bancos.
- **Fase vermelha por mutação (A3),** cada uma restaurada:

  | Mutação | Testes que falharam |
  |---|---|
  | login inexistente sem Argon2id | 3 |
  | credencial desativada aceita | 1 |
  | erro diferente para inexistente | 3 |
  | rehash ignorado | 1 |
  | JWKS com `d` | 5 |
  | PEM ecoado no erro | 1 |
  | TTL sem limites | 3 |
  | lint sem buscar nas pastas de pacote | 1 |
  | `generate` aceitando `auth` | 1 |
  | sem banco `auth` | 2 |

  O `link:` relativo foi visto falhando no teste de geração antes da correção.

  Duas mutações sobreviveram por serem equivalentes:
  - aceitar RSA/EC na checagem de tipo: a segunda checagem, do formato do JWK publicado, recusa;
  - remover o `LOG_REDACTION`: o serializador de requisição do Fastify já descarta os headers. O teste agora documenta essa garantia, e a redação fica como segunda camada.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Núcleo:**
  - porta `AccessTokenIssuer`;
  - `login` com `InvalidCredentialsError` única para login inexistente, senha errada, credencial desativada e login malformado;
  - um Argon2id em todos os casos (`dummyHash` gerado na subida);
  - rehash quando `needsRehash`, sem derrubar o login se falhar;
  - `updatePasswordHash` na porta e no adaptador Prisma.
- **Adaptadores `jose`:**
  - `buildSigningKeys`: Ed25519 PKCS#8, chaves públicas anteriores, `kid` por thumbprint RFC 7638, JWK montado campo a campo (sem `d`);
  - `createAccessTokenIssuer`: EdDSA com claims `iss`, `sub`, `aud`, `iat`, `exp`, `jti` v7, `typ: user` e `perms`, a partir da `Clock`; padrões `urn:tecton:auth` / `urn:tecton:api` e 900 s (60 a 3600).
- **Leitura de ambiente** (`adapters/env`): chave de assinatura (aceita PEM numa linha), chaves anteriores, `iss`/`aud`/TTL e `PORT`/`HOST`. Até a Story 3.1.
- **Serviço:**
  - `createAuthService`: actions do manifest com `login` implementado e as demais em 501, mais `GET /auth/.well-known/jwks.json` com cache de 5 min;
  - `startAuthServiceFromEnv` valida tudo antes de escutar, em `127.0.0.1` por padrão;
  - `frameworkErrors.unauthorized()` no `@tecton/core`.
- **Workspace gerado:**
  - `apps/auth` com `main.ts` e `migrate.ts`;
  - `allowBuilds` do Prisma;
  - banco `auth` no Dev Services e `.env.example` com linhas comentadas dos segredos;
  - `generate domain auth` recusado;
  - lint buscando pacotes a partir de todo `package.json` do workspace.
- **Pendências herdadas:**
  - W3 da 2.2a: pacote verificado por `pnpm pack --dry-run --json`, com clientes gerados, schemas, migrations e manifest, e sem `src`, `.tsbuildinfo` ou `.map`;
  - W2 da 2.2a: teste de timezone `+03:00` no MySQL e no MariaDB;
  - W2 da 2.1: verificação de mentira.
- **Dependência aprovada:** `jose` 6.2.12 (fixa), mais `@tecton/core` no `@tecton/auth`.
- **Verificação:**
  - local: suíte rápida verde, `test:generation` 3/3, build, typecheck, `check:deps` (116 módulos), `lint:examples` e `validate:asyncapi`;
  - persistência nos três bancos: pelo CI (sem acesso ao Docker remoto nesta sessão).
- **Pendente:** o code review (A1), próximo passo.

### File List

- `packages/core/src/errors/tecton-error.ts` (modificado: `unauthorized`)
- `packages/auth/package.json`, `tsconfig.json`, `README.md`, `src/index.ts` (modificados)
- `packages/auth/src/core/{access-token,login}.ts`, `login.test.ts` (novos); `src/core/credential-store.ts` (modificado)
- `packages/auth/src/adapters/jose/{signing-keys,access-token-issuer}.ts` e testes (novos)
- `packages/auth/src/adapters/env/config-from-env.ts` e teste (novos)
- `packages/auth/src/adapters/prisma/prisma-credential-store.ts`, `prisma-credential-store.persistence.test.ts` (modificados)
- `packages/auth/src/service.ts`, `service.test.ts` (novos)
- `packages/cli/templates/workspace/apps/auth/{package.json,tsconfig.json,src/main.ts,src/migrate.ts}` (novos); `templates/workspace/pnpm-workspace.yaml` (modificado)
- `packages/cli/src/{templates,dev-services}.ts`, `src/commands/generate-domain.ts` (modificados)
- `packages/cli/src/commands/{new,generate-domain,new.generation,auth-bootstrap}.test.ts`, `src/dev-services.test.ts` (modificados)
- `packages/manifest/src/lint/lint-workspace.ts`, `lint-review-fixes.test.ts` (modificados)
- `tests/support/keys.ts` (novo), `tests/support/index.ts` (modificado)
- `pnpm-lock.yaml`, esta story, `sprint-status.yaml`

## Change Log

- 2026-10-19: Story criada (Create Story), segunda metade da 2.2 dividida.
- 2026-10-19: Aprovações do Boss (`jose`, padrões de `iss`/`aud`).
- 2026-10-19: Story implementada (Dev Story); persistência nova a confirmar no CI; status → review.
