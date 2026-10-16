---
baseline_commit: dff2d921a9fe658d90681e354b3c5d890eb7b2ff
---

# Story 2.2a: Serviço `@tecton/auth`, parte 1: credenciais, persistência e bootstrap

Status: done

## Story

Como **dev de um sistema construído com o Tecton**,
quero que o serviço de Auth guarde credenciais no próprio banco e que eu consiga criar a primeira credencial administrativa,
para que exista quem se autentique antes de qualquer outro serviço subir (FR-12).

> Primeira metade da Story 2.2 original, dividida no Create Story de 2026-10-15 (`epics.md`, nota de divisão). Login, access token, JWKS e `apps/auth` no workspace gerado são da 2.2b.

## Acceptance Criteria

1. **Credenciais no próprio banco.** Dado o pacote `@tecton/auth`, quando ele sobe, então guarda só credenciais no próprio banco, via Prisma:
   - ID de sujeito em UUID v7;
   - identificador de login normalizado e único;
   - hash;
   - status;
   - lista de permissões.

   E nenhum outro serviço acessa esse banco (AD-9).
2. **Bootstrap.** Dado um workspace sem nenhuma credencial, quando rodo `tecton-admin auth bootstrap`, então a primeira credencial administrativa é criada.
   - A senha é lida da entrada padrão ou de variável de ambiente, nunca de argumento da linha de comando.
   - O comando grava direto no banco do Auth, com acesso local a ele; não existe endpoint HTTP de bootstrap.
3. **Bootstrap só uma vez.** Dado um Auth que já tem pelo menos uma credencial, quando alguém roda `tecton-admin auth bootstrap`, então o comando falha sem alterar nada.
4. **Manifest do Auth.** Dado o pacote `@tecton/auth`, quando inspeciono o que ele exporta, então ele traz o próprio `tecton.yaml`.
   - Traz as actions do Auth: `login`, `refresh`, `logout`, `service-token` e, a partir da Story 4.3, `create-credential`.
   - É resolvível pelo lint como pacote npm (Story 1.6).
   - O JWKS fica fora do manifest, porque não é action.
5. **Porta `Clock` (ASR-1 do Test Design, "antes da Story 2.2").** Dado qualquer código que precisa da hora atual (validade de token, datas de criação), quando ele a obtém, então usa a porta `Clock` de `@tecton/providers`, nunca `new Date()`/`Date.now()` direto. Em teste, a fixture `createTestClock` satisfaz a mesma porta.

## Tasks / Subtasks

- [x] **T1. Porta `Clock` (AC: 5)**
  - [x] `packages/providers/src/clock.ts`: `interface Clock { now(): Date }` e `systemClock: Clock` (`() => new Date()`). Exportar de `@tecton/providers`.
  - [x] Teste: `systemClock.now()` devolve a hora atual; `createTestClock()` de `#test-support` é atribuível a `Clock` (checagem de tipo num teste com `satisfies Clock`).
- [x] **T2. Dependências e build (AC: 1)** — **aprovadas pelo Boss no Create Story** (ver "Perguntas ao Boss", no fim)
  - [x] `@tecton/auth`:
    - `dependencies`: `@tecton/providers` (`workspace:*`), `@prisma/client` `7.10.0`, `@prisma/adapter-pg` `7.10.0`, `@prisma/adapter-mariadb` `7.10.0`, `prisma` `7.10.0` (CLI das migrations, usado em runtime pela T4), `uuid` (última 14.x que a política de idade mínima do pnpm aceitar);
    - **versões fixas da 7.x**: o `latest` do `prisma` no npm é `8.0.0-rc.23`, e um `pnpm add prisma` sem versão traria o 8, que a Spine proíbe (não suporta MySQL nem MariaDB);
    - a 7.10.1 saiu em 2026-10-15 e cai na idade mínima de release; não contornar a política (lição da 1.7).
  - [x] `pnpm-workspace.yaml` → `allowBuilds`:
    - `prisma: true` (`preinstall` que checa a versão);
    - `'@prisma/engines': true` (`postinstall` que baixa o schema engine usado pelas migrations).

    Comentário explicando por quê. Rodar `pnpm install` e confirmar que nada mais pede build.
  - [x] `@tecton/cli`: `dependencies` + `@tecton/auth` (`workspace:*`). AD-3: `cli` pode depender de todos; `auth` só de `manifest`, `providers` e `core`.
  - [x] Cliente Prisma gerado:
    - `packages/auth/package.json` → script `generate` (`prisma generate` para os dois schemas da T3);
    - raiz → `build`: `pnpm -r --if-present run generate && tsc -b && pnpm -r --if-present run emit`;
    - pasta gerada no `.gitignore` (`packages/auth/src/generated/`). O CI já roda `pnpm build` antes de typecheck e testes; confirmar.
- [x] **T3. Schema Prisma em dois dialetos (AC: 1)**
  - [x] `packages/auth/prisma/postgresql/schema.prisma` e `packages/auth/prisma/mysql/schema.prisma`, sem `url` no datasource (Prisma 7: a URL vai para o `prisma.config.ts`).
    - MariaDB e MySQL usam o provider `mysql` (Spine, tabela de stack).
  - [x] Gerador `prisma-client` com:
    - `output = "../../src/generated/<postgresql|mysql>"`;
    - `moduleFormat = "esm"`;
    - `importFileExtension = "js"` (o repositório usa `NodeNext`);
    - `generatedFileExtension = "ts"`.

    O cliente gerado é TypeScript compilado pelo `tsc` do pacote.
  - [x] Modelo único `Credential` (`@@map("credentials")`), igual nos dois arquivos, mudando só os tipos nativos `@db.*`:

    | Campo | Tipo e restrições | Coluna |
    |---|---|---|
    | `id` | `String`, `@id`, `@db.Char(36)` (UUID v7 canônico, AD-5) | |
    | `login` | `String`, `@unique`, `@db.VarChar(320)` | |
    | `passwordHash` | `String`, `@db.VarChar(256)` (PHC da 2.1) | `password_hash` |
    | `status` | `String`, `@db.VarChar(16)` (`active` ou `disabled`, validado em código) | |
    | `permissions` | `Json` (lista de strings) | |
    | `createdAt` | `DateTime` | `created_at` |
    | `updatedAt` | `DateTime` | `updated_at` |

    - Datas com precisão de milissegundo: `@db.Timestamptz(3)` no PostgreSQL e `@db.DateTime(3)` no MySQL.
    - Datas sempre vindas da `Clock`; sem `@default(now())` nem `@updatedAt`, para os testes serem determinísticos.
  - [x] Teste (`schema-parity.test.ts`) que lê os dois arquivos e confirma: mesmos modelos, mesmos campos, mesmos tipos Prisma e mesmos atributos fora de `@db.*`. Evita que um dialeto fique para trás.
- [x] **T4. Migrations (AC: 1)**
  - [x] Migration inicial gerada **sem banco**, com `prisma migrate diff --from-empty --to-schema <schema> --script` (confirmar os flags com `pnpm exec prisma migrate diff --help` da 7.10).
    - Gravar em `packages/auth/prisma/<dialeto>/migrations/0001_init/migration.sql`, com `migration_lock.toml` (`provider = "postgresql"` / `"mysql"`).
    - Registrar no Debug Log o comando exato.
  - [x] `packages/auth/prisma/<dialeto>/prisma.config.ts` com `schema`, `migrations.path` e `datasource.url` lida de `TECTON_AUTH_DATABASE_URL` (o mesmo nome que o Dev Services gera para o domínio `auth`; ver 1.11).
  - [x] `applyAuthMigrations({ databaseUrl })` em `@tecton/auth`:
    - escolhe o dialeto pela URL (T5);
    - roda `prisma migrate deploy --config <config do dialeto>` num processo filho, com `TECTON_AUTH_DATABASE_URL` só no ambiente do filho e o binário resolvido pelo campo `bin` do pacote `prisma` (como o `check-deps.mjs` faz com o dependency-cruiser);
    - erro do filho vira `Error` com a saída, **sem a URL** (ela tem senha). Usar o detector de segredos no teste.

    A Story 6.1 (`tecton-admin migrate`) vai orquestrar isso para todos os serviços; aqui é só a função do Auth.
- [x] **T5. Núcleo e adaptador Prisma (AC: 1, 3; AD-1, AD-9)**
  - [x] Estrutura hexagonal no pacote (AD-1), igual ao que a Story 3.4 vai gerar para os domínios:
    - `src/core/`: regras e a porta `CredentialStore`, sem nenhum import de Prisma;
    - `src/adapters/prisma/`: o adaptador;
    - `src/index.ts`: API pública.
  - [x] `src/core/credential.ts`:
    - tipo `Credential { id, login, passwordHash, status: 'active' | 'disabled', permissions: string[], createdAt, updatedAt }`;
    - `normalizeLogin(raw)`: NFKC, `trim()`, `toLowerCase()` (sem locale). Recusa vazio, mais de 320 caracteres e caractere de controle, com `InvalidLoginError`;
    - permissões validadas com `PERMISSION_PATTERN` de `@tecton/manifest` (mesma regra do `auth.requires`). Se usar, acrescentar `@tecton/manifest` às dependências; é permitido pelo AD-3.
  - [x] `src/core/credential-store.ts`: porta `CredentialStore`:
    - `count(): Promise<number>`;
    - `findByLogin(login): Promise<Credential | undefined>` (recebe já normalizado);
    - `create(credential): Promise<void>`, que lança `LoginTakenError` em violação de unicidade (`P2002`);
    - `close(): Promise<void>`.
  - [x] `src/adapters/prisma/prisma-credential-store.ts`: `createPrismaCredentialStore({ databaseUrl })` escolhe pelo esquema da URL:
    - `postgresql:`/`postgres:` → cliente gerado `postgresql` + `PrismaPg`;
    - `mysql:`/`mariadb:` → cliente gerado `mysql` + `PrismaMariaDb`. O adaptador MariaDB atende também MySQL; confirmar se ele exige o esquema `mariadb://` e converter `mysql://` se for o caso. O Dev Services gera `mysql://` também para MariaDB.

    Esquema desconhecido → erro claro, sem ecoar a URL.
  - [x] IDs com `uuid` (`v7()`), nunca implementação própria (AD-5).
- [x] **T6. Bootstrap (AC: 2, 3)**
  - [x] `src/core/bootstrap.ts`: `bootstrapAdmin({ store, auth, clock, login, password })`:
    - se `store.count() > 0`, lança `AlreadyBootstrappedError` sem escrever nada;
    - senão cria a credencial com `status: 'active'`, `permissions: BOOTSTRAP_ADMIN_PERMISSIONS` e o hash do `AuthProvider` da 2.1.
  - [x] `BOOTSTRAP_ADMIN_PERMISSIONS = ['auth:service:register', 'auth:credential:create']`: o primeiro é exigido pela Story 2.7 e o segundo pela 4.3. Constante exportada, documentada no README. O modelo papel × permissão (EQ-1) é decidido na 4.3; não antecipar.
  - [x] Corrida de dois bootstraps simultâneos: risco aceito e documentado. Comando local, de operador, rodado uma vez; a unicidade do login impede credencial duplicada com o mesmo login.
  - [x] CLI `tecton-admin auth bootstrap --login <identifier>` (`packages/cli/src/commands/auth-bootstrap.ts`):
    - senha de `TECTON_AUTH_BOOTSTRAP_PASSWORD` ou, se ausente, da entrada padrão (tudo até EOF, removendo **uma** quebra de linha final);
    - entrada padrão interativa (TTY) e sem a variável → erro pedindo `echo ... |` ou a variável (sem prompt nesta story);
    - **não existe opção de senha**: `--password` é recusado pelo commander como opção desconhecida (testar);
    - URL do banco de `TECTON_AUTH_DATABASE_URL` e Pepper de `pepperFromEnv()`. Faltando algum, erro claro e saída 1, sem escrever nada;
    - chama `bootstrapAdmin` com o adaptador Prisma e `createArgon2idAuthProvider({ peppers: [pepper], currentPepperId: pepper.id })`;
    - fecha a conexão sempre;
    - saída em inglês: `Created the first administrator credential "<login>" with permissions: ...`. Nunca imprime a senha nem o hash;
    - já com credencial → `auth bootstrap refused: the Auth database already has credentials; nothing was changed`, saída 1.
  - [x] `CliIo` ganha `stdin?: { isTTY?: boolean; readAll(): Promise<string> }`; `bin.ts` liga ao `process.stdin`. Os testes usam um stdin falso.
- [x] **T7. Manifest do Auth (AC: 4)**
  - [x] `packages/auth/tecton.yaml` (versão do manifest atual, `domain: auth`, `version` = versão do pacote), com contratos provisórios de cada action:

    | Action | `input` | `output` | `auth` | Rota |
    |---|---|---|---|---|
    | `login` | `{ login: string, password: string }` | `{ accessToken: string, tokenType: string, expiresIn: integer }` | `public: true` | |
    | `refresh` | `{}` (o refresh vem no cookie, 2.3) | o mesmo de `login` | `public: true` | |
    | `logout` | `{}` | `{}` | `public: true` (o cookie identifica a família) | |
    | `serviceToken` | `{ serviceId: string, secret: string }` | o mesmo de `login` | `public: true` | `POST /auth/service-token` |

    Sem `create-credential` (Story 4.3). Sem JWKS (não é action). As Stories 2.2b, 2.3 e 2.7 podem ajustar os contratos de forma aditiva.
  - [x] `package.json` do `@tecton/auth`:
    - `"tecton": { "manifests": ["./tecton.yaml"] }` (formato que o lint lê, Story 1.6);
    - `tecton.yaml` e `prisma/` no `files`.
  - [x] Teste: workspace temporário com `node_modules/@tecton/auth` como link para `packages/auth` e um domínio que declara `dependencies: [auth]` → `lintWorkspace` sem problemas. O manifest do Auth também passa no `parseManifest`.
- [x] **T8. Testes (todas as ACs; fase vermelha dos negativos no Debug Log, retro do Epic 1, A3)**
  - [x] Unitários (`*.test.ts`, sem banco):
    - `normalizeLogin`, com casos de borda e erros;
    - `bootstrapAdmin` com um `CredentialStore` em memória do próprio teste: cria, recusa a segunda vez sem chamar `create`, usa a `Clock` e as permissões da constante, guarda hash e nunca a senha;
    - escolha do dialeto pela URL, com erro sem ecoar a URL;
    - CLI `auth bootstrap`: senha por variável, por stdin, TTY recusado, `--password` recusado, variáveis faltando. Com um `CredentialStore` injetado: a fábrica do comando aceita a dependência para teste, como o `run(args, io)` já faz com o `io`.
  - [x] Persistência (`*.persistence.test.ts`, matriz de 3 bancos do CI; local pelo túnel do `.env.example`):
    - `applyAuthMigrations` num banco vazio do Testcontainers (`startDatabase()` de `#test-support`);
    - criar e ler uma credencial (UUID v7 canônico, permissões JSON de ida e volta, datas da `Clock`);
    - `count`;
    - login duplicado → `LoginTakenError`;
    - `bootstrapAdmin` duas vezes → segunda falha e a tabela continua com 1 linha.
    - **Validar com o MySQL 8.4 e o MariaDB 11.8 de verdade**, porque o adaptador MariaDB atendendo MySQL é premissa a confirmar.
  - [x] Sem vazamento: a senha do bootstrap e a URL do banco (com senha) nunca aparecem na saída do CLI nem em erro (`assertNoSecretsLeaked`).
- [x] **T9. README do `@tecton/auth` (inglês) e verificação final**
  - [x] `packages/auth/README.md`: o que a parte 1 entrega; `TECTON_AUTH_DATABASE_URL` e dialetos; `applyAuthMigrations`; `tecton-admin auth bootstrap` (senha por stdin ou variável, nunca argumento); `BOOTSTRAP_ADMIN_PERMISSIONS`; normalização de login; AD-9 (banco só do Auth).
  - [x] Verificação completa: `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test` e `test:persistence` (local pelo túnel para o Docker remoto, ao menos com `TECTON_TEST_DB=postgres`; os três bancos no CI).
  - [x] Code review por story antes da 2.2b (retro do Epic 1, A1).

### Review Findings (code review da Story 2.2a, 2026-10-16)

- [x] [Review][Patch] P1 (alta) Login aceita caracteres invisíveis e de formatação (U+200B, U+202E, U+00AD, U+2028), criando logins que parecem iguais (confirmado). A segunda parte do achado (minúsculas depois do NFKC desnormalizariam, como no İ) não se confirmou: nenhum code point do Unicode no Node 24 sai do NFKC ao passar para minúsculas (verificação exaustiva) [packages/auth/src/core/credential.ts]
- [x] [Review][Patch] P2 (média) Erro de banco no `auth bootstrap` sai como stack trace cru (confirmado); `LoginTakenError` não tratado; erro do `close()` mascara o original [packages/cli/src/commands/auth-bootstrap.ts]
- [x] [Review][Patch] P3 (média) Bootstrap concorrente pode criar dois administradores (count e create separados): passar a contagem e a inserção para uma transação serializável [packages/auth/src/core/bootstrap.ts, adapters/prisma]
- [x] [Review][Patch] P4 (média) Senha do primeiro administrador sem mínimo (`x` e só espaços aceitos; confirmado) [packages/auth/src/core/bootstrap.ts]
- [x] [Review][Patch] P5 (média) Linhas lidas não são validadas: `status` desconhecido e permissões fora do formato passam (cast); não lista vira `[]` em silêncio [packages/auth/src/adapters/prisma/prisma-credential-store.ts]
- [x] [Review][Patch] P6 (média) PostgreSQL: `?schema=` vale para as migrations e é ignorado pelo `PrismaPg` em runtime [prisma-credential-store.ts]
- [x] [Review][Patch] P7 (média) Processo filho das migrations herda todo o ambiente (Pepper, senha do bootstrap) [packages/auth/src/adapters/prisma/migrations.ts]
- [x] [Review][Patch] P8 (média) Erro das migrations mascara só a URL exata: a senha sozinha, decodificada ou com outra codificação vazaria; saída sem limite [migrations.ts]
- [x] [Review][Patch] P9 (média) stdin que nunca fecha deixa o comando pendurado (confirmado); `TECTON_AUTH_BOOTSTRAP_PASSWORD=` vazio cai para o stdin em silêncio [auth-bootstrap.ts]
- [x] [Review][Patch] P10 (baixa) URL com espaço ou esquema em maiúsculas (`MARIADB://`) quebra a conversão de esquema (confirmado) [prisma-credential-store.ts, migrations.ts]
- [x] [Review][Patch] P11 (baixa) Qualquer `P2002` vira `LoginTakenError`, inclusive id repetido [prisma-credential-store.ts]
- [x] [Review][Patch] P12 (baixa) Processo das migrations sem timeout; morte por sinal aparece como "exited with null" [migrations.ts]
- [x] [Review][Patch] P13 (baixa) Mensagem de dialeto ecoa o "esquema", que pode ser o começo de um segredo colado por engano (confirmado) [packages/auth/src/adapters/prisma/dialect.ts]
- [x] [Review][Patch] P14 (baixa) Ajuda do comando e README omitem `TECTON_AUTH_PEPPER_ID` (Pepper com outro id gera `keyid` errado) [cli.ts, packages/auth/README.md]
- [x] [Review][Patch] P15 (baixa) Código de saída igual para "já tem credencial" e falha real; usar 2 para a recusa [auth-bootstrap.ts]
- [x] [Review][Patch] P16 (baixa) `CREATE SCHEMA IF NOT EXISTS "public"` na migration exige CREATE no banco para um papel de menor privilégio [prisma/postgresql/migrations/0001_init/migration.sql]
- [x] [Review][Patch] P17 (baixa) Collation binária protegida só no arquivo da primeira migration; conferir a coluna viva em `information_schema` [prisma-credential-store.persistence.test.ts]
- [x] [Review][Patch] P18 (baixa) Testes faltando: vazamento no caminho de erro de banco; "bootstrap duas vezes, 1 linha" literal; todas as URLs recusadas checadas para vazamento [testes]
- [x] [Review][Patch] P19 (baixa) `uuid` com faixa `^` enquanto o Prisma está fixo; fixar `14.0.3` [packages/auth/package.json]
- [x] [Review][Patch] P20 (baixa) `catch` de qualquer `RangeError` no CLI como erro do usuário; trocar por erro específico de política de senha [auth-bootstrap.ts]
- [x] [Review][Patch] P21 (baixa) Dev Agent Record: dependência do CLI em `@tecton/providers` não registrada [esta story]
- [x] [Review][Patch] P22 (alta, CI) `check:deps` falhou no CI: o dependency-cruiser 18.5 não resolve o `uuid` 14 no Linux (reproduzido num container `node:24`), embora Node, TypeScript e o próprio enhanced-resolve resolvam; regra `not-to-unresolvable` restrita aos imports do Tecton (relativos, `@tecton/*`, `#`), já que imports de terceiros são garantidos pelo `typecheck` [.dependency-cruiser.cjs]
- [x] [Review][Defer] W1 TLS: uma mesma URL não configura TLS igual para o motor de migrations e para o driver `mariadb` [prisma-credential-store.ts, migrations.ts] — adiado: configuração de conexão vem com o `ConfigProvider` (Story 3.1) — adiado
- [x] [Review][Defer] W2 Timezone da sessão no MySQL/MariaDB (`DATETIME` sem fuso) [prisma/mysql/schema.prisma] — adiado: forçar UTC no driver e testar com sessão fora de UTC quando o serviço subir (2.2b) — adiado
- [x] [Review][Defer] W3 Teste do pacote empacotado (`pnpm pack`, instalação e import) e `allowBuilds` no workspace gerado [packages/auth] — adiado: Story 2.2b, que instala o `@tecton/auth` no `apps/auth` — adiado
- [x] [Review][Defer] W4 `ß` e `SS` continuam logins diferentes (`toLowerCase` não faz case folding completo) [credential.ts] — adiado: decidir com o modelo de identidade da 4.3; trocar a normalização depois exige migrar logins — adiado
- Descartado: AD-9 "não imposto em código". O AD-3 já impede outro pacote do framework de importar `@tecton/auth` (só o CLI pode), e cada serviço tem banco e credencial próprios.

## Dev Notes

### Prisma 7: o que mudou e afeta esta story (verificado em 2026-10-15)

- **Gerador e cliente:**
  - gerador `prisma-client` com `output` **obrigatório**; não gera mais em `node_modules`;
  - o cliente é TypeScript compilado pelo consumidor;
  - `generate` não roda mais sozinho no install.
- **Conexão:**
  - **driver adapter obrigatório** para todo banco: `PrismaPg` (`@prisma/adapter-pg`, que traz `pg`) e `PrismaMariaDb` (`@prisma/adapter-mariadb`, que traz `mariadb`);
  - `prisma.config.ts` é o lugar da URL; `url` no `schema.prisma` saiu.
- **Gerador para NodeNext:** `moduleFormat = "esm"` e `importFileExtension = "js"`.
- **Versões:**
  - `prisma` CLI: `latest` = `8.0.0-rc.23`. **Fixar `7.10.0`**;
  - `@prisma/client`: `latest` = `7.10.1` (de 2026-10-15). A 7.10.0 é de 2026-08-25.
- **Scripts de instalação:** `prisma` tem `preinstall` e `@prisma/engines` tem `postinstall` (baixa o schema engine das migrations). Os dois exigem `allowBuilds`.
- **Multibanco num pacote pronto:** a documentação não cobre esse caso. A solução desta story é **um schema por dialeto** (PostgreSQL e MySQL, este atendendo MariaDB), **um cliente gerado por dialeto** e escolha em runtime pela URL. Isso cumpre o NFR-4: trocar de banco não muda código de domínio, só a URL. O teste de paridade (T3) impede divergência entre os schemas.

### Outras bibliotecas

- `uuid` 14.0.3 (2026-10-10): `v7()` (AD-5). Confirmar se a idade mínima de release do pnpm aceita; senão, a 14.x anterior.
- `jose` (6.2.12) é da 2.2b, não desta.

### Código existente que esta story toca

| Arquivo | Situação |
|---|---|
| `packages/auth/src/index.ts` | UPDATE: hoje só o placeholder `packageName`, que ninguém importa; passa a exportar a API |
| `packages/auth/package.json` | UPDATE: dependências, `tecton.manifests`, `files`, script `generate` |
| `packages/providers/src/index.ts` | UPDATE: exporta `Clock`/`systemClock` |
| `packages/cli/src/io.ts` e `bin.ts` | UPDATE: `stdin` opcional. Preservar os comandos existentes, que não usam stdin |
| `packages/cli/src/cli.ts` | UPDATE: grupo `auth` com `bootstrap`. Preservar `lint`, `new`, `generate domain` e o tratamento de `CliError` |
| `package.json` (raiz) | UPDATE: `build` com `generate` antes do `tsc -b` |
| `pnpm-workspace.yaml` | UPDATE: `allowBuilds` |
| `.gitignore` | UPDATE: cliente gerado |

- `tests/support/containers.ts` já dá `startDatabase()` com `url` no formato do Prisma (`postgresql://`, `mariadb://`, `mysql://`).
- O teste `containers.persistence.test.ts` já roda nos três bancos.

### Fora desta story (não fazer)

- Login, JWT, JWKS e chave de assinatura: 2.2b.
- `apps/auth` no `tecton-admin new` e o banco `auth` no Dev Services: 2.2b, junto com o serviço que sobe.
- Refresh e logout (2.3), verificação do token (2.4), `register-service` (2.7) e `create-credential` (4.3).
- Comando `tecton-admin migrate` para todos os serviços (6.1).

### Padrões do Epic 1 e da 2.1 a seguir

- Código, mensagens, saída do CLI e README em inglês.
- TypeScript só pelo editor; nunca `\uXXXX` em arquivo novo (usar `String.fromCodePoint`).
- Resultado novo a cada chamada, nunca objeto compartilhado mutável: lição P1 do review da 2.1.
- Segredos (senha, URL com senha, Pepper) nunca em mensagem; testar com `assertNoSecretsLeaked`.
- Desvio de AC ou task registrado no Dev Agent Record na hora.

### Perguntas ao Boss (respondidas antes do desenvolvimento)

1. Dependências novas da T2 e `allowBuilds` para `prisma` e `@prisma/engines`: **aprovadas** (2026-10-15).
2. `BOOTSTRAP_ADMIN_PERMISSIONS = ['auth:service:register', 'auth:credential:create']`: **aprovado** (2026-10-15).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2a] (e a nota de divisão)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#AD-1, AD-3 (emenda 2026-10-01), AD-5, AD-7 (endurecimento de 2026-10-06: bootstrap só local), AD-9, tabela de stack (Prisma 7.x, MariaDB pelo provider mysql)]
- [Source: _bmad-output/test-artifacts/test-design-qa.md#ASR-1 (Clock antes da 2.2), P0-007 (bootstrap só local, segunda execução falha, senha nunca por argumento)]
- [Source: _bmad-output/implementation-artifacts/2-1-authprovider-com-argon2id-e-pepper.md] (`AuthProvider`, `pepperFromEnv`)
- [Source: _bmad-output/implementation-artifacts/1-11-dev-services.md] (`TECTON_<DOMÍNIO>_DATABASE_URL`, `mysql://` também para MariaDB)
- [Source: Prisma ORM 7 upgrade guide; generators reference (prisma-client)]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- **Fase vermelha inicial:** os testes do núcleo (`credential`, `bootstrap`, `dialect`) e do `Clock` falharam por módulos inexistentes. Os de paridade e manifest checam arquivos e passaram de início; a fase vermelha deles veio por mutação (abaixo).
- **Migrations geradas sem banco:**

  ```bash
  pnpm exec prisma migrate diff --config prisma/<dialeto>/prisma.config.ts --from-empty --to-schema prisma/<dialeto>/schema.prisma --script -o prisma/<dialeto>/migrations/0001_init/migration.sql
  ```

  O `migration_lock.toml` foi escrito à mão com o provider de cada dialeto.
- **Collation no MySQL/MariaDB:** a tabela gerada usa `utf8mb4_unicode_ci`, que ignora caixa e acento, então "jose" e "josé" colidiriam no índice único (no PostgreSQL, não). A coluna `login` da migration MySQL foi editada à mão para `utf8mb4_bin`, porque o Prisma não modela collation. Um teste confere a edição e o teste de persistência prova o comportamento nos três bancos.
- **`prisma.config.ts`:** o `env()` do `prisma/config` lança quando a variável falta, e o `generate` não precisa de banco. A URL passou a ser lida com `process.env[...] ?? ''`.
- **Esquema da URL do MariaDB** (pego no primeiro teste de persistência, que falhou no MariaDB): o motor de migrations só aceita `mysql://`, e o driver `mariadb` do adapter só `mariadb://`. O `applyAuthMigrations` converte `mariadb://` para `mysql://`; o adaptador converte `mysql://` para `mariadb://`.
- **`migrate deploy` no PostgreSQL** cria o banco quando ele não existe. O teste de falha passou a usar senha errada.
- **`check:deps`** acusou ciclos dentro do cliente gerado pelo Prisma, que não é código do Tecton. `packages/*/src/generated/` foi excluído do dependency-cruiser.
- **Teste de higiene de fonte (A2):** estourou o limite padrão de 5 s com a suíte inteira (8,6 s; 0,7 s isolado) e ganhou limite próprio de 30 s, como o do `check:deps`.
- **Persistência pelo túnel para o Docker remoto,** nos três bancos: 7/7 em PostgreSQL 18, MariaDB 11.8 e MySQL 8.4. O adapter MariaDB atende MySQL 8.4, premissa confirmada.
- **Fase vermelha por mutação (A3),** cada uma restaurada:

  | Mutação | Testes que falharam |
  |---|---|
  | login vazio aceito | 2 |
  | caractere de controle aceito | 2 |
  | permissão repetida aceita | 1 |
  | bootstrap repetido | 2 |
  | dialeto ecoa a URL | 1 |
  | dialeto desconhecido aceito | 2 |
  | senha impressa | 1 |
  | stdin com `trim` total | 1 |
  | schema MySQL divergente | 1 |
  | collation removida | 1 |
  | stdin lido em terminal interativo | 0 na primeira rodada; teste corrigido, agora 1 |

- **Code review (2026-10-16), CI vermelho no `check:deps`:** o dependency-cruiser 18.5 não resolve o `uuid` 14 no Linux. Reproduzido num container `node:24` no ubt-host02 com o `git archive` do commit. Node, TypeScript e o próprio enhanced-resolve 5.26 resolvem; o dependency-cruiser marca `couldNotResolve` com qualquer combinação de condições e extensões. A regra `not-to-unresolvable` ficou restrita aos imports do Tecton; ainda pega import relativo e `@tecton/*` quebrados (verificado plantando um arquivo).
- **Code review, P3 no PostgreSQL:** a falha de serialização chega como `DriverAdapterError` de tipo `TransactionWriteConflict` (SQLSTATE 40001), não como `P2034`. `isWriteConflict` reconhece as duas formas. O teste de dois bootstraps concorrentes passou 3 vezes seguidas no PostgreSQL e nos três bancos.
- **Code review, P1:** caracteres invisíveis no fim do login são removidos pelo `trim()` (BOM e separadores contam como espaço). O teste passou a colocá-los no meio, onde está o risco real.
- **Fase vermelha das correções do review (A3):**

  | Mutação | Testes que falharam |
  |---|---|
  | invisíveis aceitos | 13 |
  | sem mínimo de senha | 2 |
  | resultado do `createIfEmpty` ignorado | 1 |
  | ambiente inteiro para o filho | 1 |
  | só a URL exata mascarada | 1 |
  | esquema ecoado | 1 |
  | variável vazia cai no stdin | 1 |
  | erro cru impresso | 1 |
  | recusa com saída 1 | 1 |

  Duas mutações sobreviveram por serem equivalentes:
  - a segunda NFKC: nenhum code point a exige; foi removida do código;
  - o `trim` no `protocolOf`: o parser de URL já descarta espaços nas pontas; o `trim` fica pelo `withScheme`.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Porta `Clock`** (`now(): Date`) e `systemClock` em `@tecton/providers`. A fixture `createTestClock` satisfaz a porta (ASR-1).
- **`@tecton/auth`, estrutura hexagonal:**
  - `src/core`: `Credential`, `normalizeLogin` (NFKC, `trim`, minúsculas; acentos mantidos), `assertValidPermissions` (formato do manifest), porta `CredentialStore`, `bootstrapAdmin` e `BOOTSTRAP_ADMIN_PERMISSIONS` congelado;
  - `src/adapters/prisma`: `dialectOf`, `createPrismaCredentialStore` (`PrismaPg` ou `PrismaMariaDb` pela URL) e `applyAuthMigrations` (`prisma migrate deploy` em processo filho, sem a URL nos erros).
- **Prisma 7.10.0:**
  - um schema e um cliente gerado por dialeto (PostgreSQL; MySQL também para MariaDB), com `prisma-client` em ESM e imports `.js`;
  - geração no `pnpm build` (`generate` antes do `tsc -b`), com o cliente no `.gitignore`;
  - migrations iniciais versionadas;
  - `allowBuilds` para `prisma` e `@prisma/engines`.
- **`tecton-admin auth bootstrap --login <id>`:**
  - senha de `TECTON_AUTH_BOOTSTRAP_PASSWORD` ou do stdin (remove só uma quebra de linha final; terminal interativo é recusado);
  - nenhuma opção de senha;
  - erros claros sem segredos;
  - recusa quando já há credencial;
  - `CliIo` ganhou `stdin` e `env`.
- **`tecton.yaml` do Auth:** actions `login`, `refresh`, `logout` e `serviceToken`, com contratos provisórios, publicado e declarado em `tecton.manifests`. Um domínio com `dependencies: [auth]` resolve pelo pacote instalado.
- **README** do `@tecton/auth` em inglês.
- **Verificação:** suíte rápida com 472 testes; persistência 7/7 em cada um dos três bancos; `test:generation` 2/2; build, typecheck, `check:deps` (100 módulos), `lint:examples` e `validate:asyncapi`, todos verdes.
- **Para a 2.2b:** o `pnpm-workspace.yaml` do workspace gerado vai precisar de `allowBuilds` para `prisma` e `@prisma/engines` quando o `apps/auth` instalar o `@tecton/auth` pelo registro (com `link:` não é necessário).
- **Code review (2026-10-16):** 22 correções aplicadas, 4 adiados e 1 descartado.
  - Login: recusa caracteres invisíveis e de formatação; linha lida com status ou permissões inválidos falha fechada.
  - Bootstrap: atômico em transação serializável (`createIfEmpty`); senha do administrador com pelo menos 12 caracteres; saída 2 na recusa.
  - CLI: erro de banco numa linha sem URL; stdin com limite de 10 s; variável vazia é erro.
  - Migrations: ambiente mínimo para o filho; mascaramento da senha em todas as formas; timeout e sinal; sem `CREATE SCHEMA "public"`.
  - Banco: `?schema=` honrado em runtime; `P2002` só vira `LoginTakenError` quando o conflito é no login; esquema da URL tratado com espaço e maiúsculas; mensagem de dialeto sem eco.
  - Outros: `uuid` fixado em 14.0.3; ajuda e README com `TECTON_AUTH_PEPPER_ID` e os códigos de saída.
- **Desvio não registrado no desenvolvimento** (P21): o `@tecton/cli` também passou a depender de `@tecton/providers` (`pepperFromEnv`, Argon2id e `systemClock` no comando). O AD-3 permite.
- **Testes depois do review:** suíte rápida com 503; persistência com 13 por banco (12 rodam em cada; 1 é específico do dialeto), verde nos três.

### File List

- `package.json` (build com `generate`), `pnpm-workspace.yaml` (`allowBuilds`), `pnpm-lock.yaml`, `.gitignore` (cliente gerado), `.dependency-cruiser.cjs` (exclui o cliente gerado)
- `packages/providers/src/clock.ts`, `clock.test.ts` (novos); `packages/providers/src/index.ts` (modificado)
- `packages/auth/package.json`, `tsconfig.json`, `src/index.ts` (modificados); `README.md`, `tecton.yaml` (novos)
- `packages/auth/prisma/{postgresql,mysql}/{schema.prisma,prisma.config.ts,migrations/migration_lock.toml,migrations/0001_init/migration.sql}` (novos)
- `packages/auth/src/core/{credential,credential-store,bootstrap}.ts` e testes (novos)
- `packages/auth/src/adapters/prisma/{dialect,prisma-credential-store,migrations}.ts`, `dialect.test.ts`, `prisma-credential-store.persistence.test.ts` (novos)
- `packages/auth/src/{manifest,schema-parity}.test.ts` (novos)
- `packages/cli/package.json`, `tsconfig.json`, `src/{cli,io,bin}.ts` (modificados); `src/commands/auth-bootstrap.ts` e teste (novos)
- `tools/source-hygiene/scan.test.ts` (limite de tempo)
- `_bmad-output/planning-artifacts/epics.md` (divisão da 2.2), `_bmad-output/implementation-artifacts/sprint-status.yaml`, esta story

## Change Log

- 2026-10-15: Story criada (Create Story), primeira metade da 2.2 dividida.
- 2026-10-15: Validate Story e aprovações do Boss (dependências, `allowBuilds`, permissões do bootstrap).
- 2026-10-16: Story implementada (Dev Story); persistência verificada nos três bancos; status → review.
- 2026-10-16: Code review: 22 correções com fase vermelha por mutação, CI do `check:deps` corrigido; status → done.
