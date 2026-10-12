---
baseline_commit: cf530d3d39a58fc0e27f77abbb4bf8a4c5a15e05
---

# Story 1.3: Actions tipadas

Status: review

## Story

Como **dev declarando o que meu domínio faz**,
quero declarar `actions` com input e output tipados, autorização explícita e regras de aprovação e sensibilidade validadas,
para que contratos inconsistentes ou rotas abertas por esquecimento falhem antes de virar rota.

## Acceptance Criteria

1. **Action válida.** Dada uma action com `name` (camelCase, único no domínio), `description`, `input`, `output` e `auth.requires`, quando ela é validada, então ela passa. E `input` e `output` são compilados para JSON Schema draft-07 (Consistency Conventions), para uso na Story 1.7.
2. **Tipos curtos.** Dado um campo com tipo do sistema curto (`string`, `number`, `integer`, `boolean`, `uuid`, `date`, `datetime`, `enum[a,b]`), quando ele é compilado, então vira o JSON Schema equivalente (`uuid` vira `format: uuid` e `datetime` vira ISO 8601). E um tipo desconhecido falha a validação e o nome do tipo aparece no erro.
3. **`auth` obrigatório.** Dada uma action sem o bloco `auth`, quando ela é validada, então a validação falha, porque toda action declara a autorização de forma explícita.
4. **`auth.public`.** Dada uma action com `auth.public: true`, quando ela é validada, então ela passa sem `auth.requires`, como rota aberta declarada de propósito. E uma action com `auth.public: true` e `auth.requires` ao mesmo tempo falha a validação.
5. **`requires` vazio.** Dada uma action com `auth.requires` vazio e sem `auth.public: true`, quando ela é validada, então a validação falha.
6. **Formato de permissão.** Dada uma permissão em `auth.requires` fora do formato `<recurso>:<ação>`, quando ela é validada, então a validação falha.
7. **`sensitive` sem `description`.** Dada uma action com `sensitive` sem `description`, quando ela é validada, então a validação falha (FR-3).
8. **Exclusividade.** Dada uma action com `sensitive.quorum` e `approval` ao mesmo tempo, quando ela é validada, então a validação falha, porque os dois primitivos são mutuamente exclusivos (FR-3).
9. **`idempotent` padrão.** Dada uma action sem o campo `idempotent`, quando ela é parseada, então `idempotent` assume o valor `false`.

> Esta story só declara e valida. O estado pendente `202 Accepted` de `approval` em execução é do Epic 5 (FR-25).

## Tasks / Subtasks

- [x] **T1. Sistema de tipos curto** (AC: 2)
  - [x] `src/field-types.ts`: `parseFieldType(text)` → tipo estruturado ou erro; `compileFields(fields)` → JSON Schema de objeto; constantes `PRIMITIVE_TYPES` e `FIELD_TYPE_PATTERN` (usada também no schema do manifest para o editor).
  - [x] Mapeamento: `string` → `{type:string}`; `number` → `{type:number}`; `integer` → `{type:integer}`; `boolean` → `{type:boolean}`; `uuid` → `{type:string, format:uuid}`; `date` → `{type:string, format:date}`; `datetime` → `{type:string, format:date-time}` (ISO 8601 em UTC, Consistency Conventions); `enum[a,b]` → `{type:string, enum:[a,b]}`.
  - [x] **Campo opcional:** sufixo `?` (ex.: `nickname: string?`, `kind: "enum[a,b]?"`). Sem sufixo, o campo é obrigatório. Decisão desta story, necessária para a evolução aditiva (FR-29, Story 5.8). O objeto compilado lista os obrigatórios em `required` e usa `additionalProperties: false`.
  - [x] `enum[...]`: valores separados por vírgula, espaços em volta ignorados, pelo menos um valor, sem repetição, cada valor `^[a-zA-Z0-9_-]+$`.
  - [x] Nomes de campo: camelCase `^[a-z][a-zA-Z0-9]*$`.
- [x] **T2. Schema das actions** (AC: 1, 3–8)
  - [x] `actions` vira lista de objetos com `additionalProperties: false`: `name` (camelCase), `description` (não vazia), `input` e `output` (mapas campo → tipo curto; obrigatórios, podem ser `{}`), `auth` (obrigatório), `idempotent` (booleano, opcional), `sensitive` (opcional: `quorum` booleano obrigatório, `description` não vazia obrigatória), `approval` (opcional: `required` booleano obrigatório, `approver` `{ role, scope? }` opcional, `onApprove`/`onReject` `{ emit }` opcionais, com `emit` em PascalCase).
  - [x] `auth`: `oneOf` não. Valide em código para mensagens claras: exatamente um de `public: true` ou `requires` não vazio.
  - [x] Formato de permissão: `^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)+$` (dois ou mais segmentos: `tenant:create`, `auth:service:register`, `call:billing`).
- [x] **T3. Validação semântica em código** (AC: 1, 3–8)
  - [x] Depois do Ajv sem erros estruturais em `actions`, `src/actions.ts` checa: nome duplicado (`duplicate-name`, aponta a segunda ocorrência), `auth` sem `public` nem `requires` ou com `requires` vazio (`invalid-auth`), `public` junto com `requires` (`invalid-auth`), `public: false` explícito sem `requires` (`invalid-auth`), `sensitive.quorum: true` + `approval` (`mutually-exclusive`), tipo desconhecido (`unknown-type`, mensagem com o nome e a lista de tipos válidos).
  - [x] Erros semânticos e estruturais voltam juntos, ordenados como na 1.2, com linha e coluna.
- [x] **T4. Resultado tipado** (AC: 1, 2, 9)
  - [x] `TectonManifest.actions: ManifestAction[]` (padrão `[]`). `ManifestAction` traz os campos declarados, `idempotent: boolean` (padrão `false`) e `inputSchema`/`outputSchema` (JSON Schema draft-07 compilado).
  - [x] Exportar `parseFieldType`, `compileFields`, `PRIMITIVE_TYPES` e os tipos novos no `index.ts`.
- [x] **T5. Testes** (AC: 1–9)
  - [x] `src/actions.test.ts`: cada AC, mais os casos de borda listados em Dev Notes.
  - [x] `src/field-types.test.ts`: cada tipo, opcional, enum (espaços, vazio, repetido, valor inválido), tipo desconhecido.
  - [x] Os manifests de `docs/examples/` continuam passando (teste da 1.2) e o schema compilado de `createTenant` é verificado.
  - [x] Os schemas compilados são draft-07 válidos (meta-schema do Ajv).
- [x] **T6. Verificação final:** `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:deps`.

## Dev Notes

### Códigos de erro novos

`unknown-type`, `invalid-auth`, `mutually-exclusive`, `duplicate-name`. Acrescentar à união `ManifestErrorCode` (contrato público, nenhum código existente muda).

### Mensagens (inglês)

- `actions[2].input.slug has unknown type "strng"; valid types: string, number, integer, boolean, uuid, date, datetime, enum[a,b] (append "?" for optional)`
- `actions[0].auth must declare either "public: true" or a non-empty "requires" list`
- `actions[0].auth cannot be public and require permissions at the same time`
- `actions[0].auth.requires[1] must have the form <resource>:<action>, e.g. "tenant:create"`
- `actions[1].sensitive.description is required: explain why this action is sensitive`
- `actions[1] cannot use sensitive.quorum and approval together; choose one approval primitive`
- `actions[3].name "createTenant" is already used by actions[0]`

### Casos de borda (todos com teste)

| Entrada | Resultado |
|---|---|
| `input: {}` / `output: {}` | válido, objeto sem propriedades |
| `input` ausente | `required` em `actions[i].input` |
| `name: CreateTenant` / `create_tenant` | `invalid-format` |
| `auth: {}` | `invalid-auth` |
| `auth: { public: false }` | `invalid-auth` |
| `auth: { public: true, requires: [] }` | `invalid-auth` (as duas formas declaradas) |
| `requires: [tenant]` / `[Tenant:Create]` / `[tenant:]` | `invalid-format` |
| `sensitive: { quorum: false, description: x }` + `approval` | válido (só `quorum: true` conflita) |
| `enum[]` / `enum[a,a]` / `enum[a b]` | `unknown-type` com motivo |
| `"enum[ csv , json ]"` | válido, valores `csv`, `json` |
| campo `string?` | fora de `required` |
| `idempotent: "yes"` | `invalid-type` |
| chave desconhecida dentro da action (`timeout:`) | `unknown-key` com caminho `actions[0].timeout` |

### YAML: `enum[...]` em estilo flow

Dentro de `{ ... }`, `enum[a,b]` sem aspas quebra o YAML (colchete em contexto flow); os exemplos usam aspas: `format: "enum[csv,json]"`. Em estilo bloco (`format: enum[csv, json]`), sem aspas funciona. Documentar no `description` do schema e cobrir com teste dos dois estilos.

### Extensão da Story 1.2

- O schema monta `actions` a partir de um pedaço próprio (`actionSchema`), substituindo a entrada reservada.
- O tradutor de erros já é genérico; acrescentar mensagens específicas para `pattern` em caminhos de action (nome, permissão, `emit`) e `required` dentro de `sensitive`.
- A sugestão "did you mean" vale só para chaves de topo; dentro de action, `unknown-key` sem sugestão.
- `approval.onApprove.emit` contra `events.publishes` é da Story 1.4; aqui só o formato PascalCase.

### Test Design

P0-004 (bloco `auth` obrigatório, `public` × `requires`, formato de permissão; risco R-01: nenhuma rota aberta por esquecimento) e P1-002. [Source: _bmad-output/test-artifacts/test-design-qa.md]

### Aprendizados das Stories 1.1 e 1.2

- `exactOptionalPropertyTypes`: omitir propriedade em vez de `undefined`.
- O Ajv reporta `uniqueItems` com o índice anterior em `i`; ordenar por linha, coluna, `required` primeiro, caminho.
- Rodar `pnpm` a partir da raiz (`Set-Location` explícito no PowerShell).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3]
- [Source: _bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md#FR-3, FR-29]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#Consistency Conventions]
- [Source: docs/examples/*.yaml]
- [Source: _bmad-output/implementation-artifacts/1-2-nucleo-do-tecton-yaml-identidade-do-dominio.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Fase vermelha: `field-types.test.ts` e `actions.test.ts` falhavam por módulos inexistentes.
- Primeira rodada: 4 falhas. (1) O teste de emissão do schema quebrou porque `schema.ts` passou a importar `field-types.ts`, e o script de emissão carrega `schema.ts` com a remoção de tipos do Node, que não resolve `./x.js` para `./x.ts`. Corrigido mantendo `schema.ts` sem imports (comentário no topo explica) e `field-types.ts` reexportando `FIELD_NAME_PATTERN` de lá. (2) O helper do teste de nome não removia a linha `- name:` (com o traço da lista), gerando chave duplicada; o teste passou a substituir o nome no YAML.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Sistema de tipos curto (`field-types.ts`): 7 primitivos + `enum[a,b]`, sufixo `?` para opcional (decisão desta story, base da evolução aditiva da 5.8); `compileFields` gera objeto JSON Schema draft-07 fechado (`additionalProperties: false`, `required` só com os obrigatórios). `uuid` → `format: uuid`, `date` → `format: date`, `datetime` → `format: date-time`.
- Schema das actions: `name` camelCase, `description`, `input`/`output` (mapas com nomes camelCase via `propertyNames`), `auth`, `idempotent`, `sensitive` (`quorum` + `description` obrigatórios), `approval` (`required`, `approver`, `onApprove`/`onReject` com `emit` PascalCase). Formato de permissão com 2+ segmentos (`auth:service:register`, `call:billing`).
- Regras em código (`actions.ts`), com mensagens claras e posição: `invalid-auth` (nem `public` nem `requires`; `requires` vazio; `public: false` sozinho; `public` + `requires`), `mutually-exclusive` (`sensitive.quorum: true` + `approval`; `quorum: false` não conflita), `duplicate-name` (aponta a segunda ocorrência e cita a primeira), `unknown-type` (nome do tipo + lista de tipos válidos). Rodam junto com o Ajv; erros estruturais e semânticos voltam juntos, sem duplicar o mesmo caminho e código.
- Resultado: `TectonManifest.actions` (padrão `[]`) com `idempotent` (padrão `false`) e `inputSchema`/`outputSchema` compilados, prontos para a Story 1.7.
- Erros do Ajv: `propertyNames` reportado uma vez só, no caminho do campo; mensagens específicas para nome de action, permissão, `emit` e `sensitive.description` ausente.
- Exports novos: `compileFields`, `parseFieldType`, `PRIMITIVE_TYPES`, padrões `ACTION_NAME_PATTERN`, `EVENT_NAME_PATTERN`, `PERMISSION_PATTERN` e os tipos `ManifestAction`, `ActionAuth`, `ObjectSchema`, `FieldSchema`.
- Códigos novos na união pública: `unknown-type`, `invalid-auth`, `mutually-exclusive`, `duplicate-name`.
- Teste da 1.2 que comparava o manifest inteiro atualizado para incluir `actions: []` (padrão novo).
- Testes: 60 novos (22 de tipos, 38 de actions), incluindo enum em estilo bloco sem aspas e flow com aspas, e os exemplos de `docs/examples/`; suíte total 115 verde. Build, typecheck e `check:deps` verdes.

### File List

- `packages/manifest/src/field-types.ts` (novo)
- `packages/manifest/src/field-types.test.ts` (novo)
- `packages/manifest/src/actions.ts` (novo)
- `packages/manifest/src/actions.test.ts` (novo)
- `packages/manifest/src/schema.ts` (modificado)
- `packages/manifest/src/errors.ts` (modificado)
- `packages/manifest/src/parse.ts` (modificado)
- `packages/manifest/src/types.ts` (modificado)
- `packages/manifest/src/index.ts` (modificado)
- `packages/manifest/src/parse.test.ts` (modificado)

## Change Log

- 2026-10-09: Story 1.3 implementada: actions tipadas com sistema de tipos curto (opcional por `?`), autorização explícita, `sensitive`/`approval` exclusivos e schemas de input/output compilados.
