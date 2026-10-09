---
baseline_commit: 8812f83667409c0e0fe185fc0b1896e56aeca0be
---

# Story 1.5: `objectClass` opcional

Status: review

## Story

Como **dev de um domínio que participa do Core de Diretório**,
quero declarar `objectClass` com containment, atributos e ACL herdável,
para que o domínio seja reconhecido como objeto de diretório e os atributos virem um schema que a UI e a persistência consomem.

## Acceptance Criteria

1. **Sem `objectClass`.** Dado um manifest sem `objectClass`, quando ele é parseado, então ele é válido e marcado como domínio que não participa do diretório (FR-2).
2. **`allowedParents` obrigatório.** Dado um `objectClass` sem `containment.allowedParents`, ou com a lista vazia, quando ele é validado, então a validação falha (FR-2).
3. **Atributos compilados.** Dado `attributes` no formato curto (`name`, `type`, `required`, `default`, `values`, `unique`), quando eles são compilados, então viram um JSON Schema draft-07 que o `@rjsf/core` 6.x e o validador de atributos do Directory conseguem consumir (AD-2). E `unique` vira o metadado de extensão `x-tecton-unique`. E um atributo com `readOnly: true` no manifest vira `readOnly` no JSON Schema.
4. **Padrões.** Dado um `objectClass` sem `extends` ou sem `acl.inheritable`, quando ele é parseado, então os valores padrão são `extends: DirectoryObject` e `acl.inheritable: true`.
5. **Containment só sintaxe.** Dado os campos `allowedParents` e `allowedChildren`, quando eles são validados, então só a sintaxe (PascalCase) é verificada. E a resolução contra outros domínios fica com a Story 1.6.
6. **Exemplo.** Dado o arquivo `docs/examples/tenant-domain-manifest-v0.yaml`, quando ele é validado, então ele passa sem erro.

## Tasks / Subtasks

- [x] **T1. Schema do `objectClass`** (AC: 2, 4, 5)
  - [x] Objeto fechado: `name` (PascalCase, obrigatório), `extends` (PascalCase, opcional), `attributes` (lista, opcional, padrão `[]`), `containment` (obrigatório: `allowedParents` lista PascalCase com `minItems: 1` e sem repetição; `allowedChildren` opcional, padrão `[]`), `acl` (opcional: `inheritable` booleano).
  - [x] Atributo: `name` (camelCase, obrigatório), `type` (obrigatório: um dos primitivos da 1.3 ou `enum`), `required` (booleano, padrão `false`), `default`, `values` (lista não vazia de strings, sem repetição), `unique` (booleano), `readOnly` (booleano).
- [x] **T2. Compilação dos atributos** (AC: 3)
  - [x] `src/object-class.ts`: `compileAttributes(attributes)` → JSON Schema draft-07 fechado. Cada atributo vira a propriedade do tipo (mapeamento da 1.3; `enum` + `values` → `{ type: string, enum: values }`), com `default` quando declarado, `readOnly: true` quando declarado e `x-tecton-unique: true` quando `unique`. `required` lista os atributos com `required: true`.
  - [x] Constante exportada `TECTON_UNIQUE_KEYWORD = 'x-tecton-unique'`: quem valida esse schema com Ajv em modo estrito precisa registrar a palavra (`ajv.addKeyword(TECTON_UNIQUE_KEYWORD)`); documentar no JSDoc.
- [x] **T3. Checagens em código** (AC: 2, 3)
  - [x] Nome de atributo repetido → `duplicate-name`.
  - [x] `type: enum` sem `values` → `required` em `...values`; `values` com tipo diferente de `enum` → código novo `invalid-attribute` (`values is only allowed with type: enum`).
  - [x] `type` desconhecido → `unknown-type`.
  - [x] `default` incompatível com o tipo (ou fora de `values`) → código novo `invalid-default`.
- [x] **T4. Resultado tipado** (AC: 1, 4)
  - [x] `TectonManifest.objectClass?: ManifestObjectClass` (com `extends` e `acl.inheritable` preenchidos pelos padrões, `attributes`, `containment` com `allowedChildren` padrão `[]`, e `attributesSchema` compilado) e `TectonManifest.participatesInDirectory: boolean`.
  - [x] Exportar `compileAttributes`, `TECTON_UNIQUE_KEYWORD`, `ManifestObjectClass`, `ObjectClassAttribute`.
- [x] **T5. Testes:** `src/object-class.test.ts` (ACs, casos de borda, schema compilado validado por Ajv estrito com a palavra registrada, `docs/examples/tenant-domain-manifest-v0.yaml`).
- [x] **T6. Verificação final:** `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:deps`.

## Dev Notes

- Atributos de `objectClass` usam o formato de **lista** (`{ name, type, ... }`), diferente do mapa curto de `input`/`output` da 1.3, porque precisam de metadados (`default`, `unique`, `readOnly`, `values`). O `type` aceita os mesmos primitivos e `enum` com `values` (é o formato do exemplo do Tenant).
- O schema compilado é guardado como bag JSON no Directory e validado pela aplicação (AD-2). `x-tecton-unique` não é palavra do JSON Schema: o Directory checa a unicidade (Story 4.1) e o `@rjsf` ignora palavras desconhecidas.
- `@rjsf/core` 6.x aceita draft-07; nenhum `title` é gerado aqui (os rótulos vêm do catálogo de i18n, Story 4.11).
- `schema.ts` continua sem imports.
- Casos de borda com teste: `allowedParents: []`; `containment` ausente; `name: tenant`; `allowedParents: [root]`; atributo `display_name`; atributo repetido; `type: enum` sem `values`; `values` em `string`; `default: 5` em `string`; `default: pending` fora de `values`; `default: true` em `boolean` (válido); `objectClass` com chave desconhecida.
- Códigos novos: `invalid-attribute`, `invalid-default`.
- [Source: epics.md#Story 1.5; PRD FR-2, FR-8; ARCHITECTURE-SPINE.md#AD-2, AD-10]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Fase vermelha: `object-class.test.ts` falhava por módulo inexistente.
- Ciclo evitado antes de rodar o `check:deps`: `types.ts` importaria `AttributesSchema` de `object-class.ts`, que importa `types.ts`. Os tipos `AttributeSchema`/`AttributesSchema` passaram a morar em `types.ts`.
- Teste da 1.2 sobre chaves reservadas atualizado: `objectClass: { name: Thing }` deixou de ser válido porque agora o `objectClass` é validado de verdade (exige `containment`).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Schema do `objectClass`: `name` e `extends` PascalCase; `attributes` em lista (`name` camelCase, `type`, `required`, `default`, `values`, `unique`, `readOnly`); `containment.allowedParents` obrigatório com pelo menos 1 classe; `allowedChildren` opcional; `acl.inheritable`. Containment só sintaxe (resolução na 1.6).
- `compileAttributes` gera JSON Schema draft-07 fechado: mesmos tipos da 1.3 + `enum` com `values`, `default`, `readOnly: true` e `x-tecton-unique: true`. Constante `TECTON_UNIQUE_KEYWORD`; testado com Ajv estrito após `addKeyword`.
- Checagens em código: atributo repetido (`duplicate-name`), tipo desconhecido (`unknown-type`), `enum` sem `values` (`required`), `values` fora de `enum` (código novo `invalid-attribute`), `default` incompatível com o tipo ou fora de `values` (código novo `invalid-default`, verificado com um Ajv sem checagem de formato).
- Resultado: `objectClass` com padrões (`extends: DirectoryObject`, `acl.inheritable: true`, `attributes: []`, `allowedChildren: []`) e `attributesSchema`; `participatesInDirectory` em todo manifest.
- Mensagem nova para `minItems` (`must list at least 1 item(s)`).
- Testes: 27 novos; suíte total 166 verde; build, typecheck e `check:deps` verdes. O exemplo do Tenant passa e compila `slug` com `x-tecton-unique`.

### File List

- `packages/manifest/src/object-class.ts` (novo)
- `packages/manifest/src/object-class.test.ts` (novo)
- `packages/manifest/src/schema.ts` (modificado)
- `packages/manifest/src/errors.ts` (modificado)
- `packages/manifest/src/parse.ts` (modificado)
- `packages/manifest/src/types.ts` (modificado)
- `packages/manifest/src/index.ts` (modificado)
- `packages/manifest/src/parse.test.ts` (modificado)

## Change Log

- 2026-10-09: Story 1.5 implementada: `objectClass` opcional com containment, atributos compilados para JSON Schema (com `x-tecton-unique` e `readOnly`) e padrões.
