---
baseline_commit: 8f8cd23032f54cabcf0b6b31d48c7ea3f1a78618
---

# Story 1.8: AsyncAPI a partir dos events

Status: review

## Story

Como **dev ou agente de IA que precisa entender os contratos assíncronos de um domínio**,
quero que o AsyncAPI seja gerado a partir de `events`,
para que publicação e consumo de eventos fiquem documentados e validados sem escrita manual.

## Acceptance Criteria

1. **Operações e mensagens.** Dado um manifest válido com `events.publishes` e `events.consumes`, quando o `@tecton/manifest` gera o documento AsyncAPI, então cada evento publicado vira uma operação de envio e cada evento consumido vira uma operação de recebimento. E o payload de cada mensagem é o JSON Schema compilado na Story 1.4. E cada mensagem traz o `type` CloudEvents derivado (`com.tecton.<domínio>.<evento>`).
2. **Válido no parser.** Dado o documento gerado, quando ele é validado por `@asyncapi/parser`, então não há nenhum erro (FR-5).
3. **CI.** Dado um push ou pull request, quando o CI roda, então ele gera e valida o AsyncAPI dos manifests de `docs/examples/` e falha se a validação falhar.
4. **Sem events.** Dado um manifest sem `events`, quando o AsyncAPI é gerado, então o documento é válido e não tem operações, em vez de causar erro.

## Tasks / Subtasks

- [x] **T1. Gerador** (AC: 1, 4)
  - [x] `packages/manifest/src/asyncapi.ts`: `buildAsyncApiDocument(manifest, options?)` → objeto AsyncAPI **3.0.0** (puro, sem I/O): `info` do manifest, `defaultContentType: application/json`.
  - [x] Canais: um por domínio de origem (FR-21: um stream por domínio), id = nome do domínio, `address` = `tecton.<domínio>`. O canal do próprio domínio lista os eventos publicados; cada domínio consumido ganha seu canal com os eventos consumidos (mesclado se for o próprio domínio).
  - [x] Mensagens em `components.messages` (id `<Evento>` para publicados, `<domínio>.<Evento>` para consumidos de outro domínio): `name`, `title`, `summary` (a `description` do evento, quando houver), `payload` (JSON Schema da 1.4) e a extensão `x-cloudevents-type` com o `type` CloudEvents.
  - [x] Payload de evento consumido: vem de `options.resolveEvent(domain, event)` quando fornecido (o lint da 1.6 tem o índice de manifests); sem resolver, `{ type: object }` com `description` dizendo que o schema é o do manifest de origem.
  - [x] Operações: `send<Evento>` (`action: send`) para cada publicado; `receive<Domínio><Evento>` (`action: receive`) para cada consumido, ambas referenciando canal e mensagem por `$ref`.
- [x] **T2. Validação no parser** (AC: 2, 3)
  - [x] `@asyncapi/parser` 3.6.x como dependência de desenvolvimento da raiz (não vai para o runtime do `@tecton/manifest`).
  - [x] Testes em `asyncapi.test.ts` validando com o parser: manifest com publishes e consumes, manifest sem events, os dois exemplos.
  - [x] `tools/asyncapi/validate-examples.mjs` + script `pnpm validate:asyncapi`: carrega os manifests de exemplo pelo `dist`, gera e valida cada AsyncAPI, imprime o resultado e sai com código ≠ 0 em qualquer erro. Passo novo no job `build-test` do CI, depois do build.
- [x] **T3. Exportar** `buildAsyncApiDocument` e o tipo de opções no `index.ts`.
- [x] **T4. Verificação final:** `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:deps`, `pnpm lint:examples`, `pnpm validate:asyncapi`.

## Dev Notes

- AsyncAPI 3.0 separa canais (`address`, `messages`) de operações (`action`, `channel`, `messages`). O schema padrão de payload do AsyncAPI é um superconjunto do JSON Schema draft-07, então os schemas da 1.4 entram sem conversão.
- O documento é derivado, nunca escrito à mão (mesma regra do OpenAPI da 1.7).
- Verificar se o `@asyncapi/parser` tem scripts de instalação bloqueados pelo pnpm 12; se tiver, decidir em `allowBuilds` (padrão: negar).
- [Source: epics.md#Story 1.8; PRD FR-5, FR-21; ARCHITECTURE-SPINE.md#Consistency Conventions (eventos)]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- `@asyncapi/parser` traz o `@scarf/scarf`, cujo script de instalação só envia telemetria; bloqueado pelo pnpm 12 e negado explicitamente em `allowBuilds`.
- Typecheck do teste: o tipo `Input` do parser não aceita `Record<string, unknown>`; o teste passa o documento serializado (o parser aceita string).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- `buildAsyncApiDocument(manifest, { resolveEvent? })` gera AsyncAPI 3.0.0 puro: `info` do manifest, `defaultContentType: application/json`, um canal por domínio de origem (`address: tecton.<domínio>`), operação `send<Evento>` por evento publicado e `receive<Domínio><Evento>` por evento consumido, mensagens em `components.messages` com o payload JSON Schema da 1.4 e a extensão `x-cloudevents-type`. Consumo do próprio domínio reutiliza a mensagem publicada. Payload de evento consumido vem do `resolveEvent` quando houver; sem ele, objeto genérico apontando para o manifest de origem.
- Manifest sem events gera documento válido com `operations: {}`.
- `@asyncapi/parser` 3.6.3 como dev dependency da raiz (fora do runtime do `@tecton/manifest`).
- `tools/asyncapi/validate-examples.mjs` + `pnpm validate:asyncapi`: gera e valida o AsyncAPI de todos os manifests de `docs/examples/` com o parser oficial; passo novo no job `build-test` do CI.
- Testes: 10 novos (estrutura do documento, operações, payload, `type` CloudEvents, resolver, parser sem erros com e sem events e nos dois exemplos); suíte total 231 verde; build, typecheck, `check:deps`, `lint:examples` e `validate:asyncapi` verdes (5 documentos ok).

### File List

- `packages/manifest/src/asyncapi.ts` (novo)
- `packages/manifest/src/asyncapi.test.ts` (novo)
- `packages/manifest/src/index.ts` (modificado)
- `tools/asyncapi/validate-examples.mjs` (novo)
- `package.json` (modificado: dev dependency `@asyncapi/parser`, script `validate:asyncapi`)
- `pnpm-workspace.yaml` (modificado: `@scarf/scarf` negado em `allowBuilds`)
- `pnpm-lock.yaml` (modificado)
- `.github/workflows/ci.yml` (modificado: passo `validate:asyncapi`)

## Change Log

- 2026-10-09: Story 1.8 implementada: AsyncAPI 3.0 gerado dos events e validado pelo parser oficial, inclusive no CI.
