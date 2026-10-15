---
baseline_commit: 7e5398e9ffb239e85191281a226330031b698545
---

# Story 1.11: Dev Services

Status: done
## Story

Como **dev começando num workspace Tecton**,
quero a infraestrutura de desenvolvimento pronta num único arquivo,
para subir banco e Valkey sem configurar nada à mão (FR-30).

## Acceptance Criteria

1. **Compose por banco.** Dado `tecton-admin new <projeto> --db postgres|mariadb|mysql` (padrão: `postgres`), quando ele roda, então gera `docker-compose.dev.yml` com Valkey 9.1 e o banco escolhido (FR-30). E cada domínio tem seu banco lógico próprio, criado na primeira subida; o Auth (Story 2.2) e o Directory (Story 4.1) acrescentam os seus quando entram. E o arquivo de exemplo de ambiente já aponta para esses bancos e para o Valkey.
2. **Domínio novo.** Dado `tecton-admin generate domain <nome>`, quando ele roda depois desta story, então o banco lógico do domínio novo é acrescentado ao Dev Services.
3. **Sem passo extra.** Dado o `docker-compose.dev.yml` em execução, quando eu subo qualquer serviço do workspace, então banco e Valkey já estão disponíveis, sem nenhum passo adicional de infraestrutura (FR-30).
4. **Aviso.** Dado o arquivo gerado, quando eu o leio, então um comentário em inglês avisa que ele é só para desenvolvimento, não para produção.

## Tasks / Subtasks

- [x] **T1. Geração do Dev Services** (AC: 1, 2, 4)
  - [x] `packages/cli/src/dev-services.ts`: `writeDevServices(root)` lê o banco escolhido em `package.json` (`"tecton": { "devServices": { "database": "postgres" } }`) e a lista de domínios de `apps/domains/*/tecton.yaml`, e (re)gera três arquivos: `docker-compose.dev.yml`, `dev-services/databases.sql` e `.env.example`.
  - [x] `docker-compose.dev.yml` (comentário de topo em inglês: só desenvolvimento, credenciais fixas, sem TLS, gerado e regenerado pelo `tecton-admin`): `valkey` (`valkey/valkey:9.1-alpine`, porta 6379, healthcheck `valkey-cli ping`), `database` (`postgres:18-alpine`, `mariadb:11.8` ou `mysql:8.4`; usuário `tecton`/senha `tecton`; volume nomeado; healthcheck nativo) e `database-init` (mesma imagem, `depends_on: database: service_healthy`, roda `dev-services/databases.sql` e termina; `restart: "no"`).
  - [x] `databases.sql` idempotente, um banco lógico por domínio (nome com `-` trocado por `_`): PostgreSQL com `SELECT 'CREATE DATABASE x' WHERE NOT EXISTS (...)\gexec`; MariaDB/MySQL com `CREATE DATABASE IF NOT EXISTS` + `GRANT ALL` para `tecton`. Como roda a cada `up`, banco de domínio gerado depois também é criado (os scripts de init das imagens só rodam com volume vazio).
  - [x] `.env.example` gerado: `TECTON_VALKEY_URL=redis://localhost:6379` e, por domínio, `TECTON_<DOMÍNIO>_DATABASE_URL` (`postgresql://...:5432/<db>` ou `mysql://...:3306/<db>`), com comentário dizendo que é gerado e que valores locais vão no `.env` (ignorado pelo Git).
- [x] **T2. Integração** (AC: 1, 2)
  - [x] `tecton-admin new --db <engine>` (padrão `postgres`; valor inválido recusado listando os três) grava o campo `tecton.devServices.database` no `package.json` gerado e chama `writeDevServices`.
  - [x] `tecton-admin generate domain` chama `writeDevServices` depois de criar os domínios.
- [x] **T3. Testes**
  - [x] Rápidos (`dev-services.test.ts`): conteúdo para cada banco (imagens, portas, healthchecks, credenciais, comentário de topo), SQL idempotente correto por banco, `.env.example` com as URLs, nomes com hífen, workspace sem domínios (compose válido sem bancos de domínio), `--db` inválido, `generate domain` acrescentando o banco.
  - [x] Com Docker (`dev-services.persistence.test.ts`, matriz de bancos): gera workspace com `--db $TECTON_TEST_DB` e um domínio, `docker compose up -d`, espera o banco lógico existir e o Valkey responder; gera outro domínio, `up -d` de novo e espera o segundo banco; `down -v` no final.
- [x] **T4. Verificação final:** `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:deps`, `pnpm lint:examples`, `pnpm validate:asyncapi`, `pnpm test:generation`; o teste com Docker roda no CI (job `persistence`).

### Review Findings (code review do Epic 1, 2026-10-13)

- [x] [Review][Patch] D4 (média, segurança) Dev Services publica Valkey sem senha e o banco com `tecton/tecton` em todas as interfaces (`6379:6379`, `5432:5432`), expondo à rede local. Opções: publicar só em `127.0.0.1` (padrão seguro; quebra acesso de outra máquina, ex. Docker remoto do laboratório) / manter `0.0.0.0` / opção `--expose` no `new` — decidido (2026-10-15): portas do Dev Services publicadas só em 127.0.0.1
- [x] [Review][Patch] P1 (média) PostgreSQL: `CREATE DATABASE user` (ou `group`, `order`, `table`) é erro de sintaxe; com `ON_ERROR_STOP=1`, nenhum banco seguinte é criado. Os stand-ins do próprio repo se chamam `user` e `group`. Citar o identificador [packages/cli/src/dev-services.ts:39]
- [x] [Review][Patch] P25 (baixa) Dev Services: lista de domínios sai do nome da pasta sem validação; nomes de banco de sistema (`postgres`, `template1`, `tecton`, `mysql`, `sys`) não são recusados (MySQL daria GRANT no schema `mysql`); motor inválido no package.json vira postgres em silêncio [packages/cli/src/dev-services.ts]
- [x] [Review][Patch] P31 (baixa) Nome do projeto Compose e escopo dos pacotes vêm do `name` da raiz sem sanitizar (`@acme/Platform` quebra o compose) [packages/cli/src/dev-services.ts, workspace.ts]

## Dev Notes

- Imagens iguais às do Test Framework (`tests/support/containers.ts`): `postgres:18-alpine`, `mariadb:11.8`, `mysql:8.4`, `valkey/valkey:9.1-alpine` (todas verificadas no Docker Hub em 2026-10-09).
- PostgreSQL 18 guarda os dados em `/var/lib/postgresql/18/docker`; o volume nomeado é montado em `/var/lib/postgresql`, como a imagem oficial recomenda a partir da 18.
- O `tecton-admin dev` (Story 3.13) usa este arquivo; o Auth e o Directory acrescentam seus bancos nas Stories 2.2 e 4.1 (a lista sai de `apps/domains` e, depois, de `apps/auth`/`apps/directory`).
- Sem Docker local nesta máquina: o teste com Docker só roda no CI.
- [Source: epics.md#Story 1.11; PRD FR-30; ARCHITECTURE-SPINE.md#Stack, #Structural Seed]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- O teste rápido da 1.9 que lista os arquivos do workspace ganhou os três arquivos do Dev Services; o teste novo precisou do `yaml` como dependência de desenvolvimento do `@tecton/cli`.
- Primeiro CI: os três jobs `persistence` falharam com "needs Docker". Causa: a checagem `docker version` rodava com `cwd` no diretório do workspace, que ainda não existia (o `spawnSync` falha com diretório inexistente). Passou a rodar a partir do diretório pai; segundo CI verde nos três bancos, com o teste executado (2 cenários por banco).
- O cliente do MySQL deprecou `MYSQL_PWD`: o `database-init` do MySQL usa `-p` explícito (só desenvolvimento); o do MariaDB mantém `MYSQL_PWD`, que o cliente `mariadb` aceita.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- `writeDevServices(root)` gera `docker-compose.dev.yml`, `dev-services/databases.sql` e `.env.example` a partir do banco escolhido (`package.json` → `tecton.devServices.database`) e dos domínios de `apps/domains`.
- Compose: `valkey/valkey:9.1-alpine` (healthcheck `valkey-cli ping`), `database` (`postgres:18-alpine`, `mariadb:11.8` ou `mysql:8.4`, usuário `tecton`, volume nomeado, healthcheck nativo; PostgreSQL 18 montado em `/var/lib/postgresql`) e `database-init` (mesma imagem, depois do banco saudável, roda o SQL e termina). Comentário de topo em inglês: só desenvolvimento, nunca produção, gerado.
- SQL idempotente a cada `up` (PostgreSQL com `\gexec`; MariaDB/MySQL com `CREATE DATABASE IF NOT EXISTS` + `GRANT`), um banco por domínio com `-` → `_`. Resolve o limite dos scripts de init das imagens, que só rodam com volume vazio.
- `.env.example`: `TECTON_VALKEY_URL` e `TECTON_<DOMÍNIO>_DATABASE_URL` (`postgresql://` ou `mysql://`, também para MariaDB, que usa o provider `mysql` do Prisma).
- `tecton-admin new --db postgres|mariadb|mysql` (padrão `postgres`; inválido recusado) e `generate domain` regeneram o Dev Services; o `new` mostra o comando `docker compose ... up -d` nos próximos passos.
- Testes: 11 rápidos (`dev-services.test.ts`) e 2 com Docker por banco (`dev-services.persistence.test.ts`, matriz do CI: compose sobe, Valkey responde, banco do domínio existe; domínio gerado depois ganha o banco no `up` seguinte). Suíte rápida 275 verde; build, typecheck, `check:deps`, `lint:examples`, `validate:asyncapi` e `test:generation` verdes; CI verde nos 5 jobs.

### File List

- `packages/cli/src/dev-services.ts`, `dev-services.test.ts`, `dev-services.persistence.test.ts` (novos)
- `packages/cli/src/cli.ts`, `commands/new.ts`, `commands/generate-domain.ts`, `commands/new.test.ts` (modificados)
- `packages/cli/package.json`, `pnpm-lock.yaml` (modificados: `yaml` como dev dependency do CLI)

## Change Log

- 2026-10-12: Story 1.11 implementada: Dev Services com Valkey e o banco escolhido, um banco lógico por domínio criado de forma idempotente, `.env.example` gerado.
- 2026-10-15: Code review do Epic 1 — 4 correção(ões) aplicada(s) (ver Review Findings); status → done.
