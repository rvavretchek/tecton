---
baseline_commit: 7e28eb841bcb69929efd9493f92fc5eaca68ebbf
---

# Story 2.6: Bloqueio de login por identificador

Status: done

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

- [x] **T1. Cliente Valkey compartilhado (AC: 1, 8)** — `packages/providers`
  - [x] Extrair a criação do cliente do adaptador da 2.5 para `src/valkey/valkey-client.ts`: `createValkeyClient({ url, timeoutMs, onError })` com as mesmas opções fail-closed (`commandTimeout`, sem fila offline, sem retry por comando, conexão em segundo plano, `disconnect()` quando o `quit` falha, validação de `redis://`/`rediss://` e de host). `valkeyClientFromEnv(env, options)` lê `TECTON_VALKEY_URL` e `TECTON_REVOCATION_TIMEOUT_MS` (o mesmo tempo limite para todo uso do Valkey; o nome da variável continua por compatibilidade).
  - [x] O store de revogação aceita o cliente compartilhado (`{ client }`) além da URL, sem mudar o comportamento da 2.5 (os testes da 2.5 continuam passando). Um store que recebe o cliente não o fecha.
- [x] **T2. Porta e adaptador do bloqueio (AC: 1 a 5, 8)** — `packages/providers/src/lockout/`
  - [x] Porta `LoginLockout`:
    - `check(identifier)` → `{ locked: false }` ou `{ locked: true, retryAfterSeconds }`;
    - `recordFailure(identifier)` → `{ lockedNow: boolean, retryAfterSeconds? }` (atômico);
    - `reset(identifier)` (sucesso e `unlock`);
    - `close()`.
  - [x] `LoginLockoutUnavailableError` (Valkey inacessível, lento ou resposta inesperada), sem URL.
  - [x] Adaptador Valkey `createValkeyLoginLockout({ client | url, maxFailures = 5, windowSeconds = 900, lockSeconds = 900, keyPrefix = 'tecton:lockout:' })`:
    - chaves pelo SHA-256 em hexadecimal do identificador normalizado (o login não fica em texto no Valkey e o tamanho da chave é fixo): `<prefixo>fail:<hash>` e `<prefixo>lock:<hash>`;
    - `recordFailure` num script Lua: `INCR` do contador, `PEXPIRE` da janela na primeira falha; ao atingir `maxFailures`, grava a chave de bloqueio com `PX` = duração e apaga o contador; devolve se bloqueou agora e o TTL;
    - `check`: `PTTL` da chave de bloqueio (> 0 é bloqueado; `Retry-After` = `ceil(pttl/1000)`);
    - `reset`: `DEL` das duas chaves;
    - todo erro do cliente vira `LoginLockoutUnavailableError`;
    - limites validados na criação: `maxFailures` 1 a 100, janela e duração de 60 a 86400 s.
  - [x] `loginLockoutFromEnv(env, { client })`: `TECTON_AUTH_LOCKOUT_MAX_FAILURES`, `TECTON_AUTH_LOCKOUT_WINDOW_SECONDS`, `TECTON_AUTH_LOCKOUT_DURATION_SECONDS` (inteiros decimais, mensagens com o nome da variável).
  - [x] Exportar no `index.ts` do `@tecton/providers`.
- [x] **T3. Login (AC: 1 a 6, 8)** — `packages/auth/src/core/login.ts` e `service.ts`
  - [x] `LoginDependencies.lockout: LoginLockout` (obrigatório).
  - [x] Ordem: normalizar → `check` (bloqueado: `LoginLockedError(retryAfterSeconds)`, sem consulta ao banco nem Argon2id) → buscar a credencial e verificar a senha como hoje (um Argon2id sempre) → recusa: `recordFailure` (se bloqueou agora, `onLocked({ identifier, lockSeconds })`) e o `InvalidCredentialsError` de sempre → sucesso: `reset` e a emissão de hoje.
  - [x] Login malformado (não normaliza): não conta e não consulta o Valkey (não há identificador; a regra de formato é pública). Continua com o Argon2id fictício e o 401 de sempre.
  - [x] `LoginLockoutUnavailableError` em qualquer passo: 503 (`frameworkErrors.authUnavailable()`), sem verificar a senha quando falha no `check`.
  - [x] `@tecton/core`: `frameworkErrors.tooManyRequests(retryAfterSeconds)` (429, `too-many-requests`, `tecton.error.tooManyRequests`, `Retry-After`, mensagem genérica) e 429 no esquema das rotas (o Gateway da 3.7 também responde 429).
  - [x] Serviço: `onLocked` registra `warn` com `event: 'auth.login.locked'`, o identificador normalizado e a duração; `startAuthServiceFromEnv` cria um cliente Valkey compartilhado pela revogação e pelo bloqueio (uma conexão só), fecha o cliente no `onClose` e na falha de subida.
- [x] **T4. `tecton-admin auth unlock <identificador>` (AC: 7)** — `packages/cli`
  - [x] Mesmo padrão do `auth bootstrap`: `TECTON_VALKEY_URL` do ambiente (mensagem clara se faltar), identificador normalizado por `normalizeLogin` do `@tecton/auth` (inválido: falha com a mensagem do erro), `reset` pelo adaptador, fecha a conexão em todo caso, erros do Valkey sem a URL.
  - [x] Saída: `Unlocked "<identificador normalizado>"` (código 0); falha: código 1. Desbloquear um identificador sem bloqueio é sucesso (idempotente).
  - [x] Ajuda em inglês com exemplo, como o `auth bootstrap`.
- [x] **T5. README e workspace (AC: 6, 7)**
  - [x] README do `@tecton/auth`: bloqueio (padrões, variáveis, 429, inexistente igual, 503 com o Valkey fora), risco aceito do bloqueio provocado e o `auth unlock`; tabela de variáveis.
  - [x] Nada novo no `.env.example` (os padrões bastam; o `TECTON_VALKEY_URL` já está na raiz).
- [x] **T6. Testes (AC: todos)** — Test Design P0-016 (8) e a parte de lockout de P0-002 (R-09)
  - [x] `tests/support`: `createMemoryLoginLockout` com o mesmo contrato e o modo indisponível, usando a `Clock` para a janela e a duração.
  - [x] Unitários do adaptador (cliente falso) e do ambiente.
  - [x] Containers (Valkey real e Toxiproxy): N falhas bloqueiam com `PTTL` da duração; a janela expira (TTL do contador); sucesso zera; `reset` remove as duas chaves; chave é o hash (o login não aparece nas chaves); Valkey fora e lento → `LoginLockoutUnavailableError` no tempo limite.
  - [x] Núcleo (`login.test.ts`, bloqueio em memória): contagem por motivo (senha errada, desativada, inexistente, corrompida); malformado não conta; bloqueado não chama `findByLogin` nem `verifyPassword`; sucesso chama `reset`; `onLocked` uma vez, na tentativa que bloqueia.
  - [x] HTTP (`app.inject`): 5 falhas e a 6ª tentativa com a senha certa dá 429 com `Retry-After`; inexistente e existente têm a mesma sequência de respostas (byte a byte, menos `date`); origens diferentes (`x-forwarded-for` distintos) bloqueiam igual; o bloqueio expira pela `clock`; log do evento sem senha; Valkey fora → 503 com `Retry-After` sem Argon2id (P0-016).
  - [x] CLI: `auth unlock` normaliza, remove o bloqueio e o contador, é idempotente, falha sem `TECTON_VALKEY_URL` e com identificador inválido, nunca mostra a URL.
  - [x] Fase vermelha por mutação (A3), no mínimo: bloqueado verificando a senha; inexistente sem contar; sucesso sem zerar; contagem que não bloqueia no N; Valkey fora tratado como "não bloqueado"; `Retry-After` ausente; `unlock` sem apagar o contador; evento sem o identificador.
- [x] **T7. Verificação final**
  - [x] `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:containers` e `test:persistence` (no CI se o ubt-host02 não responder) e `test:generation`.
  - [x] Code review por story antes da 2.7 (retro A1).

### Review Findings (code review da Story 2.6, 2026-10-21)

> Camadas: Blind Hunter, Edge Case Hunter e Acceptance Auditor.

- [x] [Review][Patch] P1 (alta) `tecton-admin auth unlock` falha sempre contra um Valkey real: o cliente conecta em segundo plano, sem fila offline, e o `DEL` sai antes de a conexão ficar pronta ("Stream isn't writeable"; os três revisores, conferido no `ioredis`). Correção: esperar o `ready` (com tempo limite) antes do comando, e teste do `unlock` com Valkey real [auth-unlock.ts, valkey-client.ts]
- [x] [Review][Patch] P2 (média) Partida a frio: logins (e checagens de revogação) que chegam antes de a conexão ficar pronta recebem 503. Correção: o Auth e o servidor de domínio esperam o `ready` (limitado, sem travar a subida se o Valkey estiver fora) antes do `listen` [service.ts, domain-server.ts, token-verifier.ts]
- [x] [Review][Patch] P3 (média) Falha do Valkey no `reset` depois de uma senha correta dá 503 ao usuário certo. Correção: no sucesso, a falha ao zerar só vai para o log [login.ts, service.ts]
- [x] [Review][Patch] P4 (média) O sucesso apaga também a chave de bloqueio: um login correto em andamento desfaz um bloqueio recém-aplicado por tentativas simultâneas. Correção: o sucesso zera só o contador; só o `unlock` remove o bloqueio [porta, adaptador, login.ts]
- [x] [Review][Patch] P5 (média) Falhas em andamento depois do bloqueio recomeçam o contador e podem estender o bloqueio (o `SET` sem `NX`). Correção: com bloqueio ativo, o script não conta nem regrava [valkey-login-lockout.ts, tests/support/lockout.ts]
- [x] [Review][Patch] P6 (baixa) Chave de bloqueio sem expiração (`PTTL -1`) bloqueia para sempre. Correção: o `check` aplica a duração a uma chave sem expiração [valkey-login-lockout.ts]
- [x] [Review][Patch] P7 (baixa) O sucesso zera pelo `credential.login`, e a contagem é pelo identificador normalizado. Correção: usar o mesmo identificador [login.ts]
- [x] [Review][Patch] P8 (baixa) O login (público) pode responder 503, que não está no esquema. Correção: 503 em toda rota [routes.ts]
- [x] [Review][Patch] P9 (baixa) `TECTON_REVOCATION_TIMEOUT_MS` limita todo comando do Valkey, mas o nome fala só de revogação. Correção: `TECTON_VALKEY_TIMEOUT_MS`, com o nome antigo aceito como alternativa [valkey-client.ts, READMEs]
- [x] [Review][Patch] P10 (baixa) A mensagem de `TECTON_VALKEY_URL` ausente fala só de revogações (e aparece no `auth unlock`) [valkey-client.ts]
- [x] [Review][Patch] P11 (baixa) O erro de configuração da revogação é refeito por troca de texto da mensagem, e a validação do tempo limite está repetida [valkey-token-revocation-store.ts, valkey-client.ts]
- [x] [Review][Patch] P12 (baixa) `tokenRevocationStoreFromEnv` abre a conexão antes de validar as opções do store e a vaza se elas forem inválidas (regressão do refactor) [valkey-token-revocation-store.ts]
- [x] [Review][Patch] P13 (baixa) As duas chaves do script podem cair em slots diferentes num Valkey Cluster (`CROSSSLOT`). Correção: hash tag `{<hash>}` [valkey-login-lockout.ts]
- [x] [Review][Patch] P14 (baixa) A janela é fixa a partir da primeira falha (até 2 × (N − 1) tentativas num intervalo curto, na virada da janela); o README promete "5 em 15 minutos". Correção: documentar [README]
- [x] [Review][Patch] P15 (baixa) O cliente Valkey é fechado duas vezes numa falha de `listen` [service.ts]
- [x] [Review][Patch] P16 (baixa) O `unlock` sempre diz que removeu, mesmo sem nada para remover. Correção: o `reset` informa se havia bloqueio ou contador, e a saída diz [porta, adaptador, auth-unlock.ts]
- [x] [Review][Patch] P17 (baixa) Identificador começando com `-` é lido como opção pelo CLI. Correção: a ajuda explica o `--` [cli.ts]
- [x] [Review][Patch] P18 (baixa) Testes faltando: falha do `recordFailure` dá 503; falha do `reset` no sucesso não bloqueia o login; credencial corrompida conta; o `unlock` remove um contador pendente (sem bloqueio) [testes]
- [x] [Review][Patch] P19 (baixa) O bloqueio em memória dos testes não segue o adaptador (não valida a política, conta e regrava com bloqueio ativo) [tests/support/lockout.ts]
- [x] [Review][Patch] P20 (baixa) Registros: desvios da porta e da API em relação à T2 (`recordFailure` devolve `lockSeconds`; `lockoutPolicyFromEnv` no lugar de `loginLockoutFromEnv`; `shared` explícito em vez de "store que recebe o cliente não o fecha"); a mutação "`unlock` sem apagar o contador" não tinha teste que a pegasse pelo contador [story]
- [x] [Review][Defer] W1 Logins com muitos identificadores inexistentes criam uma chave cada no mesmo Valkey das revogações; com `allkeys-lru`, revogações podem ser despejadas [valkey-login-lockout.ts] — adiado: limite de taxa do Gateway (3.7); o README passa a pedir `maxmemory-policy noeviction` (sem despejo, a falta de memória vira 503, fail-closed)
- Descartados:
  - o evento `auth.login.locked` traz o login em texto (o AC 6 exige o identificador no evento; o hash no Valkey é para não espalhar o dado em armazenamento, o log é a trilha de auditoria);
  - 429 declarado em toda rota (o rate limit do Gateway, 3.7, responde 429 em qualquer rota);
  - `Retry-After` sem descrição no OpenAPI (formato de erro do Epic 5);
  - relógio diferente entre o bloqueio em memória e o serviço em testes que não dependem do tempo do bloqueio;
  - custo igual entre login conhecido e desconhecido sob bloqueio ou falha do Valkey (os dois caminhos fazem a mesma ida ao Valkey; P0-006 é por comportamento);
  - `check` tratando `PTTL 0` como bloqueado (o Valkey nunca devolve 0 para chave viva; coberto pela P6).

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

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- **Cliente Valkey compartilhado:** `src/valkey/valkey-client.ts` (`createValkeyClient`, `closeValkeyClient`, `valkeyClientFromEnv`, `ValkeyConfigError`). O store de revogação da 2.5 passou a usá-lo; `RevocationStoreConfigError` virou subclasse de `ValkeyConfigError`, com as mesmas mensagens. Opção nova `shared` no store e no bloqueio: com ela, fechar o adaptador não fecha o cliente. Os 29 testes do store da 2.5 continuaram passando sem mudança.
- **Uma conexão no Auth:** `startAuthServiceFromEnv` abre um cliente Valkey (dentro do `try`) e o passa à revogação e ao bloqueio como compartilhado; ele fecha no `onClose` e numa falha de subida.
- **Reset pelo login da credencial:** o sucesso zera pelo `credential.login`, que é o identificador normalizado (a credencial foi achada por ele).
- **Indentação das linhas inseridas nos testes:** os scripts que acrescentaram `lockout:` (e o `revocations:` da 2.5) nas chamadas de `createAuthService` deixaram a indentação errada; corrigida pela linha seguinte.
- **Docker remoto inacessível:** o teste do bloqueio com Valkey real e Toxiproxy (`valkey-login-lockout.containers.test.ts`) roda no job `containers` do CI.
- **Fase vermelha por mutação (A3),** cada uma restaurada:

  | Mutação | Testes que falharam |
  |---|---|
  | bloqueado verificando a senha | 6 |
  | inexistente sem contar | 2 |
  | sucesso sem zerar | 2 |
  | contagem que não bloqueia no N | 1 |
  | Valkey fora tratado como "não bloqueado" | 1 |
  | `Retry-After` ausente | 1 |
  | `unlock` sem apagar o contador | 2 |
  | evento sem o identificador | 1 |
  | chave com o login em texto | 1 |
  | `unlock` sem normalizar | 2 |

  O script Lua do contador só se exercita com Valkey real: coberto pelo teste de containers (janela, bloqueio no limite, contador apagado ao bloquear).

- **Code review (2026-10-21 a 2026-10-23):**
  - **`auth unlock` contra Valkey real (P1):** com `lazyConnect`, sem fila offline e a conexão aberta em segundo plano, o `DEL` saía antes de a conexão ficar pronta e era recusado ("Stream isn't writeable"); os três revisores acharam, e nenhum teste pegava porque o sucesso usava o bloqueio em memória. Agora `waitForValkeyReady` (novo no `@tecton/providers`) é aguardado antes do comando, e há teste do comando de verdade contra Valkey real (`auth-unlock.containers.test.ts`).
  - **Partida a frio (P2):** o Auth e o servidor de domínio esperam o Valkey por até 2 s antes do `listen`; com o Valkey fora, sobem assim mesmo e respondem 503 até ele voltar. O verificador montado pelo ambiente ganhou `ready()`.
  - **Desvios de API registrados (P20):**
    - `recordFailure` devolve `{ lockedNow: true, lockSeconds }` (a T2 falava em `retryAfterSeconds`); o script devolve o TTL, mas a duração configurada é a mesma;
    - `lockoutPolicyFromEnv(env)` devolve só a política, e o chamador monta o adaptador (a T2 falava em `loginLockoutFromEnv(env, { client })`);
    - a porta ganhou `clearFailures` (sucesso: só o contador, P4) e o `reset` passou a devolver se havia algo (P16);
    - um adaptador que recebe o cliente só o deixa aberto com `shared: true` (a T1 dizia "um store que recebe o cliente não o fecha"); é o que preserva os testes da 2.5, em que o store fecha o cliente injetado;
    - `TECTON_VALKEY_TIMEOUT_MS` é o nome da variável do tempo limite; `TECTON_REVOCATION_TIMEOUT_MS` continua aceito (P9).
  - **Mutação "`unlock` sem apagar o contador" (P20):** na Dev Story, ela só falhava pelo bloqueio (o bloqueio já apaga o contador). Agora há teste do `unlock` sobre um contador pendente, sem bloqueio.
  - **Fase vermelha das correções (A3),** cada uma restaurada:

    | Mutação | Testes que falharam |
    |---|---|
    | `unlock` sem esperar a conexão (P1) | 1 |
    | falha ao zerar bloqueando o login (P3) | 1 |
    | sucesso apagando o bloqueio (P4) | 1 |
    | contando durante o bloqueio, no dublê em memória (P5) | 1 (depois do teste novo em `tests/support`) |
    | chave sem expiração bloqueando para sempre (P6) | 1 |
    | zerando pelo login gravado (P7) | 1 |
    | sem o nome novo da variável (P9) | 2 |
    | mensagem só de revogação (P10) | 1 |
    | sem a hash tag das chaves (P13) | 2 |
    | `reset` sem dizer se removeu (P16) | 1 |

    A P5 no script Lua (`EXISTS` do bloqueio e `SET ... NX`) só se exercita com Valkey real; o teste do adaptador com cliente falso e o de containers a cobrem.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Porta e adaptador (`@tecton/providers`):** `LoginLockout` (`check`, `recordFailure`, `reset`, `close`), `LoginLockoutUnavailableError`, política com limites (`lockoutPolicy`), adaptador Valkey com chaves pelo SHA-256 do identificador e contador atômico em Lua, `lockoutPolicyFromEnv` com `TECTON_AUTH_LOCKOUT_MAX_FAILURES`, `TECTON_AUTH_LOCKOUT_WINDOW_SECONDS` e `TECTON_AUTH_LOCKOUT_DURATION_SECONDS`.
- **Login:** identificador bloqueado é recusado antes de consultar o banco e de rodar Argon2id (`LoginLockedError`, 429 com `Retry-After`); toda recusa de identificador válido conta (inexistente igual a existente); a tentativa que bloqueia ainda é 401; sucesso zera; login malformado não conta; Valkey fora é 503.
- **Evento de segurança:** `auth.login.locked` com o identificador e a duração.
- **`@tecton/core`:** `frameworkErrors.tooManyRequests()` e 429 no esquema das rotas.
- **CLI:** `tecton-admin auth unlock <identificador>`, com normalização, idempotente, sem mostrar a URL.
- **README do `@tecton/auth`:** bloqueio, variáveis, risco aceito e o `auth unlock`.
- **Testes:** adaptador (15 unitários e 3 com Valkey real), núcleo do login (8), HTTP (6), CLI (6), OpenAPI (429).
- **Verificação local:** build, typecheck, `check:deps` (154 módulos), `lint:examples`, `validate:asyncapi`, `test` (856) e `test:generation` (3). `test:containers` e `test:persistence`: pelo CI.
- **Code review (A1):** 20 patches (P1 a P20), 1 adiado (W1 no `deferred-work.md`) e 6 descartados, com as três camadas de revisão.
- **Verificação depois do review:** build, typecheck, `check:deps`, `lint:examples`, `validate:asyncapi`, `test` (875) e `test:generation` (3).

### File List

- `packages/providers/src/valkey/valkey-client.ts` (novo); `src/revocation/valkey-token-revocation-store.ts`, `src/index.ts` (modificados)
- `packages/providers/src/lockout/{login-lockout,valkey-login-lockout}.ts`, `valkey-login-lockout.test.ts`, `valkey-login-lockout.containers.test.ts` (novos)
- `packages/core/src/errors/tecton-error.ts`, `src/routes.ts`, `src/openapi.test.ts` (modificados)
- `packages/auth/src/core/login.ts`, `login.test.ts`, `src/service.ts`, `README.md` (modificados); `src/lockout-http.test.ts` (novo)
- `packages/auth/src/{service,refresh-http,review-2-2b,revocation-http,revocation.containers}.test.ts`, `adapters/prisma/{prisma-credential-store,prisma-refresh-token-store}.persistence.test.ts` (modificados: bloqueio em memória)
- `packages/cli/src/commands/auth-unlock.ts`, `auth-unlock.test.ts`, `auth-unlock.containers.test.ts` (novos); `src/cli.ts` (modificado)
- `packages/providers/src/valkey/valkey-client.test.ts` (novo, review); `packages/core/src/{auth/token-verifier,domain-server}.ts`, `src/routes.ts`, `README.md` (modificados no review)
- `tests/support/lockout.ts`, `lockout.test.ts` (novos), `tests/support/index.ts` (modificado)
- Esta story, `sprint-status.yaml`, `deferred-work.md`

## Change Log

- 2026-10-21: Story criada (Create Story).
- 2026-10-21: Story implementada (Dev Story); teste com Valkey real a confirmar no CI; status → review.
- 2026-10-23: Code review: P1 a P20 aplicados, W1 adiado; status → done.
