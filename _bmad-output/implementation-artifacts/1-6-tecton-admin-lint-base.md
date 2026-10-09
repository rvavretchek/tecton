---
baseline_commit: 48a29939825c31011dcb3b0e748313741df63ef7
---

# Story 1.6: `tecton-admin lint` (base)

Status: review

## Story

Como **dev ou agente de IA trabalhando num workspace Tecton**,
quero um comando único que valide todos os manifests e resolva as referências entre domínios,
para que uma referência quebrada falhe explicitamente em vez de passar como válida.

## Acceptance Criteria

1. **Validação de todos os manifests.** Dado um workspace com um ou mais `tecton.yaml`, quando eu rodo `tecton-admin lint`, então todos os manifests são validados com as regras das Stories 1.2 a 1.5. E o comando sai com código 0 se não houver erro e com código diferente de 0 se houver.
2. **Formato do erro.** Dado um erro encontrado, quando o lint o reporta, então a saída mostra arquivo, linha, `path`, `code` e `message`, em inglês.
3. **`--format json`.** Dada a opção `--format json`, quando eu rodo o lint, então a saída é JSON estruturado.
4. **Ordem de resolução.** Dada uma referência a outro domínio (`allowedParents`, `allowedChildren` ou `consumes`), quando o lint tenta resolvê-la, então a resolução segue esta ordem: (1) manifest no workspace local; (2) manifest exportado por um pacote npm instalado; (3) caminho explícito declarado em `dependencies`. E a resolução por pacote npm é testada com um pacote de fixture.
5. **Classe não resolvida.** Dado um `objectClass` em `allowedParents` ou `allowedChildren` que não é encontrado por nenhum dos três caminhos, quando o lint roda, então ele falha e nomeia a referência não resolvida (FR-2).
6. **Evento consumido inexistente.** Dada uma entrada `consumes` que aponta para um evento que não está em `publishes` do domínio de origem, quando o lint roda, então ele falha e nomeia o domínio e o evento.
7. **URL remota.** Dada uma dependência declarada por URL remota, quando o lint roda, então ele falha com mensagem clara de que esse modo de resolução não existe no MVP.
8. **Ciclo de dependências.** Dados domínios que dependem um do outro por chamada síncrona (ex.: Auth e Directory), quando o lint encontra o ciclo em `dependencies`, então registra um aviso que nomeia o ciclo, sem falhar.

> `lint:gateway` e o aviso de `sensitive.quorum` sem provider são do Epic 6 (FR-17), que estende este comando.

## Tasks / Subtasks

- [x] **T1. `dependencies` com caminho explícito** (AC: 4, 7)
  - [x] Cada item de `dependencies` passa a aceitar dois formatos: o nome do domínio (string kebab-case, como na 1.2) ou `{ domain, path }`, onde `path` é relativo ao `tecton.yaml` e aponta para outro `tecton.yaml` (arquivo ou diretório que o contém).
  - [x] Validação em código (o `oneOf` do JSON Schema gera erros confusos): item que parece URL (contém `://`, ou `{ url: ... }`) → código novo `unsupported-dependency` com a mensagem `dependencies[0]: remote manifests are not supported in the MVP; declare the domain name or a local path: { domain: billing, path: ../billing/tecton.yaml }`. Os códigos e mensagens da 1.2 para nome inválido e repetido continuam (repetição pelo nome do domínio).
  - [x] `TectonManifest.dependencies` continua `string[]` (nomes de domínio). Novo `dependencyPaths: Record<string, string>` com os caminhos declarados.
- [x] **T2. Lint do workspace em `@tecton/manifest`** (AC: 1, 4, 5, 6, 8)
  - [x] `src/lint/` com `lintWorkspace({ cwd })`: descobre todos os `tecton.yaml` sob `cwd` (ignora `node_modules`, `dist`, `.git`, diretórios ocultos), parseia cada um e devolve `{ problems: LintProblem[] }`, com `LintProblem = ManifestError & { file: string; severity: 'error' | 'warning' }` (`file` relativo a `cwd`, com `/`).
  - [x] Índice de manifests disponíveis, na ordem de precedência do AC 4: (1) os do workspace; (2) os de pacotes npm instalados que declaram `"tecton": { "manifests": ["./tecton.yaml"] }` no `package.json` (procurar nas dependências do `package.json` da raiz e do pacote de cada domínio, resolvendo com `createRequire` a partir do diretório do domínio); (3) os caminhos explícitos de `dependencies`. O primeiro encontrado vence.
  - [x] Checagens entre domínios (código novo `unresolved-reference`, severidade erro, com arquivo e linha da referência): classe de `allowedParents`/`allowedChildren` que nenhum manifest declara como `objectClass.name` (mensagem nomeia a classe e os três caminhos tentados); `consumes` com domínio desconhecido ou evento fora do `publishes` dele (mensagem nomeia domínio e evento); domínio de `dependencies` que não resolve; `path` de dependência que não existe ou cujo manifest declara outro `domain`.
  - [x] Ciclo em `dependencies` (grafo de chamadas síncronas entre os domínios resolvidos): aviso com código `dependency-cycle` que nomeia o ciclo (`auth -> directory -> auth`), um aviso por ciclo.
  - [x] Manifest inválido não interrompe o lint dos outros; erros de todos os arquivos voltam juntos, ordenados por arquivo, linha e coluna.
  - [x] Dois manifests com o mesmo `domain` no workspace → erro `duplicate-name` no segundo.
- [x] **T3. CLI `tecton-admin`** (AC: 1, 2, 3)
  - [x] `@tecton/cli` com `commander` 15 (dependência do pacote) e `@tecton/manifest` (`workspace:*`; acrescentar a `reference` no `tsconfig.json` do pacote).
  - [x] `src/bin.ts` (shebang `#!/usr/bin/env node`), `src/cli.ts` com `run(argv, io)` testável em processo (`io` com `stdout`, `stderr`, `cwd`), `src/commands/lint.ts`. `package.json`: `"bin": { "tecton-admin": "./dist/bin.js" }`.
  - [x] `tecton-admin lint [--format text|json] [--cwd <dir>]`. Saída texto: uma linha por problema, `file:line:column  severity  code  path  message`, e um resumo final (`2 errors, 1 warning in 3 manifests`). Saída JSON: `{ "manifests": n, "errors": n, "warnings": n, "problems": [...] }`. Código de saída 1 com erro, 0 sem erro (avisos não mudam o código).
  - [x] Nenhum manifest encontrado → erro claro (`no tecton.yaml found under <dir>`), código 1.
  - [x] Todo texto do CLI em inglês.
- [x] **T4. Testes**
  - [x] `packages/manifest/src/lint/*.test.ts` com workspaces de fixture em diretório temporário (helper que escreve arquivos), cobrindo cada AC, inclusive a ordem de precedência (mesmo domínio no workspace e num pacote: o do workspace vence) e o pacote npm de fixture em `node_modules/@fixture/directory-classes`.
  - [x] `packages/cli/src/cli.test.ts`: `run(['lint'])` com saída texto e JSON e os códigos de saída.
  - [x] Teste de `dependencies` com caminho e URL em `parse.test.ts` / novo arquivo.
- [x] **T5. Verificação final:** `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:deps`; rodar `node packages/cli/dist/bin.js lint --cwd docs/examples` e conferir que os dois exemplos passam (`Root` é embutida; `User`, `Group` e `Custodian` resolvem pelos stand-ins — ver Dev Notes).

## Dev Notes

- **Classe embutida `Root`:** `Root` é o topo da árvore do Directory e não tem pai; como a Story 1.5 exige `allowedParents` com pelo menos uma classe, ela não pode ser declarada por manifest. O lint a trata como **classe embutida do framework**, sempre resolvível (constante exportada `BUILTIN_DIRECTORY_CLASSES = ['Root']`). Usar `Root` como `objectClass.name` num manifest é erro (`reserved-name`).
- **Exemplos:** o exemplo do Tenant referencia `User`, `Group` e `Custodian`, que serão declaradas pelos manifests do `@tecton/directory` (Story 4.1). Até lá, acrescentar stand-ins em `docs/examples/directory-stubs/{user,group,custodian}/tecton.yaml` (um `objectClass` mínimo cada, com comentário dizendo que somem na Story 4.1), para que `tecton-admin lint --cwd docs/examples` passe.
- O lint é **lógica de domínio do manifest** (FR-2 diz que o lint valida `allowedParents`), então mora em `@tecton/manifest`; o CLI só lê argumentos e imprime. Isso também permite testar sem processo filho.
- Ler arquivos é permitido em `@tecton/manifest` (é um pacote Node); o `parseManifest` continua puro.
- Resolução por pacote npm: `createRequire(join(domainDir, 'package.json')).resolve('<pkg>/package.json')`; pacotes sem campo `tecton.manifests` são ignorados.
- `schema.ts` continua sem imports.
- Códigos novos: `unsupported-dependency`, `unresolved-reference`, `dependency-cycle`, `reserved-name`.
- A Story 1.10 acrescenta ao lint o aviso de divergência do `AGENTS.md`; o Epic 6 acrescenta `lint:gateway` e o aviso de quórum. Desenhe `lintWorkspace` para receber checagens extras.
- [Source: epics.md#Story 1.6; PRD FR-2, FR-17; ARCHITECTURE-SPINE.md#AD-3, AD-4]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Fase vermelha: testes de `dependencies`, do lint e do CLI falhavam por módulos inexistentes; o lint passou de primeira depois de implementado (183 testes no pacote).
- `tecton-admin lint --cwd docs/examples` achava só os stand-ins: os exemplos se chamam `*-domain-manifest-v0.yaml` e o lint procura `tecton.yaml`. Renomear quebraria referências no brief e no `epics.md`; em vez disso o comando ganhou `[paths...]` (arquivos de qualquer nome ou diretórios), útil também para agentes que validam um arquivo só.
- Duas edições feitas com Python perderam o `\n` dentro de strings TypeScript (uma quebrou o teste, a outra não aplicou a mudança no `lint.ts`, deixando o `dist` sem `paths`). Corrigidas com o editor. Lição: editar código com `\n` em string pelo editor, não por script.
- Ajv estrito recusa tipo união em `dependencies.items`; o item ficou sem tipo no schema e a forma é validada em código (incluindo tipo errado).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- `dependencies` aceita nome de domínio ou `{ domain, path }`; URL remota (string com `://`, `{ url }` ou `path` remoto) → `unsupported-dependency` com mensagem explícita do MVP. Repetição pelo nome do domínio. `TectonManifest.dependencyPaths` com os caminhos.
- `Root` é classe embutida (`BUILTIN_DIRECTORY_CLASSES`): sempre resolvível e proibida como `objectClass.name` (`reserved-name`), porque não tem pai e não satisfaria `allowedParents`.
- `lintWorkspace({ cwd, paths })` em `@tecton/manifest`: valida cada manifest (1.2–1.5), detecta domínio duplicado no workspace, resolve referências na ordem workspace → pacotes npm instalados (campo `"tecton": { "manifests": [...] }`, buscados a partir da raiz e de cada domínio, subindo `node_modules`) → caminhos explícitos; a primeira fonte vence. Erros `unresolved-reference` para classe, domínio/evento consumido, dependência e caminho inexistente ou de outro domínio; aviso `dependency-cycle` por ciclo (enumerado uma vez, a partir do menor domínio). Problemas com arquivo, linha e coluna, ordenados.
- `createLocator(source)` no parser, para posicionar problemas encontrados depois do parse.
- `@tecton/cli`: `tecton-admin lint [paths...] [--format text|json] [--cwd <dir>]` com commander 15; `run(args, io)` testável em processo; `bin` `tecton-admin` → `dist/bin.js`. Texto: `arquivo:linha:coluna  severidade  código  caminho  mensagem` + resumo; JSON com contagens e problemas. Saída 1 com erro, 0 sem erro (avisos não mudam). Caminho inexistente e workspace sem manifest falham com mensagem clara. Todo texto em inglês.
- Vitest passa a resolver `@tecton/*` para o `src` dos pacotes (testes não dependem do build).
- Stand-ins `docs/examples/directory-stubs/{user,group,custodian}/tecton.yaml` (somem na Story 4.1) e script `pnpm lint:examples`, que entrou no job `build-test` do CI.
- Códigos novos: `unsupported-dependency`, `unresolved-reference`, `dependency-cycle`, `reserved-name`.
- Testes: 53 novos (11 de dependencies/Root, 32 do lint, 10 do CLI); suíte total 206 verde; build, typecheck, `check:deps` e `lint:examples` verdes.

### File List

- `.github/workflows/ci.yml` (modificado: passo `lint:examples`)
- `package.json` (modificado: script `lint:examples`)
- `pnpm-lock.yaml` (modificado)
- `vitest.config.ts` (modificado: alias `@tecton/*` para o código-fonte)
- `docs/examples/directory-stubs/user/tecton.yaml` (novo)
- `docs/examples/directory-stubs/group/tecton.yaml` (novo)
- `docs/examples/directory-stubs/custodian/tecton.yaml` (novo)
- `packages/manifest/src/dependencies.ts` (novo)
- `packages/manifest/src/dependencies.test.ts` (novo)
- `packages/manifest/src/lint/lint-workspace.ts` (novo)
- `packages/manifest/src/lint/lint-workspace.test.ts` (novo)
- `packages/manifest/src/schema.ts`, `errors.ts`, `parse.ts`, `types.ts`, `object-class.ts`, `index.ts`, `parse.test.ts` (modificados)
- `packages/cli/package.json`, `packages/cli/tsconfig.json` (modificados)
- `packages/cli/src/index.ts` (modificado)
- `packages/cli/src/bin.ts`, `cli.ts`, `io.ts`, `commands/lint.ts`, `cli.test.ts` (novos)

## Change Log

- 2026-10-09: Story 1.6 implementada: `tecton-admin lint` com resolução entre domínios (workspace, pacotes npm, caminhos), dependências por caminho, `Root` embutida, saída texto/JSON.
