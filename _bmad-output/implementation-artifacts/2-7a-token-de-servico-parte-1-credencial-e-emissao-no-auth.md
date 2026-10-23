---
baseline_commit: 55249654baa6490050551bf3e2e28fd41e2c9ca4
---

# Story 2.7a: Token de serviço, parte 1: credencial e emissão no Auth

Status: done

## Story

Como **dev de um domínio que chama outro domínio**,
quero registrar no Auth uma credencial própria do meu serviço e trocá-la por um token de serviço de vida curta,
para que toda chamada entre serviços possa levar uma credencial verificável do serviço chamador (FR-13, D3).

> Primeira metade da Story 2.7, dividida no Create Story de 2026-10-23 (decisão do Boss; nota no `epics.md`). A 2.7b faz a verificação em todo serviço (`typ: service`, `Tecton-On-Behalf-Of`, `call:<domínio>` exigido).

## Acceptance Criteria

1. **Registro.** Dado um domínio sem credencial de serviço, quando eu rodo `tecton-admin auth register-service <domínio> --login <administrador>` com um administrador que tem `auth:service:register`, então é criada a credencial `service:<domínio>` e o segredo aparece **uma única vez** na saída. O Auth guarda só o hash do segredo, gerado pelo `AuthProvider` da Story 2.1 (Argon2id com Pepper).
2. **Administrador obrigatório.** Dado uma chamada de registro sem token de administrador ou sem `auth:service:register`, quando ela chega ao Auth (`POST /auth/register-service`), então é recusada (401 sem token ou com token inválido; 403 sem a permissão) e nada é criado.
3. **Sem sobrescrever; rotação explícita.** Dado um domínio que já tem credencial, quando alguém tenta registrá-lo de novo, então a operação falha com 409, a menos que use `--rotate`, que também exige administrador, gera segredo novo, invalida o anterior e revoga todos os tokens de serviço emitidos com ele (revogação por sujeito `service:<domínio>` no `TokenRevocationStore` da 2.5).
4. **Emissão.** Dado uma credencial de serviço válida, quando o serviço chama `POST /auth/service-token` com `serviceId` e `secret`, então recebe um token EdDSA com `typ: service` (no claim; cabeçalho `typ: at+jwt`), `sub: service:<domínio>`, `perms` do serviço e validade curta (padrão de 5 minutos, `TECTON_AUTH_SERVICE_TOKEN_TTL_SECONDS`, de 60 a 900). Nenhum refresh é emitido (nenhum cookie).
5. **`call:<domínio>` só das dependências.** Dado o registro de um serviço, quando o Auth emite o token de serviço, então o token traz `call:<domínio>` só para os domínios declarados em `dependencies` no manifest do serviço chamador, lido pelo CLI no registro (`apps/domains/<domínio>/tecton.yaml`).
6. **Permissões do serviço (decisão do Boss, 2026-10-23).** As `perms` do serviço são as dadas pelo administrador no registro (`--permission <perm>`, repetível, no formato do manifest) mais os `call:<domínio>`. Sem `--permission`, o serviço tem só os `call:`. Mudar permissões ou dependências exige `--rotate`.
7. **Sem enumeração e segredo errado.** Dado um `serviceId` inexistente, um segredo errado ou uma credencial revogada, quando `POST /auth/service-token` é chamado, então a resposta é 401, idêntica nos três casos, com um Argon2id sempre (hash fictício para o inexistente), como no login.
8. **Token de serviço não serve para usuário.** Dado um token de serviço, quando ele é apresentado a `POST /auth/refresh` ou a `POST /auth/login`, então é recusado (o refresh exige o cookie de uma família de usuário; o login exige login e senha de credencial de usuário). E um token de serviço no `Authorization` do logout não revoga nada além da família do cookie.
9. **EQ-5 (decisão do Boss, 2026-10-23).** O `register-service` faz login no próprio comando: `--login <administrador>`, senha de `TECTON_AUTH_ADMIN_PASSWORD` ou da entrada padrão (nunca argumento), access token só em memória, logout no fim (o token é revogado). Nenhum token gravado em disco.

> **Risco aceito (auditoria de segurança de 2026-10-06):** um serviço comprometido pode reaproveitar, até expirarem (15 minutos), tokens de usuário que recebeu. É inerente à propagação de token; a exigência de `call:<domínio>` (2.7b) limita para onde ele pode usá-los. Registrar no README do `@tecton/auth`.

## Tasks / Subtasks

- [x] **T1. Persistência (AC: 1, 3, 6)** — `packages/auth/prisma`
  - [x] Model `ServiceCredential` (`service_credentials`), idêntico nos dois dialetos salvo os `@db.*`: `id` (UUID v7), `domain` (`@unique`, `VarChar(63)`), `secretHash` (`VarChar(256)`, PHC do `AuthProvider`), `permissions` (JSON, lista), `callees` (JSON, lista dos domínios de `dependencies`), `status` (`active`/`revoked`), `createdAt`, `updatedAt`.
  - [x] Migration `0003_service_credentials` gerada sem banco (`prisma migrate diff --from-schema <schema anterior> --to-schema ...`), sem `CREATE SCHEMA`; paridade de schema e lista de migrations atualizadas nos testes.
- [x] **T2. Núcleo (AC: 1, 3 a 8)** — `packages/auth/src/core/service-credential.ts`
  - [x] Porta `ServiceCredentialStore`: `findByDomain`, `register(credential)` (falha com `ServiceAlreadyRegisteredError` se existir), `rotate(domain, novo)` (substitui de forma atômica e devolve a anterior), `close`. Linha lida validada (fail closed como em `toCredential`).
  - [x] `registerService({ domain, dependencies, permissions, rotate })`: valida o domínio (padrão de nome de domínio do manifest, sem `auth`), as dependências (mesmo padrão, sem repetição, sem o próprio domínio) e as permissões (`assertValidPermissions`); gera o segredo (32 bytes aleatórios em base64url); guarda o hash pelo `AuthProvider`; na rotação, `revocations.revokeSubject({ subject: 'service:<domínio>', at: agora })`. Devolve o segredo em texto **uma vez**.
  - [x] `issueServiceToken({ serviceId, secret })`: um Argon2id sempre (hash fictício para inexistente); credencial `active`; `InvalidServiceCredentialsError` único. O token: `typ: service`, `sub: service:<domínio>`, `perms` = permissões dadas + `call:<dep>` de cada dependência, TTL do serviço.
  - [x] Emissor: `AccessTokenIssuer` ganha `issueService({ subject, permissions, ttlSeconds })` (mesma chave, mesmo `iss`/`aud`, `jti` UUID v7, cabeçalho `at+jwt`), ou um emissor irmão no mesmo adaptador `jose`. TTL validado (60 a 900).
- [x] **T3. Serviço (AC: 1 a 8)** — `packages/auth/src/service.ts` e `tecton.yaml`
  - [x] Manifest: action `registerService` (`input: { domain: string, dependencies: string?, permissions: string?, rotate: boolean? }`, listas separadas por vírgula porque o manifest não tem tipo lista; `output: { domain: string, secret: string, rotated: boolean }`; `auth: { requires: [auth:service:register] }`). A `serviceToken` continua pública.
  - [x] O Auth passa a ter uma action protegida: precisa de verificador. Verificador local do próprio Auth (chaves públicas dele, sem rede, mesmas regras da 2.4: `EdDSA`, `at+jwt`, `iss`, `aud`, `typ: user`, `perms`, tolerância de 30 s) **com a checagem de revogação** da 2.5, ligado ao `registerActionRoutes`.
  - [x] Respostas: 409 (`frameworkErrors.conflict()` no `@tecton/core`) para domínio já registrado sem `rotate`; 400 para domínio, dependência ou permissão inválidos; `Cache-Control: no-store` no `register-service` e no `service-token` (carregam segredo e token).
  - [x] `service-token`: 401 idêntico (AC 7); `TECTON_AUTH_SERVICE_TOKEN_TTL_SECONDS` no `startAuthServiceFromEnv`.
  - [x] Logs: segredo, hash e token nunca aparecem; evento `auth.service.registered` e `auth.service.rotated` (domínio e quem registrou, `sub` do administrador).
- [x] **T4. CLI `tecton-admin auth register-service` (AC: 1, 3, 5, 6, 9)** — `packages/cli`
  - [x] `register-service <domínio> --login <administrador> [--permission <perm>]... [--rotate]`.
  - [x] Lê `apps/domains/<domínio>/tecton.yaml` do workspace (falha clara se não existir ou for inválido) e envia as `dependencies` dele.
  - [x] URL do Auth em `TECTON_AUTH_URL` (ex.: `http://127.0.0.1:3001`); `https` obrigatório fora de `TECTON_ENV=development` (mesma regra do JWKS).
  - [x] Senha de `TECTON_AUTH_ADMIN_PASSWORD` ou da entrada padrão (nunca terminal interativo, nunca argumento), reaproveitando a leitura do `auth bootstrap`.
  - [x] Fluxo: `POST /auth/login` → access token em memória → `POST /auth/register-service` com Bearer → imprime o segredo uma vez, com aviso de que não será mostrado de novo → `POST /auth/logout` com o Bearer (revoga o token), também em caso de erro.
  - [x] Códigos de saída: 0 registrado, 2 já registrado (sem `--rotate`, nada mudou), 1 qualquer falha. Mensagens sem senha, token, segredo ou URL com credencial.
  - [x] Ajuda em inglês com exemplo.
- [x] **T5. README e workspace (AC: 4, 9)**
  - [x] README do `@tecton/auth`: credencial de serviço, registro, rotação, `service-token`, `perms`, `call:`, TTL, risco aceito.
  - [x] `.env.example` da raiz: `TECTON_AUTH_URL=http://127.0.0.1:3001` (comentário: usado pelo `tecton-admin`).
- [x] **T6. Testes (AC: todos)** — Test Design P0-017 (4), P0-018 (3)
  - [x] Núcleo: registro (segredo só na resposta, hash pelo `AuthProvider`, validações), já registrado sem `rotate`, rotação (segredo antigo recusado, `revokeSubject` de `service:<domínio>`), emissão (claims, `call:` só das dependências, `perms` dadas), 401 idêntico com um Argon2id sempre, credencial revogada.
  - [x] HTTP (`app.inject`, stores em memória): `register-service` sem token 401, com token sem a permissão 403, com token revogado 401, com a permissão 200; 409; `service-token` 200 sem `Set-Cookie`; token de serviço recusado no `refresh` e não aceito como credencial no `login`; `no-store`; segredo, hash e token fora dos logs.
  - [x] Persistência (três bancos pelo CI): store de credencial de serviço (registrar, achar, rotacionar atômico, domínio único, linha corrompida recusada) e migration `0003`.
  - [x] CLI: fluxo completo contra um Auth real em processo (`createAuthService` escutando numa porta), com login, registro, saída do segredo uma vez, logout (o token do administrador revogado no fim), `--rotate`, já registrado (código 2), manifest ausente, senha ausente, `https` exigido fora do dev, mensagens sem segredo.
  - [x] Fase vermelha por mutação (A3), no mínimo: registro sem exigir a permissão; sobrescrita sem `rotate`; rotação sem revogar; `call:` de domínio fora de `dependencies`; refresh emitido para serviço; inexistente sem Argon2id; segredo guardado em texto; CLI sem logout.
- [x] **T7. Verificação final**
  - [x] `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:containers`, `test:persistence` (no CI se o ubt-host02 não responder) e `test:generation`.
  - [x] Code review por story antes da 2.7b (retro A1).

### Review Findings

Code review de 2026-10-23 (Blind Hunter, Edge Case Hunter e Acceptance Auditor). 16 patches, 4 adiados, 5 descartados.

- [x] [Review][Patch] P1 (alta) Token emitido com o segredo novo no mesmo segundo da rotação nasce revogado (`at` em ms contra `iat` em s) [packages/auth/src/core/service-credential.ts:144]
- [x] [Review][Patch] P2 (alta) Rotação grava o segredo novo e depois falha na revogação (Valkey fora): o segredo novo se perde, o antigo já não vale e os tokens antigos não são revogados. Revogar antes de trocar [packages/auth/src/core/service-credential.ts:142]
- [x] [Review][Patch] P3 Troca do segredo antigo em andamento durante a rotação pode gerar token que sobrevive a ela: reler a credencial depois do Argon2id [packages/auth/src/core/service-credential.ts:179]
- [x] [Review][Patch] P4 O CLI deixa uma família de refresh de administrador viva a cada execução (o cookie do login não volta no logout) [packages/cli/src/commands/auth-register-service.ts]
- [x] [Review][Patch] P5 Segredo de serviço nunca é re-hasheado: retirar um Pepper derruba todos os serviços (o login re-hasheia) [packages/auth/src/core/service-credential.ts:179]
- [x] [Review][Patch] P6 `--rotate` num domínio sem credencial, em corrida com outro registro, responde 409 a quem pediu rotação: tentar `replace` de novo [packages/auth/src/core/service-credential.ts:143]
- [x] [Review][Patch] P7 Todo 400 do registro aponta `/domain`, mesmo para dependência ou permissão [packages/auth/src/service.ts]
- [x] [Review][Patch] P8 Timeout ou erro de rede depois do envio do registro diz "could not reach" e pode esconder um registro aplicado (segredo perdido) [packages/cli/src/commands/auth-register-service.ts]
- [x] [Review][Patch] P9 Resposta 200 que não é JSON derruba o CLI com stack trace [packages/cli/src/commands/auth-register-service.ts]
- [x] [Review][Patch] P10 Caminho em `TECTON_AUTH_URL` (ex.: `https://gw/tecton`) é descartado por `new URL('/auth/...', base)` [packages/cli/src/commands/auth-register-service.ts]
- [x] [Review][Patch] P11 `--permission` com vírgula ou espaços nas pontas é alterado em silêncio [packages/cli/src/commands/auth-register-service.ts]
- [x] [Review][Patch] P12 Aviso de logout falho com "15 minutes" fixo; usar o `expiresIn` do login [packages/cli/src/commands/auth-register-service.ts]
- [x] [Review][Patch] P13 Registro recusado ou falho (409, 400, 503) não deixa trilha de auditoria [packages/auth/src/service.ts]
- [x] [Review][Patch] P14 Só um de `services`/`serviceTokens` configurado desliga as duas actions sem erro [packages/auth/src/service.ts]
- [x] [Review][Patch] P15 `isDomainTaken` depende de "domain" no `meta` do P2002; o `id` é UUID v7, então todo P2002 do `create` é domínio repetido [packages/auth/src/adapters/prisma/prisma-service-credential-store.ts]
- [x] [Review][Patch] P16 README diz que `call:` "cannot be granted by hand", mas o servidor aceita `dependencies` de quem tem `auth:service:register`; e o teste do logout com token de serviço não confere `revokedSubjects` [packages/auth/README.md]
- [x] [Review][Defer] W1 `POST /auth/service-token` público faz um Argon2id por chamada, sem limite por origem [packages/auth/src/service.ts] — deferred, limite de taxa do Gateway (Story 3.7)
- [x] [Review][Defer] W2 Status `revoked` modelado sem fluxo que o defina, e a rotação reativa uma credencial revogada [packages/auth/src/core/service-credential.ts] — deferred, revogação de credencial de serviço fica para o admin do Directory (Epic 4)
- [x] [Review][Defer] W3 Listas como texto separado por vírgula no contrato da action [packages/auth/tecton.yaml] — deferred, o manifest não tem tipo lista (decisão da story); entra quando o formato de API ganhar arrays (Epic 5)
- [x] [Review][Defer] W4 Dependências declaradas pelo chamador da API, não lidas de uma fonte em que o Auth confie [packages/auth/src/service.ts] — deferred, o Directory (Epic 4) passa a ser a fonte

Descartados (5): leitor próprio mais estrito no logout (todo token deste emissor tem `iat` e `perms` desde a 2.2b); trocar permissões exige `--rotate` (AC 6, decisão do Boss); `.env.example` do workspace gerado (é o que a task quer); testes de persistência sem evidência (CI verde no `0b477ac`, run 40016429779, nos três bancos); mutações sem artefato (o roteiro fica fora do repositório, como nas stories anteriores).

## Dev Notes

### Decisões desta story

- **Divisão em 2.7a e 2.7b (Boss, 2026-10-23).**
- **EQ-5: login no próprio comando (Boss).** Reaproveita o padrão do `auth bootstrap` (senha por variável ou entrada padrão). O token vive só no processo e é revogado no logout do fim.
- **Permissões do serviço dadas pelo admin (Boss).** Guardadas na credencial; o token traz essas mais os `call:`.
- **Listas como texto separado por vírgula na action:** o manifest não tem tipo lista. O Auth valida cada item; a action é interna (o CLI é o cliente).
- **Segredo de 256 bits, mas hash por Argon2id:** o AC pede o `AuthProvider`; o custo do Argon2id também iguala o tempo do `serviceId` inexistente.
- **Sem bloqueio por identificador no `service-token`:** o segredo tem 256 bits; a força bruta não é viável. O rate limit do Gateway (3.7) cobre o volume.
- **O Auth verifica os próprios tokens localmente:** sem JWKS por rede; mesmas regras e a mesma revogação.
- **Fora do escopo:** chaves Ed25519 de evento do serviço (Story 3.10 estende o `register-service`); verificação do token de serviço nos domínios (2.7b).

### Código existente que esta story toca

| Arquivo | Hoje | Muda | Preservar |
|---|---|---|---|
| `packages/auth/tecton.yaml` | `login`, `refresh`, `logout`, `serviceToken` (501), todas públicas | `registerService` protegida; `serviceToken` implementada | contratos de `login`, `refresh`, `logout` |
| `packages/auth/src/service.ts` | login com bloqueio, refresh, logout com revogação, JWKS, cliente Valkey compartilhado | verificador local, `register-service`, `service-token` | tudo das stories 2.2b a 2.6 |
| `packages/auth/src/adapters/jose/access-token-issuer.ts` | emite token de usuário | emite token de serviço | claims e cabeçalho do token de usuário |
| `packages/auth/src/adapters/jose/own-access-token.ts` | leitor de token próprio para o logout | base do verificador local (com revogação) | uso no logout |
| `packages/core/src/errors/tecton-error.ts` | 400 a 503 | 409 `conflict()` | erros existentes |
| `packages/cli` | `auth bootstrap`, `auth unlock` | `auth register-service` | leitura de senha do `bootstrap` (extrair para um módulo comum) |

### Padrões a seguir (Stories 2.1 a 2.6)

- Código, mensagens, logs, ajuda do CLI e README em inglês; nunca `\uXXXX`; scripts Python com barra invertida gravam caracteres de controle (usar a ferramenta de edição).
- Erro único por classe de motivo; um Argon2id sempre na recusa; segredos nunca em mensagem nem log; datas da `Clock`; UUID v7 pela biblioteca `uuid`.
- Prisma: migration sem banco, sem `CREATE SCHEMA`, paridade de schema; testes de persistência pelo `TECTON_TEST_DB` (no CI).
- Docker remoto: túnel SSH do `.env.example`; sem ele, containers e persistência no CI.

### Perguntas ao Boss (antes do desenvolvimento)

1. Divisão: **2.7a (Auth) e 2.7b (verificação)** (2026-10-23).
2. EQ-5: **login no próprio comando** (2026-10-23).
3. Permissões do serviço: **dadas pelo administrador no registro** (2026-10-23).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.7] (critérios originais e a nota de divisão), Story 3.10 (chaves de evento no `register-service`)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#AD-7] (token de serviço, `call:<domínio>`, registro só por administrador, nunca sobrescrever sem rotação)
- [Source: _bmad-output/planning-artifacts/implementation-readiness-report-2026-10-08.md] EQ-5
- [Source: _bmad-output/test-artifacts/test-design-qa.md#P0-017, P0-018]
- [Source: Stories 2.1 (`AuthProvider`), 2.2a (bootstrap e leitura de senha), 2.5 (revogação por sujeito), 2.6 (cliente Valkey e `auth unlock`)]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), Dev Story do BMAD.

### Debug Log References

- `pnpm build`, `typecheck`, `check:deps` (165 módulos), `lint:examples`, `validate:asyncapi`: limpos.
- `pnpm test`: 59 arquivos, 940 testes verdes. `pnpm test:generation`: 3 testes verdes (o pacote empacotado leva as migrations `0003`).
- `test:containers` e `test:persistence`: sem Docker local (ubt-host02 fora do ar); rodam no CI, nos três bancos.
- Fase vermelha por mutação (A3), 15 mutações, todas mortas: registro sem exigir `auth:service:register`; sobrescrita sem `rotate`; rotação sem revogar; `call:` concedido à mão; `call:` fora das dependências; serviço inexistente sem Argon2id; segredo guardado em texto; credencial revogada aceita; token de serviço aceito como administrador; token de administrador revogado aceito; `service-token` sem `no-store`; cookie de refresh no `service-token`; CLI sem logout; CLI ignorando as dependências do manifest; CLI aceitando http fora do dev. A mutação "CLI ignorando as dependências" sobreviveu na primeira rodada (o teste só olhava a saída); o teste passou a conferir as `callees` gravadas e as `perms` do token emitido.
- Problema encontrado: o `createMemoryLoginLockout` exige o relógio (`now`) como segundo argumento; sem ele o login respondia 500 no teste do CLI.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **T1:** model `ServiceCredential` (`service_credentials`) nos dois dialetos; migrations `0003_service_credentials` geradas sem banco; paridade de schema e lista de migrations do pacote atualizadas.
- **T2:** `core/service-credential.ts` com a porta `ServiceCredentialStore`, `validatedRegistration`, `registerService` e `issueServiceToken`. **Desvio da task:** a porta tem `replace(credential): Promise<boolean>` (troca atômica num `updateMany` por domínio, mantendo `id` e `createdAt`) em vez de `rotate(domain, novo)` devolvendo a anterior. Ninguém precisava da credencial anterior: a revogação é por sujeito. Rotação de um domínio sem credencial registra (`rotated: false`). O emissor é irmão do de usuário (`createServiceTokenIssuer`, mesmo adaptador `jose`, `SERVICE_TOKEN_TTL` 60 a 900, padrão 300).
- **T3:** actions `registerService` (protegida) e `serviceToken` ligadas no `createAuthService` quando há `services` e `serviceTokens`; sem eles, 501. Verificador próprio `createOwnTokenVerifier` (chaves locais, `typ: user`, `perms`, `iat` no futuro recusado, revogação da 2.5; store fora do ar vira 503). 409 com `frameworkErrors.conflict` (novo no `@tecton/core`), 400 para registro inválido, 401 único no `service-token` com hash fictício feito na subida. `no-store` nas duas rotas. Logs `auth.service.registered`/`auth.service.rotated` com o domínio e o `sub` do administrador; nenhum segredo, hash ou token nos logs (verificado com `assertNoSecretsLeaked`). `startAuthServiceFromEnv` lê `TECTON_AUTH_SERVICE_TOKEN_TTL_SECONDS` e usa o store Prisma no cliente compartilhado. `assertValidServiceCredential` exportado para quem implementar outro store.
- **T4:** `tecton-admin auth register-service <domínio> --login <admin> [--permission]... [--rotate]`. Lê o manifest do domínio no workspace, exige `https` fora de `TECTON_ENV=development` e recusa URL com usuário ou senha. A leitura da senha foi extraída do `bootstrap` para `commands/secret-input.ts` (mesmas mensagens). Logout no `finally`; se falhar, só um aviso, sem mudar o código de saída. Códigos 0, 2 e 1. Erros de rede mostram só o tipo, nunca a URL.
- **T5:** seção "Service credentials" no README do `@tecton/auth` (registro, rotação, `service-token`, `perms`, `call:`, TTL e o risco aceito); `TECTON_AUTH_URL=http://127.0.0.1:3001` no `.env.example` da raiz do workspace gerado.
- **T6:** testes de núcleo (17), HTTP (17), emissor e variável de TTL, persistência (6, pelo CI nos três bancos) e CLI contra um Auth real em processo (20).

- **Code review (2026-10-23):** 3 revisores (Blind Hunter, Edge Case Hunter, Acceptance Auditor); 16 patches aplicados, 4 adiados (`deferred-work.md`), 5 descartados. Os principais:
  - **P1/P2, rotação.** A revogação vem antes da troca do segredo (Valkey fora: 503 e nada muda). O instante revogado cobre os tokens do segredo antigo, inclusive os datados à frente do relógio depois de um registro ou rotação recente. Os tokens do segredo novo saem com `iat` estritamente depois dele (`issuedAfter` no emissor, `ROTATION_REVOCATION_MARGIN_MS` = 1 s), por isso o `updatedAt` de uma rotação pode ficar 1 a 2 s à frente do relógio. O primeiro patch (revogar em `updatedAt` + 1 s) deixava sobreviver os tokens do segredo antigo numa rotação menos de 1 s depois da anterior; o teste HTTP de rotação no mesmo instante pegou, e a revogação passou a considerar a credencial anterior.
  - **P3:** a credencial é relida depois do Argon2id; um segredo rotacionado no meio da verificação é recusado.
  - **P4:** o CLI devolve no logout o cookie de refresh do seu login, e a sessão aberta também termina.
  - **P5:** porta `updateSecretHash` (condicional ao hash esperado, sem mexer em `updatedAt`); o segredo de serviço é re-hasheado depois de uma rotação de Pepper, como a senha no login.
  - Demais: 400 com o campo certo (`/domain`, `/dependencies`, `/permissions`); `auth.service.register_refused` com motivo; `services` e `serviceTokens` só juntos; todo P2002 do `create` é domínio repetido; CLI com mensagem própria para timeout do registro, corpo não JSON tratado, prefixo de caminho em `TECTON_AUTH_URL` mantido, `--permission` com vírgula ou espaços recusado, aviso com o `expiresIn` real; README sobre a origem dos `call:` e o re-hash.
  - Fase vermelha (A3): 16 mutações dos patches, todas mortas. P15 (`isDomainTaken`) só tem cobertura nos testes de persistência, pelo CI.
- Verificação depois da revisão: `pnpm test` 59 arquivos, 964 testes; `test:generation` 3; build, typecheck e `check:deps` limpos.

### File List

- `packages/auth/prisma/postgresql/schema.prisma`, `packages/auth/prisma/mysql/schema.prisma` (modificados)
- `packages/auth/prisma/postgresql/migrations/0003_service_credentials/migration.sql`, `packages/auth/prisma/mysql/migrations/0003_service_credentials/migration.sql` (novos)
- `packages/auth/src/core/service-credential.ts` (novo)
- `packages/auth/src/core/service-credential.test.ts` (novo)
- `packages/auth/src/core/memory-service-credential-store.test-helper.ts` (novo)
- `packages/auth/src/adapters/prisma/prisma-service-credential-store.ts` (novo)
- `packages/auth/src/adapters/prisma/prisma-service-credential-store.persistence.test.ts` (novo)
- `packages/auth/src/adapters/prisma/client.ts` (modificado)
- `packages/auth/src/adapters/jose/access-token-issuer.ts`, `access-token-issuer.test.ts` (modificados)
- `packages/auth/src/adapters/jose/own-access-token.ts` (modificado)
- `packages/auth/src/adapters/env/config-from-env.ts`, `config-from-env.test.ts` (modificados)
- `packages/auth/src/service.ts`, `packages/auth/src/index.ts` (modificados)
- `packages/auth/src/service-token-http.test.ts` (novo)
- `packages/auth/src/manifest.test.ts`, `review-2-2b.test.ts`, `schema-parity.test.ts` (modificados)
- `packages/auth/tecton.yaml`, `packages/auth/README.md` (modificados)
- `packages/core/src/errors/tecton-error.ts` (modificado)
- `packages/cli/src/commands/auth-register-service.ts`, `auth-register-service.test.ts`, `secret-input.ts` (novos)
- `packages/cli/src/commands/auth-bootstrap.ts`, `packages/cli/src/cli.ts` (modificados)
- `packages/cli/src/dev-services.ts`, `dev-services.test.ts`, `commands/new.generation.test.ts` (modificados)

## Change Log

- 2026-10-23: Story criada (Create Story), com a divisão da 2.7 e as decisões do Boss sobre o EQ-5 e as permissões do serviço.
- 2026-10-23: Dev Story concluída (T1 a T7, salvo o code review); status `review`.
- 2026-10-23: Code review: 16 patches aplicados, 4 adiados, 5 descartados; status `done`.
