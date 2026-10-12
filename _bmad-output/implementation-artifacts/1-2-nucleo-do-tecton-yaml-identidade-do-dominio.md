---
baseline_commit: 91eca00a558a56c9157c69973433e7e778c5d32a
---

# Story 1.2: Núcleo do `tecton.yaml` (identidade do domínio)

Status: review

<!-- Validação opcional: rodar a validação do create-story (checklist.md) antes do dev-story. -->

## Story

Como **dev ou agente de IA declarando um domínio**,
quero que o `@tecton/manifest` faça o parse e a validação dos campos de identidade do `tecton.yaml`,
para que um manifest inválido seja rejeitado com erro claro antes de qualquer geração.

## Acceptance Criteria

1. **Manifest válido.** Dado um `tecton.yaml` com `manifestVersion: "0.1"`, `domain`, `version` (semver), `description` e `dependencies: []`, quando eu chamo o parser, então recebo um objeto tipado e nenhum erro.
2. **Sem `manifestVersion`.** Dado um manifest sem `manifestVersion`, quando ele é validado, então a validação falha com erro no caminho `manifestVersion` (FR-1).
3. **Versão não suportada.** Dado um `manifestVersion` não suportado (ex.: `"9.9"`), quando ele é validado, então a validação falha e **lista as versões suportadas**.
4. **Formato de `domain` e `version`.** Dado um `domain` fora de kebab-case ou um `version` que não é semver, quando ele é validado, então a validação falha e indica o caminho do campo.
5. **Chave de topo desconhecida.** Dado uma chave de topo desconhecida (ex.: `action:` em vez de `actions:`), quando ela é validada, então a validação falha. E `actions`, `events` e `objectClass` são aceitos como chaves reservadas, validadas nas Stories 1.3 a 1.5.
6. **Erro de sintaxe YAML.** Dado um YAML com erro de sintaxe, quando ele é parseado, então o erro informa **linha e coluna**.
7. **Todos os erros de uma vez.** Dado um manifest com vários problemas, quando ele é validado, então todos os erros voltam de uma vez, cada um com `path`, `code` e `message`. E o texto de `message` está em **inglês** (Constitution §8, eixo 2).
8. **JSON Schema exportado.** Dado o pacote compilado, quando um editor ou agente de IA procura o schema, então o `@tecton/manifest` exporta o JSON Schema do `tecton.yaml`.

## Tasks / Subtasks

- [x] **T1. Dependências do pacote** (AC: todos)
  - [x] `pnpm add -F @tecton/manifest yaml@^2.9.1 ajv@^8.20.0` (dependências de runtime do pacote, não da raiz).
  - [x] Conferir se algum pacote novo pede script de build; se pedir, decidir em `allowBuilds` do `pnpm-workspace.yaml` (padrão: negar) e registrar o motivo.
- [x] **T2. Tipos públicos** (AC: 1, 7)
  - [x] `src/types.ts`: `TectonManifest` (campos de identidade + `dependencies: string[]` + `actions?`, `events?`, `objectClass?` como `unknown` por enquanto), `ManifestError { path: string; code: ManifestErrorCode; message: string; line?: number; column?: number }`, `ManifestErrorCode` (união de literais, lista em Dev Notes) e `ParseResult` (`{ ok: true; manifest } | { ok: false; errors }`).
- [x] **T3. JSON Schema do manifest** (AC: 2, 3, 4, 5, 8)
  - [x] `src/schema.ts`: `manifestJsonSchema`, objeto JSON Schema **draft-07** (Consistency Conventions), com `$id`, `title`, `description` por campo (aparecem no autocomplete do editor), `required: [manifestVersion, domain, version, description]`, `additionalProperties: false` e as regras da tabela "Regras de campo".
  - [x] `actions`, `events` e `objectClass` no schema como chaves reservadas **sem** validação interna (`{}` com `description` dizendo que são validadas a partir das Stories 1.3–1.5).
  - [x] `SUPPORTED_MANIFEST_VERSIONS = ['0.1'] as const`, exportada; o schema usa `enum` a partir dela.
- [x] **T4. Parser** (AC: 1, 6, 7)
  - [x] `src/parse.ts`: `parseManifest(source: string, options?: { fileName?: string }): ParseResult`.
  - [x] Parse com `parseDocument` do pacote `yaml` e um `LineCounter`, com `uniqueKeys: true` (chave duplicada é erro) e `prettyErrors: false`.
  - [x] Erros e avisos de sintaxe do `yaml` viram `ManifestError` com `code: 'yaml-syntax'`, `path: ''` e `line`/`column` (1-based). Mais de um documento no arquivo (`---`) também é `yaml-syntax`.
  - [x] Raiz que não é mapeamento (arquivo vazio, lista, escalar) → `code: 'invalid-root'`.
  - [x] Sem erro de sintaxe, valida com Ajv e devolve **todos** os erros (`allErrors: true`).
  - [x] Em sucesso, aplica o padrão `dependencies: []` quando ausente e devolve o objeto tipado.
  - [x] Nunca lança exceção para entrada inválida; só para erro de programação.
- [x] **T5. Tradução dos erros do Ajv** (AC: 2, 3, 4, 5, 7)
  - [x] `src/errors.ts`: converte cada erro do Ajv em `ManifestError` com `path` no formato de caminho com pontos e colchetes (`manifestVersion`, `dependencies[2]`), `code` estável e `message` em inglês, curta e acionável (exemplos em Dev Notes).
  - [x] `required` → caminho do **campo ausente** (`manifestVersion`), não do objeto pai.
  - [x] `additionalProperties` → caminho da **chave desconhecida** (`action`); se a chave estiver a uma edição de distância de uma chave conhecida, a mensagem sugere: `did you mean "actions"?`.
  - [x] `enum` de `manifestVersion` → mensagem lista as versões suportadas (AC 3).
  - [x] `manifestVersion` escrito sem aspas (`0.1` vira número no YAML) → `code: 'invalid-type'` com mensagem `must be a quoted string, e.g. "0.1"`.
  - [x] Localização: para cada erro, buscar o nó no `Document` do `yaml` pelo caminho e preencher `line`/`column` a partir de `node.range` + `LineCounter` (para `required`, usar a posição do objeto pai). A Story 1.6 depende disso para mostrar arquivo e linha.
  - [x] Ordenar os erros por linha e depois por caminho, para saída determinística.
- [x] **T6. Exportação do schema para editores** (AC: 8)
  - [x] `src/index.ts` exporta `parseManifest`, `manifestJsonSchema`, `SUPPORTED_MANIFEST_VERSIONS` e os tipos. Remover a constante `packageName` de placeholder da Story 1.1.
  - [x] Script `scripts/emit-schema.mjs` no pacote (`"emit": "node scripts/emit-schema.mjs"`), que importa `dist/schema.js` e grava `dist/tecton-manifest.schema.json` com indentação de 2 espaços e quebra de linha final. Na raiz, `"build": "tsc -b && pnpm -r --if-present run emit"`, para que o `pnpm build` (local e CI) sempre produza o JSON.
  - [x] `package.json` do pacote: `exports` ganha `"./schema.json": "./dist/tecton-manifest.schema.json"`.
- [x] **T7. Testes** (AC: 1–8)
  - [x] `src/parse.test.ts` cobrindo cada AC com YAML inline (Given/When/Then no nome), incluindo os casos da tabela "Casos de borda".
  - [x] Os dois manifests de `docs/examples/` **passam** nesta story: o conteúdo de `actions`, `events` e `objectClass` é aceito sem validação (chaves reservadas). Acrescentar um teste que lê os dois arquivos e espera `ok: true`. As Stories 1.3 a 1.5 passam a validar esse conteúdo e mantêm o teste verde.
  - [x] Teste que valida o próprio `manifestJsonSchema` com o meta-schema draft-07 do Ajv (schema bem-formado).
  - [x] Teste do JSON emitido: depois do build, `dist/tecton-manifest.schema.json` é igual a `manifestJsonSchema` (pode ficar num teste que roda o script em diretório temporário, ou na verificação final do T8).
  - [x] Teste de que toda `message` é ASCII/inglês (sem acentos), cobrindo a regra de idioma.
- [x] **T8. Verificação final**
  - [x] `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:deps` verdes.
  - [x] `node -e` importando `@tecton/manifest` do `dist` e parseando `docs/examples/tenant-domain-manifest-v0.yaml` com sucesso.

## Dev Notes

### Contexto e limites

- Primeira story com código de produto. Ela entrega **só** a identidade do domínio (`manifestVersion`, `domain`, `version`, `description`, `dependencies`) e trata `actions`, `events` e `objectClass` como chaves reservadas sem validação interna. As Stories 1.3 (actions), 1.4 (events), 1.5 (objectClass) e 1.6 (lint e resolução entre domínios) estendem este parser e este schema. Desenhe para extensão: o schema é um objeto montado em partes, e o tradutor de erros não pode depender de campos específicos. [Source: epics.md#Story 1.2 a 1.6]
- `@tecton/manifest` não importa nenhum outro pacote `@tecton/*` (AD-3; o `check:deps` falha se importar). [Source: ARCHITECTURE-SPINE.md#AD-3]
- O manifest é contrato público (PRD §8): o formato do erro (`path`, `code`, `message`, `line`, `column`) e os `code`s também são, e o `tecton-admin lint --format json` (1.6) os expõe para agentes de IA. Escolha nomes estáveis.

### Regras de campo

| Campo | Obrigatório | Regra | `code` em caso de erro |
|---|---|---|---|
| `manifestVersion` | sim | string, um de `SUPPORTED_MANIFEST_VERSIONS` (hoje só `"0.1"`) | `required`, `invalid-type`, `unsupported-manifest-version` |
| `domain` | sim | kebab-case `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, até 63 caracteres (vira rótulo DNS e `TECTON_SERVICE_<DOMÍNIO>_URL`) | `required`, `invalid-type`, `invalid-format` |
| `version` | sim | semver 2.0.0 completo (regex oficial de semver.org, com pre-release e build) | `required`, `invalid-type`, `invalid-format` |
| `description` | sim | string não vazia (após `trim`) | `required`, `invalid-type`, `invalid-format` |
| `dependencies` | não (padrão `[]`) | lista de nomes de domínio em kebab-case, sem repetição. A Story 1.6 estende com caminho explícito e recusa de URL remota | `invalid-type`, `invalid-format`, `duplicate-item` |
| `actions`, `events`, `objectClass` | não | reservadas; conteúdo validado a partir das Stories 1.3–1.5 | — |
| qualquer outra chave | — | proibida | `unknown-key` |

Os `code`s formam a união `ManifestErrorCode`: `yaml-syntax`, `invalid-root`, `required`, `invalid-type`, `invalid-format`, `unsupported-manifest-version`, `unknown-key`, `duplicate-item`. As stories seguintes acrescentam códigos; nenhum é renomeado.

### Mensagens (inglês, curtas, acionáveis)

- `manifestVersion is required`
- `unsupported manifestVersion "9.9"; supported versions: "0.1"`
- `manifestVersion must be a quoted string, e.g. "0.1"`
- `domain must be kebab-case (lowercase letters, digits and single hyphens), e.g. "leave-requests"`
- `version must be a semantic version, e.g. "1.0.0"`
- `unknown top-level key "action"; did you mean "actions"?`
- `dependencies[1] "billing" is listed more than once`

A mensagem nunca repete o valor inteiro de um campo longo e nunca contém acentos (teste do T7).

### Casos de borda (todos com teste)

| Entrada | Resultado esperado |
|---|---|
| Arquivo vazio ou só comentários | `invalid-root` |
| Raiz é lista ou escalar | `invalid-root` |
| Dois documentos (`---`) | `yaml-syntax` |
| Chave duplicada (`domain` duas vezes) | `yaml-syntax` com linha e coluna |
| Tab na indentação / mapeamento quebrado | `yaml-syntax` com linha e coluna |
| `manifestVersion: 0.1` (sem aspas) | `invalid-type` com a dica das aspas |
| `version: 1.0` (vira número) | `invalid-type` |
| `domain: Leave_Requests` / `-leave` / `leave-` / `leave--x` | `invalid-format` |
| `domain` com 64 caracteres | `invalid-format` |
| `version: 1.0.0-rc.1+build.5` | válido |
| `description: "   "` | `invalid-format` |
| `dependencies: [billing, billing]` | `duplicate-item` |
| Manifest com 4 problemas | 4 erros, ordenados por linha |

### Bibliotecas (verificadas no npm em 2026-10-09)

- **`yaml` 2.9.1** (eemeli/yaml): escolhido em vez do `js-yaml` porque expõe o AST com `range` de cada nó e o `LineCounter`, que dão linha e coluna para erros de **validação** (não só de sintaxe), algo de que a Story 1.6 precisa. Use `parseDocument`, nunca `parse` (perde as posições).
- **`ajv` 8.20.0** em modo estrito, `allErrors: true`, dialeto draft-07 (a classe padrão `Ajv` do pacote `ajv` é draft-07). O mesmo Ajv 8 é usado pelo Fastify (Story 1.7) e o draft-07 é o dialeto da Consistency Conventions. **Não** use `ajv/dist/2020`. **Não** adicione `ajv-formats`: as regras usam `pattern`.
- Compile o schema uma vez (no carregamento do módulo), não a cada chamada.

### Build do JSON do schema

O `pnpm build` da raiz era só `tsc -b` (Story 1.1), que não roda scripts dos pacotes. Decisão desta story: a raiz passa a `tsc -b && pnpm -r --if-present run emit`, e o `@tecton/manifest` define `emit`. Outros pacotes podem acrescentar o seu `emit` depois (ex.: OpenAPI na 1.7). O teste do T7 garante que o JSON emitido é idêntico a `manifestJsonSchema`.

### Aprendizados da Story 1.1

- Imports relativos com extensão `.js` (NodeNext + ESM). `exactOptionalPropertyTypes` está ligado: para `line?: number`, **omita** a propriedade em vez de atribuir `undefined`.
- Testes ficam em `packages/manifest/src/*.test.ts`; o `tsconfig.json` do pacote os exclui do build; o `pnpm typecheck` os checa.
- `pnpm test` roda sem Docker; nada desta story precisa de container.
- O pnpm 12 bloqueia scripts de instalação de dependências por padrão; decisões ficam em `allowBuilds` no `pnpm-workspace.yaml`.
- Rode `pnpm` pelo PowerShell com o PATH do sistema atualizado (Node 24 em `C:\Program Files\nodejs`, pnpm via shim do Corepack em `%APPDATA%\npm`).

### Test Design

Sem risco de score 6 nesta story. Cenários: P1-001 do `test-design-qa.md` (validação do núcleo do manifest, ~10 casos), mais os casos de borda acima. [Source: _bmad-output/test-artifacts/test-design-qa.md#P1]

### Estrutura de arquivos

```text
packages/manifest/
  package.json                 # UPDATE: dependências yaml/ajv, export ./schema.json, script emit
  scripts/emit-schema.mjs      # NEW
  src/index.ts                 # UPDATE: troca o placeholder pelos exports reais
  src/types.ts                 # NEW
  src/schema.ts                # NEW
  src/parse.ts                 # NEW
  src/errors.ts                # NEW
  src/parse.test.ts            # NEW
  src/schema.test.ts           # NEW
package.json                   # UPDATE (se a opção 1 do build do schema for escolhida)
```

Estado atual de `packages/manifest/src/index.ts`: só exporta `packageName = '@tecton/manifest'` (placeholder da 1.1); nada no repositório importa essa constante, pode ser removida.

### Project Structure Notes

- Alinhado ao Structural Seed (`packages/manifest`: schema, parser e validador do `tecton.yaml`). [Source: ARCHITECTURE-SPINE.md#Structural Seed]
- Identificadores, comentários, mensagens e nomes de arquivo em inglês. [Source: CONSTITUTION.md §8]

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2]
- [Source: _bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md#FR-1, §8]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#AD-3, #Consistency Conventions]
- [Source: docs/examples/tenant-domain-manifest-v0.yaml, docs/examples/leave-domain-manifest-v0.yaml]
- [Source: _bmad-output/implementation-artifacts/1-1-scaffold-do-monorepo-do-framework.md#Dev Agent Record]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Fase vermelha: os dois arquivos de teste falharam por módulos inexistentes antes da implementação.
- Primeira rodada verde parcial (40/42): o Ajv reporta em `uniqueItems` o índice **anterior** em `i` (o contrário do suposto), e o erro de campo ausente, localizado no objeto raiz (linha 1), empatava com o erro de `domain` na mesma linha. Corrigido: duplicata reportada no maior índice; ordenação por linha, coluna, `required` primeiro e caminho.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- `parseManifest(source)` com `yaml` 2.9.1 (`parseDocument` + `LineCounter`, `uniqueKeys`) e Ajv 8.20 (draft-07, estrito, `allErrors`). Nunca lança exceção para entrada inválida; devolve `{ ok, manifest }` ou `{ ok: false, errors }`.
- Erros com `path` em pontos e colchetes, `code` estável (8 códigos: `yaml-syntax`, `invalid-root`, `required`, `invalid-type`, `invalid-format`, `unsupported-manifest-version`, `unknown-key`, `duplicate-item`), `message` em inglês e `line`/`column` também para erros de validação (necessário para a Story 1.6). Para chave desconhecida, a posição é a da chave; para campo ausente, a do objeto pai.
- Tipo errado de um campo suprime os outros erros do mesmo caminho (ex.: `manifestVersion: 0.1` gera só a dica das aspas, não também o erro de versão não suportada).
- Sugestão "did you mean" para chave de topo a uma edição de distância de uma chave conhecida.
- `domain` limitado a 63 caracteres (rótulo DNS, nome de variável de serviço); `version` pela regex oficial de SemVer 2.0.0; `description` não vazia; `dependencies` opcional (padrão `[]`), nomes kebab-case sem repetição.
- JSON Schema draft-07 em `src/schema.ts`, exportado como `manifestJsonSchema` e emitido em `dist/tecton-manifest.schema.json` (export `@tecton/manifest/schema.json`). `$id` em URN (`urn:tecton:schema:tecton-manifest`), sem depender de domínio próprio, mesma escolha da Spine para o `type` do RFC 9457.
- O script de emissão importa o `src/schema.ts` direto (o Node 24 remove os tipos), então funciona com ou sem build; o teste do schema o executa em diretório temporário e compara com o objeto exportado.
- Build da raiz: `tsc -b && pnpm -r --if-present run emit`.
- Placeholder `packageName` da Story 1.1 removido (nada o importava).
- Testes: 42 no pacote (38 do parser, 4 do schema), cobrindo os 8 ACs e todos os casos de borda da tabela; suíte total 55 verde. `pnpm build`, `pnpm typecheck` e `pnpm check:deps` verdes. Verificado pelo `dist`: o exemplo do Tenant parseia com sucesso e um manifest com 5 problemas devolve os 5, com linha e coluna.
- Sem dependência com script de instalação (nada a decidir em `allowBuilds`).

### File List

- `package.json` (modificado: script `build` emite o schema)
- `pnpm-lock.yaml` (modificado)
- `packages/manifest/package.json` (modificado: dependências `yaml` e `ajv`, export `./schema.json`, script `emit`)
- `packages/manifest/scripts/emit-schema.mjs` (novo)
- `packages/manifest/src/index.ts` (modificado)
- `packages/manifest/src/types.ts` (novo)
- `packages/manifest/src/schema.ts` (novo)
- `packages/manifest/src/errors.ts` (novo)
- `packages/manifest/src/parse.ts` (novo)
- `packages/manifest/src/parse.test.ts` (novo)
- `packages/manifest/src/schema.test.ts` (novo)

## Change Log

- 2026-10-09: Story 1.2 implementada: parser e validador da identidade do `tecton.yaml`, erros estruturados com posição, JSON Schema draft-07 exportado.
