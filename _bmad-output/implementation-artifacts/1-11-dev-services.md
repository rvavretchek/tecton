---
baseline_commit: 7e5398e9ffb239e85191281a226330031b698545
---

# Story 1.11: Dev Services

Status: ready-for-dev

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

- [ ] **T1. Geração do Dev Services** (AC: 1, 2, 4)
  - [ ] `packages/cli/src/dev-services.ts`: `writeDevServices(root)` lê o banco escolhido em `package.json` (`"tecton": { "devServices": { "database": "postgres" } }`) e a lista de domínios de `apps/domains/*/tecton.yaml`, e (re)gera três arquivos: `docker-compose.dev.yml`, `dev-services/databases.sql` e `.env.example`.
  - [ ] `docker-compose.dev.yml` (comentário de topo em inglês: só desenvolvimento, credenciais fixas, sem TLS, gerado e regenerado pelo `tecton-admin`): `valkey` (`valkey/valkey:9.1-alpine`, porta 6379, healthcheck `valkey-cli ping`), `database` (`postgres:18-alpine`, `mariadb:11.8` ou `mysql:8.4`; usuário `tecton`/senha `tecton`; volume nomeado; healthcheck nativo) e `database-init` (mesma imagem, `depends_on: database: service_healthy`, roda `dev-services/databases.sql` e termina; `restart: "no"`).
  - [ ] `databases.sql` idempotente, um banco lógico por domínio (nome com `-` trocado por `_`): PostgreSQL com `SELECT 'CREATE DATABASE x' WHERE NOT EXISTS (...)\gexec`; MariaDB/MySQL com `CREATE DATABASE IF NOT EXISTS` + `GRANT ALL` para `tecton`. Como roda a cada `up`, banco de domínio gerado depois também é criado (os scripts de init das imagens só rodam com volume vazio).
  - [ ] `.env.example` gerado: `TECTON_VALKEY_URL=redis://localhost:6379` e, por domínio, `TECTON_<DOMÍNIO>_DATABASE_URL` (`postgresql://...:5432/<db>` ou `mysql://...:3306/<db>`), com comentário dizendo que é gerado e que valores locais vão no `.env` (ignorado pelo Git).
- [ ] **T2. Integração** (AC: 1, 2)
  - [ ] `tecton-admin new --db <engine>` (padrão `postgres`; valor inválido recusado listando os três) grava o campo `tecton.devServices.database` no `package.json` gerado e chama `writeDevServices`.
  - [ ] `tecton-admin generate domain` chama `writeDevServices` depois de criar os domínios.
- [ ] **T3. Testes**
  - [ ] Rápidos (`dev-services.test.ts`): conteúdo para cada banco (imagens, portas, healthchecks, credenciais, comentário de topo), SQL idempotente correto por banco, `.env.example` com as URLs, nomes com hífen, workspace sem domínios (compose válido sem bancos de domínio), `--db` inválido, `generate domain` acrescentando o banco.
  - [ ] Com Docker (`dev-services.persistence.test.ts`, matriz de bancos): gera workspace com `--db $TECTON_TEST_DB` e um domínio, `docker compose up -d`, espera o banco lógico existir e o Valkey responder; gera outro domínio, `up -d` de novo e espera o segundo banco; `down -v` no final.
- [ ] **T4. Verificação final:** `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:deps`, `pnpm lint:examples`, `pnpm validate:asyncapi`, `pnpm test:generation`; o teste com Docker roda no CI (job `persistence`).

## Dev Notes

- Imagens iguais às do Test Framework (`tests/support/containers.ts`): `postgres:18-alpine`, `mariadb:11.8`, `mysql:8.4`, `valkey/valkey:9.1-alpine` (todas verificadas no Docker Hub em 2026-10-09).
- PostgreSQL 18 guarda os dados em `/var/lib/postgresql/18/docker`; o volume nomeado é montado em `/var/lib/postgresql`, como a imagem oficial recomenda a partir da 18.
- O `tecton-admin dev` (Story 3.13) usa este arquivo; o Auth e o Directory acrescentam seus bancos nas Stories 2.2 e 4.1 (a lista sai de `apps/domains` e, depois, de `apps/auth`/`apps/directory`).
- Sem Docker local nesta máquina: o teste com Docker só roda no CI.
- [Source: epics.md#Story 1.11; PRD FR-30; ARCHITECTURE-SPINE.md#Stack, #Structural Seed]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List
