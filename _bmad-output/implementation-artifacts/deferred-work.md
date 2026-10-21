# Deferred work

Itens reais, não acionáveis agora, registrados pelos code reviews.

## Deferred from: code review do Epic 1 (2026-10-13)

- W1 Fixture global `capturedOutput` (captura de logs/spans com varredura de segredos ao fim de cada teste, P0-003) não entregue no Test Framework [tests/support] — sem logs/spans estruturados ainda; entra com a Story 3.3 (OpenTelemetry) (story 1-1)
- W2 Fixture `jwksTls` adiada do Test Framework [tests/support] — depende do JWKS; entra na Story 2.4 (story 1-1) — **resolvido na 2.4** (`tests/support/jwks-tls.ts`, certificados por `openssl`)
- W3 `withDependencyDown` sem a API por nome (`valkey`/`jwks`/`directory`/`legacy`) do Test Design [tests/support/network-faults.ts] — completa conforme cada dependência existir (Epics 2–6) (story 1-1)
- W4 `lintWorkspace` sem ponto de extensão para checagens extras; busca de pacote feita a mão em vez de `createRequire` [packages/manifest/src/lint/lint-workspace.ts] — o Epic 6 (lint:gateway, aviso de quórum) define o hook; a busca manual funciona com pacotes cujo `exports` não expõe o package.json (story 1-6)
- W5 Jobs Playwright dormentes: `e2e` falha sem testes e `api` passa vazio sem `BASE_URL` [.github/workflows/nightly.yml:77] — corrigir ao ativar (Story 3.13 / Epic 4) (story 1-1)
- W6 `docs/aether-tecton-compatibility.md` (commit ca1f3e5 do autor) reordena um log declarado append-only [docs/aether-tecton-compatibility.md] — fora do escopo do Epic 1 (story 1-1)
- W7 `createTectonServer` usa `logger: false` por padrão, então a exceção de um 500 se perde fora do `main.ts` gerado [packages/core/src/server.ts] — configuração de log vem com o ConfigProvider/OTel (Stories 3.1/3.3) (story 1-7)

## Deferred from: code review da Story 2.1 (2026-10-15)

- W1 Concorrência sem limite no threadpool do libuv (rajada de logins) — limite de taxa e bloqueio de login nas Stories 2.6 e 3.7; dimensionar `UV_THREADPOOL_SIZE` na 2.2 — parcial (2.2b): o README do `@tecton/auth` orienta o `UV_THREADPOOL_SIZE`; o limite segue para 2.6 e 3.7 (W1 da 2.2b)
- W2 Verificação de mentira para login inexistente (timing) — Story 2.2 (EQ-7) — **resolvido na 2.2b** (`dummyHash` e Argon2id fictício em toda recusa)
- W3 Pepper em `process.env` durante todo o processo — `ConfigProvider` (Story 3.1)
- W4 Verificador de hashes legados (migração) — `LegacyAuthBridge` (Story 6.5)

## Deferred from: code review da Story 2.2a (2026-10-16)

- W1 TLS: uma mesma URL não configura TLS igual para o motor de migrations e para o driver `mariadb` [prisma-credential-store.ts, migrations.ts] — adiado: configuração de conexão vem com o `ConfigProvider` (Story 3.1)
- W2 Timezone da sessão no MySQL/MariaDB (`DATETIME` sem fuso) [prisma/mysql/schema.prisma] — adiado: forçar UTC no driver e testar com sessão fora de UTC quando o serviço subir (2.2b) — **resolvido na 2.2b** (teste `+03:00` lendo o DATETIME cru, verde no CI)
- W3 Teste do pacote empacotado (`pnpm pack`, instalação e import) e `allowBuilds` no workspace gerado [packages/auth] — adiado: Story 2.2b, que instala o `@tecton/auth` no `apps/auth` — **parcial na 2.2b:** lista do pacote por `pnpm pack --dry-run --json` e `allowBuilds` no template; instalação do pacote publicado segue no W2 da 2.2b
- W4 `ß` e `SS` continuam logins diferentes (`toLowerCase` não faz case folding completo) [credential.ts] — adiado: decidir com o modelo de identidade da 4.3; trocar a normalização depois exige migrar logins

## Deferred from: code review da Story 2.2b (2026-10-19)

- W1 Login sem limite de taxa nem de concorrência no endpoint que roda Argon2id [packages/auth/src/service.ts] — adiado: bloqueio por identificador na Story 2.6 e rate limiting do Gateway na 3.7; o README passa a orientar o `UV_THREADPOOL_SIZE`
- W2 Pacote publicado instalado e importado de verdade, e `allowBuilds` provado por comportamento [packages/auth, templates] — adiado: exige os `@tecton/*` publicados num registro; entra com o pipeline de publicação. Hoje a lista de arquivos do pacote é verificada

## Deferred from: Dev Story da 2.3 (2026-10-20)

- W1 Famílias e tokens de refresh vencidos ou revogados ficam no banco para sempre [packages/auth/prisma] — adiado: limpeza periódica (job ou comando do `tecton-admin`) junto com a operação do Auth; a revogação por sujeito da 2.5 já usa o índice em `credential_id`

## Deferred from: code review da Story 2.3 (2026-10-20)

- W1 Replay repetido de um refresh token roubado grava um `warn` por tentativa, sem limite [packages/auth/src/core/session.ts] — adiado: limite de taxa do Gateway (3.7) e bloqueio por identificador (2.6)
- W2 Linha de família de refresh corrompida é recusada como desconhecida, sem log [packages/auth/src/adapters/prisma/prisma-refresh-token-store.ts] — adiado: observabilidade (3.3), junto com métricas de recusa

## Deferred from: code review da Story 2.4 (2026-10-20)

- W1 401 e 403 sem os atributos do RFC 6750 no `WWW-Authenticate` (`error="invalid_token"`, `error="insufficient_scope"`) [packages/core/src/errors/tecton-error.ts] — adiado: formato de erro do Epic 5 (FR-24, RFC 9457)

## Deferred from: code review da Story 2.5 (2026-10-21)

- W1 O teste de geração prova o fail-closed (sem Valkey, o domínio responde 503 a um token válido), mas não o caminho feliz até o handler; com Valkey real, só o teste montado à mão (`packages/auth/src/revocation.containers.test.ts`) [packages/cli/src/commands/new.generation.test.ts] — adiado: `tecton-admin dev` (Story 3.13) sobe o Dev Services e permite o ponta a ponta do workspace gerado
