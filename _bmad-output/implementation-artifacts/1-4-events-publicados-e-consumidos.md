---
baseline_commit: 6bff6a89f5bccc484b7b5e3415def2f1101b049e
---

# Story 1.4: Events publicados e consumidos

Status: review

## Story

Como **dev declarando o que meu domínio publica e consome**,
quero declarar `events.publishes` e `events.consumes` com schema,
para que os contratos assíncronos sejam validados e fiquem prontos para o AsyncAPI e para o conector de mensageria.

## Acceptance Criteria

1. **Evento publicado.** Dado um evento em `publishes` com `name` (PascalCase, único no domínio) e `schema` no mesmo sistema de tipos da Story 1.3, quando ele é validado, então ele passa e o schema é compilado para JSON Schema. E o parser expõe o `type` CloudEvents derivado no formato `com.tecton.<domínio>.<evento>`, com regra determinística, documentada e coberta por teste.
2. **Consumo (só sintaxe).** Dada uma entrada em `consumes` que referencia `<domínio>.<Evento>`, quando ela é validada, então só a sintaxe é verificada. E a resolução contra o manifest do outro domínio fica com a Story 1.6.
3. **`emit` de aprovação.** Dada uma action com `approval.onApprove.emit` ou `approval.onReject.emit` apontando para um evento que não está em `publishes`, quando ela é validada, então a validação falha e o erro mostra o nome do evento.
4. **Exemplo.** Dado o arquivo `docs/examples/leave-domain-manifest-v0.yaml`, atualizado para o bloco `auth` da Story 1.3 se necessário, quando ele é validado, então ele passa sem erro.

> Nenhum código de broker nasce aqui. O conector Valkey Streams é do Epic 3 (FR-21).

## Tasks / Subtasks

- [x] **T1. Schema de `events`** (AC: 1, 2)
  - [x] `events`: objeto fechado com `publishes` e `consumes`, ambos opcionais (padrão `[]`).
  - [x] `publishes[]`: `name` (`EVENT_NAME_PATTERN`, PascalCase), `schema` (mesmo mapa campo → tipo curto da Story 1.3), `description` opcional (vai para o AsyncAPI na 1.8).
  - [x] `consumes[]`: string `^<domínio kebab>\.<Evento PascalCase>$`, sem repetição.
- [x] **T2. Regra do `type` CloudEvents** (AC: 1)
  - [x] `src/events.ts`: `cloudEventType(domain, eventName)` = `com.tecton.<domain>.<eventName em kebab-case>`. Ex.: (`tenant`, `TenantCreated`) → `com.tecton.tenant.tenant-created`; (`leave`, `LeaveApproved`) → `com.tecton.leave.leave-approved`; siglas tratadas como palavra (`ExportCSVReady` → `export-csv-ready`).
  - [x] **Decisão:** sem remover o prefixo do domínio do nome do evento, porque remover criaria colisões (`TenantCreated` e `Created` no mesmo domínio). O exemplo `com.tecton.tenant.exported` da Consistency Conventions é ilustrativo. Documentar a regra no JSDoc da função e no `description` do schema.
- [x] **T3. Validação semântica** (AC: 1, 3)
  - [x] Nome de evento repetido em `publishes` → `duplicate-name`.
  - [x] Tipo desconhecido no `schema` do evento → `unknown-type` (mesma mensagem da 1.3).
  - [x] `approval.onApprove.emit` / `onReject.emit` fora de `publishes` → código novo `unknown-event`, mensagem `actions[0].approval.onApprove.emit refers to event "LeaveApproved", which is not in events.publishes`.
- [x] **T4. Resultado tipado** (AC: 1, 2)
  - [x] `TectonManifest.events: { publishes: ManifestEvent[]; consumes: string[] }` (padrão com listas vazias). `ManifestEvent`: `name`, `schema` (como declarado), `description?`, `type` (CloudEvents) e `payloadSchema` (JSON Schema compilado).
  - [x] Exportar `cloudEventType`, `ManifestEvent`, `ManifestEvents`.
- [x] **T5. Testes:** `src/events.test.ts` cobrindo os ACs, a tabela da regra do `type` e os casos de borda; o exemplo `leave` continua passando e tem os `type`s esperados.
- [x] **T6. Verificação final:** `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:deps`.

## Dev Notes

- Reaproveitar `compileFields` (Story 1.3) para o payload. `EVENT_NAME_PATTERN` já existe em `schema.ts`.
- `schema.ts` continua **sem imports** (o `scripts/emit-schema.mjs` o carrega com a remoção de tipos do Node).
- Casos de borda com teste: `events: {}`; `publishes` sem `schema` (`required`); `name: tenantCreated` (`invalid-format`); `consumes: [Directory.UserCreated]`, `[directory.userCreated]`, `[directory]` (`invalid-format`); `consumes` repetido (`duplicate-item`); chave desconhecida em `events` (`unknown-key`); evento com `schema: {}` (válido).
- Código novo na união pública: `unknown-event`.
- `docs/examples/leave-domain-manifest-v0.yaml` já tem o bloco `auth` e os eventos `LeaveApproved`/`LeaveRejected`; não precisa mudar.
- [Source: epics.md#Story 1.4; ARCHITECTURE-SPINE.md#Consistency Conventions (Naming eventos); PRD FR-4, FR-21]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Fase vermelha: `events.test.ts` falhava por módulo inexistente.
- Bug pego antes do teste: o padrão `CONSUMED_EVENT_PATTERN` foi escrito com `'\.'`, que em string TypeScript vira só `.` (casaria qualquer caractere). Corrigido para `'\.'`; os testes de `consumes` inválido o cobrem.
- Interação com a 1.3: um `emit` fora de PascalCase passou a gerar também `unknown-event` no mesmo caminho. Regra geral adotada no parser: se já há erro estrutural num caminho, as checagens semânticas não acrescentam outro erro nesse caminho.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Schema de `events`: `publishes[]` (`name` PascalCase, `schema` no sistema de tipos curto, `description` opcional) e `consumes[]` (`<domínio>.<Evento>`, sem repetição), ambos opcionais com padrão `[]`; chave desconhecida em `events` é `unknown-key`.
- Regra do `type` CloudEvents (decisão desta story): `com.tecton.<domain>.<nome-do-evento-em-kebab-case>`, sem remover prefixo do domínio (evita colisão `TenantCreated` × `Created`); siglas contam como uma palavra (`ExportCSVReady` → `export-csv-ready`). Exposta como `cloudEventType()` e em cada `ManifestEvent.type`.
- Checagens em código (`events.ts`): nome de evento repetido (`duplicate-name`), tipo desconhecido no payload (`unknown-type`), `approval.onApprove/onReject.emit` fora de `publishes` (código novo `unknown-event`, com o nome do evento).
- `TectonManifest.events` com `publishes` (com `payloadSchema` compilado e `type`) e `consumes` (só sintaxe; a resolução é da 1.6).
- Testes: 24 novos em `events.test.ts` (regra do `type` em 5 casos + não colisão, publishes, consumes, emit, exemplo `leave` com os `type`s esperados); testes da 1.2 atualizados para o padrão `events: { publishes: [], consumes: [] }`. Suíte total 139 verde; build, typecheck e `check:deps` verdes.

### File List

- `packages/manifest/src/events.ts` (novo)
- `packages/manifest/src/events.test.ts` (novo)
- `packages/manifest/src/schema.ts` (modificado)
- `packages/manifest/src/errors.ts` (modificado)
- `packages/manifest/src/parse.ts` (modificado)
- `packages/manifest/src/types.ts` (modificado)
- `packages/manifest/src/index.ts` (modificado)
- `packages/manifest/src/parse.test.ts` (modificado)

## Change Log

- 2026-10-09: Story 1.4 implementada: events publicados e consumidos, `type` CloudEvents determinístico e checagem dos `emit` de aprovação.
