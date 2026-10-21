# Story 2.6: Bloqueio de login por identificador

Status: ready-for-dev

## Story

Como **operador de um sistema construído com o Tecton**,
quero que um login seja bloqueado temporariamente depois de várias senhas erradas, venham de onde vierem,
para que um ataque distribuído contra uma única conta não escape do rate limit por origem do Gateway (FR-12, NFR-1).

## Acceptance Criteria

1. **Contagem e bloqueio.** Dado um identificador de login normalizado, quando acontecem N falhas dentro da janela configurada (padrão: 5 falhas em 15 minutos), então o login desse identificador fica bloqueado pelo tempo configurado (padrão: 15 minutos). O contador fica no Valkey, compartilhado entre todas as instâncias do serviço de Auth.
   - Conta como falha toda recusa do login com identificador válido: senha errada, credencial desativada, login inexistente, credencial corrompida.
   - A tentativa que atinge o limite ainda recebe o 401 de sempre; as seguintes recebem o 429.
2. **Bloqueado não verifica senha.** Dado um identificador bloqueado, quando chega uma tentativa de login, mesmo com a senha correta, então a resposta é 429 com `Retry-After` (segundos que faltam, arredondados para cima) e a senha não é verificada (nenhum Argon2id, nenhuma consulta ao banco).
3. **Inexistente igual a existente.** Dado um identificador que não existe, quando ele recebe tentativas de login, então o contador e o bloqueio funcionam igual a um identificador existente, para que o bloqueio não revele quais logins existem.
4. **Por identificador, não por origem.** Dado tentativas vindas de várias origens diferentes contra o mesmo identificador, quando o limite é atingido, então o bloqueio acontece do mesmo jeito.
5. **Sucesso zera.** Dado um login bem-sucedido antes de atingir o limite, quando ele acontece, então o contador de falhas desse identificador é zerado.
6. **Evento de segurança.** Dado um bloqueio aplicado, quando ele acontece, então um evento de segurança é registrado em log (em inglês, `event: auth.login.locked`), com o identificador e a duração, e sem nenhuma senha.
7. **Desbloqueio pelo administrador.** Dado um administrador que precisa liberar uma conta antes do prazo, quando ele roda `tecton-admin auth unlock <identificador>`, então o bloqueio e o contador desse identificador são removidos. O comando normaliza o identificador do mesmo jeito que o login e acessa o Valkey diretamente (como o `auth bootstrap` acessa o banco: só localmente, sem endpoint HTTP).
8. **Fail-closed.** Dado um Valkey inacessível ou lento (tempo limite de 500 ms, o da Story 2.5), quando chega uma tentativa de login, então ela é rejeitada com 503 e `Retry-After` (coerente com a 2.5), sem verificar a senha.

> **Risco aceito (auditoria de segurança de 2026-10-06):** como a contagem é por identificador, alguém pode bloquear de propósito a conta de outra pessoa errando a senha dela. É o custo conhecido de bloquear por conta; o `tecton-admin auth unlock` existe para isso. Registrar no README do `@tecton/auth` (documentação de operação).

## Tasks / Subtasks

- [ ] **T1. Cliente Valkey compartilhado (AC: 1, 8)** — `packages/providers`
  - [ ] Extrair a criação do cliente do adaptador da 2.5 para `src/valkey/valkey-client.ts`: `createValkeyClient({ url, timeoutMs, onError })` com as mesmas opções fail-closed (`commandTimeout`, sem fila offline, sem retry por comando, conexão em segundo plano, `disconnect()` quando o `quit` falha, validação de `redis://`/`rediss://` e de host). `valkeyClientFromEnv(env, options)` lê `TECTON_VALKEY_URL` e `TECTON_REVOCATION_TIMEOUT_MS` (o mesmo tempo limite para todo uso do Valkey; o nome da variável continua por compatibilidade).
  - [ ] O store de revogação aceita o cliente compartilhado (`{ client }`) além da URL, sem mudar o comportamento da 2.5 (os testes da 2.5 continuam passando). Um store que recebe o cliente não o fecha.
- [ ] **T2. Porta e adaptador do bloqueio (AC: 1 a 5, 8)** — `packages/providers/src/lockout/`
  - [ ] Porta `LoginLockout`:
    - `check(identifier)` → `{ locked: false }` ou `{ locked: true, retryAfterSeconds }`;
    - `recordFailure(identifier)` → `{ lockedNow: boolean, retryAfterSeconds? }` (atômico);
    - `reset(identifier)` (sucesso e `unlock`);
    - `close()`.
  - [ ] `LoginLockoutUnavailableError` (Valkey inacessível, lento ou resposta inesperada), sem URL.
  - [ ] Adaptador Valkey `createValkeyLoginLockout({ client | url, maxFailures = 5, windowSeconds = 900, lockSeconds = 900, keyPrefix = 'tecton:lockout:' })`:
    - chaves pelo SHA-256 em hexadecimal do identificador normalizado (o login não fica em texto no Valkey e o tamanho da chave é fixo): `<prefixo>fail:<hash>` e `<prefixo>lock:<hash>`;
    - `recordFailure` num script Lua: `INCR` do contador, `PEXPIRE` da janela na primeira falha; ao atingir `maxFailures`, grava a chave de bloqueio com `PX` = duração e apaga o contador; devolve se bloqueou agora e o TTL;
    - `check`: `PTTL` da chave de bloqueio (> 0 é bloqueado; `Retry-After` = `ceil(pttl/1000)`);
    - `reset`: `DEL` das duas chaves;
    - todo erro do cliente vira `LoginLockoutUnavailableError`;
    - limites validados na criação: `maxFailures` 1 a 100, janela e duração de 60 a 86400 s.
  - [ ] `loginLockoutFromEnv(env, { client })`: `TECTON_AUTH_LOCKOUT_MAX_FAILURES`, `TECTON_AUTH_LOCKOUT_WINDOW_SECONDS`, `TECTON_AUTH_LOCKOUT_DURATION_SECONDS` (inteiros decimais, mensagens com o nome da variável).
  - [ ] Exportar no `index.ts` do `@tecton/providers`.
- [ ] **T3. Login (AC: 1 a 6, 8)** — `packages/auth/src/core/login.ts` e `service.ts`
  - [ ] `LoginDependencies.lockout: LoginLockout` (obrigatório).
  - [ ] Ordem: normalizar → `check` (bloqueado: `LoginLockedError(retryAfterSeconds)`, sem consulta ao banco nem Argon2id) → buscar a credencial e verificar a senha como hoje (um Argon2id sempre) → recusa: `recordFailure` (se bloqueou agora, `onLocked({ identifier, lockSeconds })`) e o `InvalidCredentialsError` de sempre → sucesso: `reset` e a emissão de hoje.
  - [ ] Login malformado (não normaliza): não conta e não consulta o Valkey (não há identificador; a regra de formato é pública). Continua com o Argon2id fictício e o 401 de sempre.
  - [ ] `LoginLockoutUnavailableError` em qualquer passo: 503 (`frameworkErrors.authUnavailable()`), sem verificar a senha quando falha no `check`.
  - [ ] `@tecton/core`: `frameworkErrors.tooManyRequests(retryAfterSeconds)` (429, `too-many-requests`, `tecton.error.tooManyRequests`, `Retry-After`, mensagem genérica) e 429 no esquema das rotas (o Gateway da 3.7 também responde 429).
  - [ ] Serviço: `onLocked` registra `warn` com `event: 'auth.login.locked'`, o identificador normalizado e a duração; `startAuthServiceFromEnv` cria um cliente Valkey compartilhado pela revogação e pelo bloqueio (uma conexão só), fecha o cliente no `onClose` e na falha de subida.
- [ ] **T4. `tecton-admin auth unlock <identificador>` (AC: 7)** — `packages/cli`
  - [ ] Mesmo padrão do `auth bootstrap`: `TECTON_VALKEY_URL` do ambiente (mensagem clara se faltar), identificador normalizado por `normalizeLogin` do `@tecton/auth` (inválido: falha com a mensagem do erro), `reset` pelo adaptador, fecha a conexão em todo caso, erros do Valkey sem a URL.
  - [ ] Saída: `Unlocked "<identificador normalizado>"` (código 0); falha: código 1. Desbloquear um identificador sem bloqueio é sucesso (idempotente).
  - [ ] Ajuda em inglês com exemplo, como o `auth bootstrap`.
- [ ] **T5. README e workspace (AC: 6, 7)**
  - [ ] README do `@tecton/auth`: bloqueio (padrões, variáveis, 429, inexistente igual, 503 com o Valkey fora), risco aceito do bloqueio provocado e o `auth unlock`; tabela de variáveis.
  - [ ] Nada novo no `.env.example` (os padrões bastam; o `TECTON_VALKEY_URL` já está na raiz).
- [ ] **T6. Testes (AC: todos)** — Test Design P0-016 (8) e a parte de lockout de P0-002 (R-09)
  - [ ] `tests/support`: `createMemoryLoginLockout` com o mesmo contrato e o modo indisponível, usando a `Clock` para a janela e a duração.
  - [ ] Unitários do adaptador (cliente falso) e do ambiente.
  - [ ] Containers (Valkey real e Toxiproxy): N falhas bloqueiam com `PTTL` da duração; a janela expira (TTL do contador); sucesso zera; `reset` remove as duas chaves; chave é o hash (o login não aparece nas chaves); Valkey fora e lento → `LoginLockoutUnavailableError` no tempo limite.
  - [ ] Núcleo (`login.test.ts`, bloqueio em memória): contagem por motivo (senha errada, desativada, inexistente, corrompida); malformado não conta; bloqueado não chama `findByLogin` nem `verifyPassword`; sucesso chama `reset`; `onLocked` uma vez, na tentativa que bloqueia.
  - [ ] HTTP (`app.inject`): 5 falhas e a 6ª tentativa com a senha certa dá 429 com `Retry-After`; inexistente e existente têm a mesma sequência de respostas (byte a byte, menos `date`); origens diferentes (`x-forwarded-for` distintos) bloqueiam igual; o bloqueio expira pela `clock`; log do evento sem senha; Valkey fora → 503 com `Retry-After` sem Argon2id (P0-016).
  - [ ] CLI: `auth unlock` normaliza, remove o bloqueio e o contador, é idempotente, falha sem `TECTON_VALKEY_URL` e com identificador inválido, nunca mostra a URL.
  - [ ] Fase vermelha por mutação (A3), no mínimo: bloqueado verificando a senha; inexistente sem contar; sucesso sem zerar; contagem que não bloqueia no N; Valkey fora tratado como "não bloqueado"; `Retry-After` ausente; `unlock` sem apagar o contador; evento sem o identificador.
- [ ] **T7. Verificação final**
  - [ ] `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:containers` e `test:persistence` (no CI se o ubt-host02 não responder) e `test:generation`.
  - [ ] Code review por story antes da 2.7 (retro A1).

## Dev Notes

### Decisões desta story

- **Sem pergunta ao Boss:** os padrões estão nos critérios (5 falhas, 15 min, 15 min) e o fail-closed segue a 2.5; nenhuma dependência nova.
- **Chave pelo hash do identificador:** o login (que pode ser um e-mail) não fica em texto no Valkey, e a chave tem tamanho fixo. SHA-256 simples basta: o objetivo não é esconder de quem lê o Valkey (ele também verá o padrão de acesso), e sim não espalhar o dado pessoal.
- **A tentativa que bloqueia ainda é 401:** a resposta não muda no meio da tentativa que atingiu o limite; o 429 vem a partir da seguinte. Mesmo comportamento para login existente e inexistente.
- **Login malformado não conta:** sem identificador normalizado não há conta possível; a regra de formato é pública, e contar exigiria uma chave para entradas arbitrárias.
- **Rajada concorrente:** tentativas que já passaram do `check` antes do bloqueio terminam (no máximo a concorrência do momento). O limite de taxa do Gateway (3.7) e o `UV_THREADPOOL_SIZE` cobrem esse volume (W1 da 2.1 e da 2.2b).
- **503 com o Valkey fora:** mesma resposta da 2.4 e da 2.5 (verificação indisponível; o cliente tenta de novo).
- **Uma conexão Valkey no Auth:** revogação e bloqueio usam o mesmo cliente; o tempo limite é o mesmo (`TECTON_REVOCATION_TIMEOUT_MS`).

### Código existente que esta story toca

| Arquivo | Hoje | Muda | Preservar |
|---|---|---|---|
| `packages/providers/src/revocation/valkey-token-revocation-store.ts` | cria o próprio cliente `ioredis` | usa o cliente compartilhado (ou o cria pela URL, como hoje) | todo o comportamento e os testes da 2.5 (TTL com 60 s, `MGET`, Lua do sujeito, `close` com `disconnect`) |
| `packages/auth/src/core/login.ts` | um Argon2id sempre, `InvalidCredentialsError` único, rehash condicional, sessão aberta | `check`, `recordFailure`, `reset` | tudo da 2.2b e da 2.3 |
| `packages/auth/src/service.ts` | login, refresh, logout com revogação, JWKS, cookie, `no-store` | `lockout`, 429, cliente Valkey compartilhado | revogação no logout e no reuso, ordem do logout, fechamento na falha de subida |
| `packages/core/src/errors/tecton-error.ts` e `routes.ts` | 400, 401, 403, 500, 501, 503 | 429 | erros existentes e esquema das rotas |
| `packages/cli/src/cli.ts` e `commands/` | `new`, `generate domain`, `lint`, `auth bootstrap` | `auth unlock` | os comandos existentes e a ajuda |

### Fora desta story (não fazer)

- Rate limit por origem (Gateway, 3.7); bloqueio de refresh ou de token de serviço; CAPTCHA; desbloqueio pela SPA (Epic 4).
- `ConfigProvider` (3.1).

### Padrões a seguir (Stories 2.1 a 2.5)

- Código, mensagens, logs, ajuda do CLI e README em inglês; nunca `\uXXXX` em arquivo novo. Scripts Python com strings que levam barra invertida (regex, `\n`) gravam caracteres de controle: usar a ferramenta de edição ou montar a barra por código.
- Erro único por classe de motivo; segredos nunca em mensagem nem log; datas da `Clock` (no Valkey, os TTLs são do próprio Valkey; nos testes em memória, da `Clock`).
- Docker remoto: túnel SSH do `.env.example`; sem ele, `test:containers` roda no CI.

### Perguntas ao Boss (antes do desenvolvimento)

Nenhuma.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.6] (risco aceito do bloqueio provocado), Story 2.5 (fail-closed do Valkey), Story 3.7 (rate limit por origem)
- [Source: _bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md#FR-12], NFR-1
- [Source: _bmad-output/test-artifacts/test-design-qa.md#P0-016, P0-002], R-09, R-17
- [Source: _bmad-output/implementation-artifacts/2-5-tokenrevocationstore-com-valkey-e-fail-closed.md] (cliente Valkey, `close`, store em memória com a `Clock`)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] (W1 da 2.1 e da 2.2b: concorrência no login)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

## Change Log

- 2026-10-21: Story criada (Create Story).
