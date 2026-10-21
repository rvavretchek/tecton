# Story 2.5: `TokenRevocationStore` com Valkey e fail-closed

Status: ready-for-dev

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

- [ ] **T1. Dependência (AC: todos)**
  - [ ] `@tecton/providers` → `dependencies`: `ioredis` 6.0.0, versão fixa (aprovado pelo Boss em 2026-10-20; de 31/07, dentro da idade mínima de release). Conferir na instalação que traz os próprios tipos e nenhum script de instalação.
- [ ] **T2. Porta (AC: 1, 3, 4)** — `packages/providers/src/revocation/token-revocation-store.ts`
  - [ ] `TokenRevocationStore`:
    - `revokeToken({ tokenId, expiresAt })`;
    - `revokeSubject({ subject, at })`;
    - `isRevoked({ tokenId, subject, issuedAt })`: `Promise<boolean>`, uma ida só ao Valkey;
    - `close()`.
  - [ ] `RevocationStoreUnavailableError`: inacessível, tempo esgotado ou resposta inesperada. Mensagem sem URL nem senha.
  - [ ] Identificadores validados (string não vazia, até 128 caracteres, sem caracteres de controle); inválido é `RangeError` (erro de programação, não de token).
- [ ] **T3. Adaptador Valkey (AC: 1, 3, 4)** — `packages/providers/src/revocation/valkey-token-revocation-store.ts`
  - [ ] `createValkeyTokenRevocationStore({ url, timeoutMs = 500, keyPrefix = 'tecton:revocation:', maxTokenLifetimeSeconds = 3600, clock, onError? })`:
    - URL `redis://` ou `rediss://` (TLS); outra coisa é erro de configuração na criação, sem ecoar a URL;
    - `ioredis` com `commandTimeout: timeoutMs`, `enableOfflineQueue: false` e `maxRetriesPerRequest: 0` (nada espera conexão: sem Valkey, o comando falha na hora), reconexão em segundo plano, conexão iniciada na criação sem bloquear a subida (`lazyConnect` mais `connect()` sem `await`, com o erro absorvido);
    - todo evento `error` do cliente vai para `onError` (nunca sem listener: o processo cairia);
    - aceita `client` injetável (a mesma interface mínima) para testes unitários sem Docker.
  - [ ] Chaves: `<prefixo>jti:<jti>` (valor `1`, `PX` = `expiresAt` + 30 s − agora; nada se ≤ 0) e `<prefixo>sub:<sujeito>` (valor = instante da revogação em ms, `EX` = `maxTokenLifetimeSeconds` + 30). A gravação do sujeito nunca recua o instante (script Lua pequeno: grava só se maior que o atual).
  - [ ] `isRevoked`: `MGET` das duas chaves; revogado se o `jti` existe ou se `issuedAt` (ms) ≤ instante do sujeito. Valor que não é número conta como revogado (fail-closed).
  - [ ] Todo erro do cliente vira `RevocationStoreUnavailableError`.
  - [ ] `tokenRevocationStoreFromEnv(env, options)`: `TECTON_VALKEY_URL` (obrigatória) e `TECTON_REVOCATION_TIMEOUT_MS` (opcional, inteiro decimal de 50 a 5000). Mensagens com o nome da variável, nunca o valor.
  - [ ] Exportar porta, erro, adaptador e leitura de ambiente no `index.ts` do `@tecton/providers`.
- [ ] **T4. Verificador (AC: 2, 3, 4, 7)** — `packages/core/src/auth/token-verifier.ts`
  - [ ] `createTokenVerifier` recebe `revocations: TokenRevocationStore` (**obrigatório**). No ponto de extensão marcado na 2.4 (depois do `jwtVerify` e das checagens de claims): `isRevoked({ tokenId: jti, subject: sub, issuedAt })`; revogado é `InvalidTokenError` (401); `RevocationStoreUnavailableError` é `TokenVerificationUnavailableError` (503), com o motivo no log da rota.
  - [ ] `tokenVerifierFromEnv` monta o store por `tokenRevocationStoreFromEnv` (obrigatório).
  - [ ] `startDomainServer` fecha o store no `onClose` do app.
  - [ ] Preservar todo o comportamento da 2.4 (ordem das checagens, cache do JWKS, 401/403/503, `principal`).
- [ ] **T5. Serviço de Auth (AC: 5, 6, 7)** — `packages/auth`
  - [ ] `createAuthService` recebe `revocations: TokenRevocationStore`; `startAuthServiceFromEnv` exige `TECTON_VALKEY_URL` (fecha o store no `onClose` e na falha de subida, como o cliente Prisma).
  - [ ] Logout: se houver `Authorization: Bearer` válido emitido por este Auth (assinatura pelas próprias chaves públicas, `iss`, `aud`, `typ: at+jwt`, `typ: user`, `exp` com a tolerância), revoga o `jti` até o `exp`. Verificação local pelas chaves do próprio Auth (`createLocalJWKSet` sobre `keys.publicJwks`), nunca por rede. Ordem: apagar o cookie, revogar a família, revogar o access token. Falha do Valkey na revogação do access token: 503 com o cookie já apagado e a família já revogada, e log de erro sem token.
  - [ ] Reuso (`onReuseDetected`): `revokeSubject({ subject, at: agora })`. Falha do Valkey: log de erro (`event: auth.refresh_token.reuse.revocation_failed`, sem token); o refresh continua 401.
  - [ ] `.env` gerado: nada novo (o `TECTON_VALKEY_URL` já está no `.env.example` da raiz, que o `apps/auth` e os domínios leem).
  - [ ] README do `@tecton/auth` e do `@tecton/core`: revogação, `TECTON_VALKEY_URL`, `TECTON_REVOCATION_TIMEOUT_MS`, 503 quando o Valkey falha.
- [ ] **T6. Testes (AC: todos)** — Test Design P0-015 (6) e a parte de revogação de P0-002 (R-09)
  - [ ] `tests/support`: `createMemoryTokenRevocationStore()` com o mesmo contrato da porta e um modo "indisponível", para testes sem Docker.
  - [ ] Unitários do adaptador (cliente falso): chaves e prefixo, `PX` e `EX` calculados pela `clock`, token expirado sem gravação, `MGET` numa ida, valor corrompido conta como revogado, erro do cliente vira `RevocationStoreUnavailableError`, URL e variáveis de ambiente.
  - [ ] Containers (`*.containers.test.ts`, Valkey real por `startValkey` e Toxiproxy por `startFaultLab`):
    - revogação por `jti` com TTL = restante (conferir `PTTL`) (P0-015);
    - revogação por sujeito: token anterior revogado, posterior válido, instante nunca recua (P0-015);
    - Valkey fora (`withDependencyDown`) e Valkey lento (toxic de latência maior que o limite): `RevocationStoreUnavailableError` em até o tempo limite mais uma folga (P0-002, R-09);
    - volta a funcionar quando o Valkey volta (reconexão).
  - [ ] Verificador (`@tecton/core`, store em memória): `jti` revogado → 401; sujeito revogado antes do `iat` → 401, depois → aceito; store indisponível → 503 pelas rotas; `revocations` obrigatório; `tokenVerifierFromEnv` sem `TECTON_VALKEY_URL` falha nomeando a variável.
  - [ ] Auth (HTTP, store em memória): logout com Bearer válido revoga o `jti` até o `exp`; com Bearer de outra chave, inválido ou ausente não revoga nada além da família; reuso revoga o sujeito; Valkey indisponível no logout dá 503 com o cookie apagado e a família revogada (P0-015).
  - [ ] Ponta a ponta (containers): login no Auth, token aceito por um verificador ligado ao mesmo Valkey, logout com o Bearer, o mesmo token passa a 401 (FR-14).
  - [ ] Geração: o domínio e o `apps/auth` sobem com `TECTON_VALKEY_URL` apontando para uma porta fechada; o domínio responde 401 sem token e **503** com token válido (fail-closed provado no workspace gerado).
  - [ ] Segredos: token, senha e URL do Valkey com senha nunca em log nem em mensagem.
  - [ ] Fase vermelha por mutação (A3), no mínimo: revogado tratado como não revogado; erro do Valkey tratado como não revogado; TTL fixo em vez do restante; comparação de `iat` com `<` em vez de `≤`; instante do sujeito recuando; logout sem revogar o access token; reuso sem revogar o sujeito; verificador sem a checagem.
- [ ] **T7. Verificação final**
  - [ ] `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:containers` e `test:persistence` (local pelo túnel se o ubt-host02 responder; no CI em todo caso) e `test:generation`.
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

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

## Change Log

- 2026-10-20: Story criada (Create Story), com as decisões do Boss sobre `ioredis` e revogação obrigatória.
