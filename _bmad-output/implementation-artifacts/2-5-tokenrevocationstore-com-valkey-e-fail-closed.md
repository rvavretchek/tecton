---
baseline_commit: eabf516ee6a2507ba2afca751b93c92c8ca5a85a
---

# Story 2.5: `TokenRevocationStore` com Valkey e fail-closed

Status: review

## Story

Como **operador de um sistema construído com o Tecton**,
quero revogar um token e vê-lo rejeitado em todos os serviços imediatamente,
para não precisar esperar a expiração natural quando uma sessão é comprometida (FR-14, Constitution §9).

## Acceptance Criteria

1. **Revogação por `jti`.** Dado a porta `TokenRevocationStore` em `@tecton/providers` e o adaptador de referência Valkey, quando um token é revogado pelo `jti`, então a revogação é gravada no Valkey com tempo de vida igual ao que falta para o token expirar (mais a tolerância de relógio de 30 s da 2.4), sob chave com prefixo próprio do framework (`tecton:revocation:`). Um token já expirado não grava nada.
2. **Rejeição em todo serviço.** Dado um token revogado, quando ele é apresentado a qualquer serviço depois da revogação, então o verificador da Story 2.4 o rejeita com 401, sem esperar o `exp` (FR-14).
3. **Revogação por sujeito.** Dado uma revogação de todos os tokens de um sujeito (ex.: conta desativada), quando ela é registrada, então todo token desse sujeito com `iat` até o instante da revogação passa a ser rejeitado. Tokens emitidos depois continuam válidos. Uma revogação nova nunca recua o instante já gravado.
4. **Fail-closed.** Dado um Valkey inacessível ou que não responde dentro do tempo limite configurado (padrão 500 ms), quando um serviço precisa checar a revogação, então a requisição é recusada com **503** e `Retry-After` (a mesma resposta da verificação indisponível da 2.4), nunca tratada como "não revogado" (FR-14, Constitution §9).
5. **Logout revoga o access token.** Dado um logout (Story 2.3) com `Authorization: Bearer <access token>` válido emitido por este Auth, quando ele é concluído, então o access token também é revogado, além da família do refresh. Sem Bearer ou com Bearer inválido, o logout continua revogando só a família.
6. **Reuso revoga os access tokens do sujeito.** Dado a detecção de reuso de refresh (Story 2.3), quando ela acontece, então os access tokens do sujeito emitidos até aquele momento também são revogados.
7. **Obrigatória (decisão do Boss, 2026-10-20).** Dado um serviço com action protegida (ou o serviço de Auth), quando ele sobe sem `TECTON_VALKEY_URL`, então a inicialização falha com mensagem clara. Esquecer o Valkey nunca desliga a revogação em silêncio.

> **Nota (epics.md):** o Valkey local de desenvolvimento vem do Dev Services (Story 1.11). Os testes desta story rodam contra um Valkey real em container.

## Tasks / Subtasks

- [x] **T1. Dependência (AC: todos)**
  - [x] `@tecton/providers` → `dependencies`: `ioredis` 6.0.0, versão fixa (aprovado pelo Boss em 2026-10-20; de 31/07, dentro da idade mínima de release). Conferir na instalação que traz os próprios tipos e nenhum script de instalação.
- [x] **T2. Porta (AC: 1, 3, 4)** — `packages/providers/src/revocation/token-revocation-store.ts`
  - [x] `TokenRevocationStore`:
    - `revokeToken({ tokenId, expiresAt })`;
    - `revokeSubject({ subject, at })`;
    - `isRevoked({ tokenId, subject, issuedAt })`: `Promise<boolean>`, uma ida só ao Valkey;
    - `close()`.
  - [x] `RevocationStoreUnavailableError`: inacessível, tempo esgotado ou resposta inesperada. Mensagem sem URL nem senha.
  - [x] Identificadores validados (string não vazia, até 128 caracteres, sem caracteres de controle); inválido é `RangeError` (erro de programação, não de token).
- [x] **T3. Adaptador Valkey (AC: 1, 3, 4)** — `packages/providers/src/revocation/valkey-token-revocation-store.ts`
  - [x] `createValkeyTokenRevocationStore({ url, timeoutMs = 500, keyPrefix = 'tecton:revocation:', maxTokenLifetimeSeconds = 3600, clock, onError? })`:
    - URL `redis://` ou `rediss://` (TLS); outra coisa é erro de configuração na criação, sem ecoar a URL;
    - `ioredis` com `commandTimeout: timeoutMs`, `enableOfflineQueue: false` e `maxRetriesPerRequest: 0` (nada espera conexão: sem Valkey, o comando falha na hora), reconexão em segundo plano, conexão iniciada na criação sem bloquear a subida (`lazyConnect` mais `connect()` sem `await`, com o erro absorvido);
    - todo evento `error` do cliente vai para `onError` (nunca sem listener: o processo cairia);
    - aceita `client` injetável (a mesma interface mínima) para testes unitários sem Docker.
  - [x] Chaves: `<prefixo>jti:<jti>` (valor `1`, `PX` = `expiresAt` + 30 s − agora; nada se ≤ 0) e `<prefixo>sub:<sujeito>` (valor = instante da revogação em ms, `EX` = `maxTokenLifetimeSeconds` + 30). A gravação do sujeito nunca recua o instante (script Lua pequeno: grava só se maior que o atual).
  - [x] `isRevoked`: `MGET` das duas chaves; revogado se o `jti` existe ou se `issuedAt` (ms) ≤ instante do sujeito. Valor que não é número conta como revogado (fail-closed).
  - [x] Todo erro do cliente vira `RevocationStoreUnavailableError`.
  - [x] `tokenRevocationStoreFromEnv(env, options)`: `TECTON_VALKEY_URL` (obrigatória) e `TECTON_REVOCATION_TIMEOUT_MS` (opcional, inteiro decimal de 50 a 5000). Mensagens com o nome da variável, nunca o valor.
  - [x] Exportar porta, erro, adaptador e leitura de ambiente no `index.ts` do `@tecton/providers`.
- [x] **T4. Verificador (AC: 2, 3, 4, 7)** — `packages/core/src/auth/token-verifier.ts`
  - [x] `createTokenVerifier` recebe `revocations: TokenRevocationStore` (**obrigatório**). No ponto de extensão marcado na 2.4 (depois do `jwtVerify` e das checagens de claims): `isRevoked({ tokenId: jti, subject: sub, issuedAt })`; revogado é `InvalidTokenError` (401); `RevocationStoreUnavailableError` é `TokenVerificationUnavailableError` (503), com o motivo no log da rota.
  - [x] `tokenVerifierFromEnv` monta o store por `tokenRevocationStoreFromEnv` (obrigatório).
  - [x] `startDomainServer` fecha o store no `onClose` do app.
  - [x] Preservar todo o comportamento da 2.4 (ordem das checagens, cache do JWKS, 401/403/503, `principal`).
- [x] **T5. Serviço de Auth (AC: 5, 6, 7)** — `packages/auth`
  - [x] `createAuthService` recebe `revocations: TokenRevocationStore`; `startAuthServiceFromEnv` exige `TECTON_VALKEY_URL` (fecha o store no `onClose` e na falha de subida, como o cliente Prisma).
  - [x] Logout: se houver `Authorization: Bearer` válido emitido por este Auth (assinatura pelas próprias chaves públicas, `iss`, `aud`, `typ: at+jwt`, `typ: user`, `exp` com a tolerância), revoga o `jti` até o `exp`. Verificação local pelas chaves do próprio Auth (`createLocalJWKSet` sobre `keys.publicJwks`), nunca por rede. Ordem: apagar o cookie, revogar a família, revogar o access token. Falha do Valkey na revogação do access token: 503 com o cookie já apagado e a família já revogada, e log de erro sem token.
  - [x] Reuso (`onReuseDetected`): `revokeSubject({ subject, at: agora })`. Falha do Valkey: log de erro (`event: auth.refresh_token.reuse.revocation_failed`, sem token); o refresh continua 401.
  - [x] `.env` gerado: nada novo (o `TECTON_VALKEY_URL` já está no `.env.example` da raiz, que o `apps/auth` e os domínios leem).
  - [x] README do `@tecton/auth` e do `@tecton/core`: revogação, `TECTON_VALKEY_URL`, `TECTON_REVOCATION_TIMEOUT_MS`, 503 quando o Valkey falha.
- [x] **T6. Testes (AC: todos)** — Test Design P0-015 (6) e a parte de revogação de P0-002 (R-09)
  - [x] `tests/support`: `createMemoryTokenRevocationStore()` com o mesmo contrato da porta e um modo "indisponível", para testes sem Docker.
  - [x] Unitários do adaptador (cliente falso): chaves e prefixo, `PX` e `EX` calculados pela `clock`, token expirado sem gravação, `MGET` numa ida, valor corrompido conta como revogado, erro do cliente vira `RevocationStoreUnavailableError`, URL e variáveis de ambiente.
  - [x] Containers (`*.containers.test.ts`, Valkey real por `startValkey` e Toxiproxy por `startFaultLab`):
    - revogação por `jti` com TTL = restante (conferir `PTTL`) (P0-015);
    - revogação por sujeito: token anterior revogado, posterior válido, instante nunca recua (P0-015);
    - Valkey fora (`withDependencyDown`) e Valkey lento (toxic de latência maior que o limite): `RevocationStoreUnavailableError` em até o tempo limite mais uma folga (P0-002, R-09);
    - volta a funcionar quando o Valkey volta (reconexão).
  - [x] Verificador (`@tecton/core`, store em memória): `jti` revogado → 401; sujeito revogado antes do `iat` → 401, depois → aceito; store indisponível → 503 pelas rotas; `revocations` obrigatório; `tokenVerifierFromEnv` sem `TECTON_VALKEY_URL` falha nomeando a variável.
  - [x] Auth (HTTP, store em memória): logout com Bearer válido revoga o `jti` até o `exp`; com Bearer de outra chave, inválido ou ausente não revoga nada além da família; reuso revoga o sujeito; Valkey indisponível no logout dá 503 com o cookie apagado e a família revogada (P0-015).
  - [x] Ponta a ponta (containers): login no Auth, token aceito por um verificador ligado ao mesmo Valkey, logout com o Bearer, o mesmo token passa a 401 (FR-14).
  - [x] Geração: o domínio e o `apps/auth` sobem com `TECTON_VALKEY_URL` apontando para uma porta fechada; o domínio responde 401 sem token e **503** com token válido (fail-closed provado no workspace gerado).
  - [x] Segredos: token, senha e URL do Valkey com senha nunca em log nem em mensagem.
  - [x] Fase vermelha por mutação (A3), no mínimo: revogado tratado como não revogado; erro do Valkey tratado como não revogado; TTL fixo em vez do restante; comparação de `iat` com `<` em vez de `≤`; instante do sujeito recuando; logout sem revogar o access token; reuso sem revogar o sujeito; verificador sem a checagem.
- [x] **T7. Verificação final**
  - [x] `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:containers` e `test:persistence` (local pelo túnel se o ubt-host02 responder; no CI em todo caso) e `test:generation`.
  - [ ] Code review por story antes da 2.6 (retro A1).

## Dev Notes

### Decisões desta story

- **`ioredis` 6.0.0 (Boss, 2026-10-20):** cliente de referência para o Valkey no framework (esta story; depois Streams, lockout e rate limit). As opções `commandTimeout`, `enableOfflineQueue: false` e `maxRetriesPerRequest: 0` dão o fail-closed sem espera.
- **Revogação obrigatória (Boss):** sem `TECTON_VALKEY_URL`, nenhum serviço com action protegida sobe, e o Auth também não.
- **503 quando o Valkey falha:** mesma resposta e mesmo motivo de negócio da 2.4 (a verificação está indisponível, o token pode estar certo; o cliente tenta de novo em vez de deslogar).
- **Sujeito por instante, em ms, com `≤`:** o `iat` tem precisão de segundo; um token emitido no mesmo segundo da revogação também é recusado (conservador).
- **TTL com a tolerância de 30 s:** o verificador aceita até 30 s além do `exp` (2.4); a revogação precisa durar o mesmo.
- **Logout verifica o Bearer localmente:** o Auth tem as próprias chaves; nada de rede nem de JWKS.
- **Valor corrompido no Valkey conta como revogado:** fail-closed.
- **Falha do Valkey no reuso só vai para o log:** o refresh já é 401 e a família já foi revogada no banco; os access tokens do sujeito expiram em no máximo 15 min. Registrar no log é o que dá para fazer sem bloquear.

### Código existente que esta story toca

| Arquivo | Hoje | Muda | Preservar |
|---|---|---|---|
| `packages/providers/src/index.ts` | `AuthProvider`, Argon2id, Pepper, `Clock` | exporta revogação | exports atuais |
| `packages/core/src/auth/token-verifier.ts` | verificação da 2.4 com cache próprio do JWKS e ponto de extensão marcado para a revogação | `revocations` obrigatório e a checagem | ordem das checagens, erros, cache, tolerância |
| `packages/core/src/domain-server.ts` | monta o verificador pelo ambiente | fecha o store | regra de action pública, `host` e `port` |
| `packages/auth/src/service.ts` | login, refresh, logout, JWKS, `no-store`, cookie | `revocations`, revogação no logout e no reuso | tudo da 2.3 e do review da 2.3 (ordem do logout, 503 do logout com cookie apagado) |
| `packages/auth/src/core/session.ts` | `onReuseDetected` | o serviço liga ao `revokeSubject` | contrato da porta `RefreshTokenStore` |
| `tests/support` | `tokenFactory`, `jwksTls`, `startValkey`, `startFaultLab` | store em memória | exports atuais |

### Fora desta story (não fazer)

- Revogar por sujeito ao desativar uma credencial (a desativação pelo admin é da 4.3).
- Bloqueio por identificador (2.6), token de serviço (2.7), rate limit (3.7), Streams (Epic 3).
- `ConfigProvider` (3.1): a leitura de ambiente continua mínima.

### Padrões a seguir (Stories 2.1 a 2.4)

- Código, mensagens, logs e README em inglês; nunca `\uXXXX` em arquivo novo; cuidado com scripts que convertem `\n` dentro de strings (erro repetido na 2.2b e na 2.4: preferir a ferramenta de edição).
- Erro único por classe de motivo; segredos nunca em mensagem nem log (`assertNoSecretsLeaked`); datas da `Clock`.
- Cada app lê o `.env` da raiz e depois o próprio (D1 do review da 2.4); o `TECTON_VALKEY_URL` mora na raiz.
- Docker remoto: túnel SSH do `.env.example`. Se o ubt-host02 não responder, `test:containers` roda no job `containers` do CI.

### Perguntas ao Boss (antes do desenvolvimento)

1. Cliente Valkey: **`ioredis` 6.0.0** (2026-10-20).
2. Revogação obrigatória em todo serviço com action protegida: **sim** (2026-10-20).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5], Stories 2.3 (logout e reuso), 2.4 (verificador e ponto de extensão) e 2.6 (Valkey no lockout)
- [Source: _bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md#FR-14] (Valkey-backed real, fail-closed)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md] AD-1 (porta e adaptador), AD-7, tabela de stack (Valkey 9.1, compatível com `ioredis`)
- [Source: _bmad-output/test-artifacts/test-design-qa.md#P0-015, P0-002], R-09; `tests/support/network-faults.ts`
- [Source: CONSTITUTION.md §9]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- **`ioredis` 6.0.0:** traz os próprios tipos e nenhum script de instalação; dependências `@ioredis/commands`, `cluster-key-slot`, `debug`, `denque`, `redis-errors` e `standard-as-callback`. O aviso de peer do `pnpm install` é antigo (`madge` pedindo TypeScript 5).
- **`@tecton/core` depende de `@tecton/providers`:** permitido pela emenda de 2026-10-01 da Spine; dependência e referência de projeto TypeScript acrescentadas.
- **Ordem no `tokenVerifierFromEnv`:** a URL do JWKS é validada antes de o store abrir conexão, para um erro de JWKS não ficar escondido atrás do erro do Valkey; se o verificador não puder ser montado, o store é fechado.
- **`TokenVerifier.close()` (opcional):** o verificador montado pelo ambiente pertence ao servidor de domínio, que o fecha no `onClose` e numa falha de subida.
- **Teste do CA pelo ambiente sem Valkey:** passou a provar que o JWKS foi buscado pelo CA pelo fato de a falha acontecer depois, na revogação ("revocation could not be checked").
- **Store em memória no `tests/support`:** tipado estruturalmente (o `tests/support` não depende de pacote) e com o erro de indisponibilidade recebido por parâmetro.
- **Verificador próprio do Auth para o logout:** `adapters/jose/own-access-token.ts`, com as chaves públicas do próprio Auth, `iss`/`aud` configurados e a mesma tolerância de 30 s.
- **Docker remoto inacessível:** os testes `*.containers.test.ts` novos (store com Valkey real e Toxiproxy fora do ar e lento; ponta a ponta Auth e verificador) rodam no job `containers` do CI.
- **Fase vermelha por mutação (A3),** cada uma restaurada:

  | Mutação | Testes que falharam |
  |---|---|
  | revogado tratado como não revogado | 3 |
  | erro do Valkey tratado como não revogado | 3 |
  | TTL fixo em vez do restante | 1 |
  | `iat` com `<` em vez de `<=` | 1 |
  | sem a tolerância no TTL do `jti` | 1 |
  | valor corrompido como não revogado | 1 |
  | resposta inesperada do `MGET` aceita | 1 |
  | logout sem revogar o access token | 2 |
  | reuso sem revogar o sujeito | 2 |
  | logout com o Valkey fora respondendo 200 | 1 |
  | verificador sem exigir o store | 1 |
  | `TECTON_VALKEY_URL` opcional | 3 |

  A mutação "instante do sujeito recuando" mora no script Lua e só se exercita com Valkey real: coberta pelo teste de containers (`revokeSubject` com instante anterior não muda o valor gravado).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Porta (`@tecton/providers`):** `TokenRevocationStore` (`revokeToken`, `revokeSubject`, `isRevoked`, `close`), `RevocationStoreUnavailableError` e validação de identificadores.
- **Adaptador Valkey:** `createValkeyTokenRevocationStore` com `ioredis` (`commandTimeout`, sem fila offline, sem retry por comando, conexão em segundo plano, todo `error` com listener), chaves `tecton:revocation:jti:` (TTL = restante + 30 s) e `tecton:revocation:sub:` (instante em ms, nunca recua, por script Lua), `MGET` numa ida, valor corrompido conta como revogado; `tokenRevocationStoreFromEnv` com `TECTON_VALKEY_URL` (obrigatória) e `TECTON_REVOCATION_TIMEOUT_MS`.
- **Verificador (`@tecton/core`):** `revocations` obrigatório; revogado é 401 e store indisponível é 503 com o motivo no log; `tokenVerifierFromEnv` exige o Valkey; o servidor de domínio fecha o store.
- **Auth:** `revocations` obrigatório; logout revoga o Bearer válido do próprio Auth até o `exp` (503 se o Valkey falhar, com cookie apagado e família revogada); reuso revoga o sujeito (falha só no log); `startAuthServiceFromEnv` exige `TECTON_VALKEY_URL` e fecha o store na falha de subida.
- **Workspace gerado:** nada novo no `.env.example` (o `TECTON_VALKEY_URL` já estava na raiz). O teste de geração prova o fail-closed: sem Valkey, o domínio responde 401 sem token e 503 com token válido.
- **Testes:** store (24 unitários e 4 com Valkey real), verificador (6), rotas (1), servidor de domínio (1), Auth HTTP (8), ponta a ponta com Valkey real (1), geração.
- **Verificação local:** build, typecheck, `check:deps` (145 módulos), `lint:examples`, `validate:asyncapi`, `test` (804) e `test:generation` (3). `test:containers` e `test:persistence`: pelo CI.
- **Pendente:** o code review (A1), próximo passo.

### File List

- `packages/providers/package.json` (`ioredis` 6.0.0), `pnpm-lock.yaml`
- `packages/providers/src/revocation/{token-revocation-store,valkey-token-revocation-store}.ts`, `valkey-token-revocation-store.test.ts`, `valkey-token-revocation-store.containers.test.ts` (novos); `src/index.ts` (modificado)
- `packages/core/package.json`, `tsconfig.json` (dependência de `@tecton/providers`), `src/auth/token-verifier.ts`, `token-verifier.test.ts`, `src/domain-server.ts`, `domain-server.test.ts`, `src/routes-auth.test.ts`, `README.md` (modificados)
- `packages/auth/src/adapters/jose/own-access-token.ts`, `src/revocation-http.test.ts`, `src/revocation.containers.test.ts` (novos); `src/service.ts`, `service.test.ts`, `review-2-2b.test.ts`, `refresh-http.test.ts`, `adapters/prisma/{prisma-credential-store,prisma-refresh-token-store}.persistence.test.ts`, `README.md` (modificados)
- `packages/cli/src/commands/new.generation.test.ts` (modificado)
- `tests/support/revocations.ts` (novo), `tests/support/index.ts` (modificado)
- Esta story, `sprint-status.yaml`

## Change Log

- 2026-10-20: Story criada (Create Story), com as decisões do Boss sobre `ioredis` e revogação obrigatória.
- 2026-10-21: Story implementada (Dev Story); testes com Valkey real a confirmar no CI; status → review.
