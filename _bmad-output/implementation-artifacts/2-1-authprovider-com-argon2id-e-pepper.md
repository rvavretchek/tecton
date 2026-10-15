---
baseline_commit: 4033cc43c13641d2c4d4e8d6fa212952d5c6e4d1
---

# Story 2.1: `AuthProvider` com Argon2id e Pepper

Status: review

## Story

Como **dev que precisa guardar senhas com segurança**,
quero um `AuthProvider` que gere e verifique hash de senha com Argon2id e Pepper,
para que nenhuma senha seja guardada de forma recuperável, mesmo se o banco vazar (FR-12).

## Acceptance Criteria

1. **Interface e adaptador.** Dado a interface `AuthProvider` em `@tecton/providers` e o adaptador de referência Argon2id, o adaptador usa o `crypto.argon2` nativo do Node. A escolha e o motivo ficam registrados no README do pacote: é estável na versão fixada (ver Dev Notes) e por isso não se usa `@node-rs/argon2`.
2. **Hash.** Dado uma senha, quando gero o hash:
   - a senha passa primeiro por HMAC-SHA256 com o Pepper como chave e depois por Argon2id;
   - os parâmetros mínimos são configuráveis (padrão: 19 MiB de memória, 2 iterações, paralelismo 1);
   - o resultado guardado está no formato PHC, com os parâmetros e o identificador da versão do Pepper usado.
3. **Verificação.** Dado uma senha correta e outra incorreta, quando verifico contra o hash guardado:
   - a correta retorna verdadeiro e a incorreta retorna falso;
   - a comparação é em tempo constante;
   - nenhuma exceção revela o motivo (hash malformado, de outro algoritmo ou com Pepper desconhecido também retorna falso).
4. **Rehash.** Dado um hash guardado com parâmetros mais fracos que a configuração atual, ou com uma versão de Pepper que não é a atual, quando a senha é verificada com sucesso, então o provider indica que o hash precisa ser refeito.
5. **Pepper obrigatório.** Dado um serviço que inicia sem Pepper configurado, ou com Pepper menor que 32 bytes, quando ele sobe, então a inicialização falha com mensagem clara, sem gerar nenhum hash e sem mostrar o valor recebido.
6. **Sem vazamento.** Dado qualquer log, erro ou registro persistido, quando o inspeciono, então o Pepper e a senha em texto puro nunca aparecem.
7. **AD-1.** Dado o núcleo de um serviço que usa o `AuthProvider`, quando verifico os imports, então ele depende só da interface, nunca da biblioteca de Argon2id diretamente.

> **Nota (epics.md):** a leitura do Pepper usa validação mínima própria. O `ConfigProvider` formal com fail-fast é do Epic 3 (Story 3.1, FR-22) e vai absorver essa leitura.

## Tasks / Subtasks

- [x] **T1. Interface `AuthProvider` (AC: 1, 7)**
  - [x] `packages/providers/src/auth/auth-provider.ts`: `interface AuthProvider { hashPassword(password: string): Promise<string>; verifyPassword(password: string, storedHash: string): Promise<PasswordVerification> }`, com `PasswordVerification = { valid: boolean; needsRehash: boolean }`. Sem nenhuma referência a Argon2 nesse arquivo.
  - [x] JSDoc em inglês explicando o contrato:
    - `hashPassword` devolve uma string PHC;
    - `verifyPassword` nunca lança por causa do conteúdo do hash e só indica `needsRehash` quando `valid` é verdadeiro.
  - [x] Exportar de `packages/providers/src/index.ts` e remover o placeholder `packageName`. Ninguém o importa; confirmado por grep.
- [x] **T2. Pepper (AC: 5, 6)**
  - [x] `packages/providers/src/auth/pepper.ts`:
    - tipo `Pepper = { id: string; key: Buffer }`;
    - `PepperConfigError extends Error`, com mensagem que nunca contém o valor;
    - `pepperFromEnv(env = process.env)`, que lê `TECTON_AUTH_PEPPER` e `TECTON_AUTH_PEPPER_ID` (padrão `"1"`).
  - [x] Validação:
    - Pepper ausente ou vazio → erro `"TECTON_AUTH_PEPPER is not set; ..."`;
    - menos de 32 bytes em UTF-8 → erro com o tamanho recebido em bytes, nunca o valor, e uma dica de como gerar um (`openssl rand -base64 48`);
    - id fora de `^[A-Za-z0-9_-]{1,8}$` → erro.
  - [x] Único lugar do pacote que lê `process.env`, marcado com comentário apontando para a Story 3.1, que vai substituí-lo.
- [x] **T3. Adaptador Argon2id (AC: 1–4, 6)**
  - [x] `packages/providers/src/auth/argon2id-auth-provider.ts`: `createArgon2idAuthProvider({ peppers, currentPepperId, params? }): AuthProvider`.
    - `peppers`: um ou mais `Pepper`, para permitir rotação.
    - `params`: `{ memoryKiB?, passes?, parallelism? }`.
  - [x] Na construção, validar:
    - `peppers` não vazio, ids únicos e cada chave com 32 bytes ou mais;
    - `currentPepperId` presente em `peppers`;
    - parâmetros não abaixo do piso OWASP (`memoryKiB` 19456, `passes` 2, `parallelism` 1). A configuração só pode **subir** esses valores.

    Qualquer violação lança `PepperConfigError` (Pepper) ou `RangeError` (parâmetros), antes de gerar hash.
  - [x] Hash:
    1. normalizar a senha com `password.normalize('NFKC')` (NIST SP 800-63B, ver Dev Notes);
    2. aplicar HMAC-SHA256 com a chave do Pepper atual (32 bytes);
    3. rodar `crypto.argon2('argon2id', { message: hmac, nonce: randomBytes(16), memory, passes, parallelism, tagLength: 32 })`, assíncrono, nunca `argon2Sync`, para não bloquear o event loop;
    4. montar a string PHC.
  - [x] Formato PHC: `$argon2id$v=19$m=<memoryKiB>,t=<passes>,p=<parallelism>,keyid=<B64(id)>$<B64(salt)>$<B64(hash)>`.
    - B64 é base64 padrão **sem** `=` (convenção PHC).
    - `keyid` é o parâmetro opcional do próprio PHC para Argon2 (no máximo 8 bytes), usado para guardar a versão do Pepper.
  - [x] Verificação:
    - fazer o parse estrito (regex ancorada) do PHC: algoritmo `argon2id`, `v=19`, `m`/`t`/`p` inteiros positivos, `keyid` decodificável para um id conhecido, salt e hash em B64 válidos;
    - B64 validado por regex (`^[A-Za-z0-9+/]+$`) e ida e volta da codificação, porque `Buffer.from(x, 'base64')` aceita lixo em silêncio;
    - **teto contra DoS:** um hash com `m` acima de `max(memoryKiB configurado, 1048576)` (1 GiB), `t` acima de `max(passes, 16)` ou `p` acima de `max(parallelism, 16)` é inválido sem rodar o Argon2id. Assim, um hash adulterado no banco não faz a verificação alocar memória sem limite;
    - qualquer falha → `{ valid: false, needsRehash: false }`, sem lançar;
    - recalcular com os parâmetros **do hash guardado** e o Pepper indicado pelo `keyid`;
    - comparar com `crypto.timingSafeEqual` (tamanhos diferentes → falso, sem chamar `timingSafeEqual`).
  - [x] `needsRehash` (só com `valid: true`) é verdadeiro quando:
    - `m`, `t` ou `p` do hash guardado é menor que o configurado;
    - ou o tamanho do hash é menor que 32;
    - ou o `keyid` não é o Pepper atual.
  - [x] As chaves dos Peppers ficam numa closure, nunca em propriedade do objeto devolvido: `util.inspect(provider)` e `JSON.stringify(provider)` não podem mostrá-las.
  - [x] Erro inesperado do `crypto.argon2` (ex.: memória insuficiente) em `hashPassword` é propagado sem a senha. Em `verifyPassword`, vira `{ valid: false, needsRehash: false }`.
- [x] **T4. Testes, com a fase vermelha de cada teste negativo registrada no Debug Log (retro do Epic 1, A3) (AC: todos)**
  - [x] `packages/providers/src/auth/argon2id-auth-provider.test.ts`:
    - hash e verificação de ida e volta;
    - senha errada → falso;
    - formato PHC exato (regex) com `m=19456,t=2,p=1,keyid=...`;
    - salt diferente a cada hash;
    - HMAC antes do Argon2id: um hash feito com outro Pepper e a mesma senha não verifica, e o hash é igual ao calculado à mão com `createHmac` e `argon2` na mesma ordem, usando o salt e os parâmetros extraídos do PHC gerado (ver Dev Notes);
    - NFKC: `"ﬁ"` (U+FB01) e `"fi"` verificam igual;
    - `needsRehash` para `m`, `t` e `p` menores (hash gerado com parâmetros mais altos no provider antigo e verificado num provider configurado mais alto) e para Pepper antigo após rotação;
    - hash com Pepper antigo continua válido depois da rotação;
    - hash malformado, truncado, `argon2i`, `v=16`, `keyid` desconhecido, B64 inválido, `m` acima do teto (sem demorar: o Argon2id não pode rodar) e string vazia → `{ valid: false }` sem lançar;
    - parâmetros abaixo do piso → `RangeError`.
  - [x] `packages/providers/src/auth/pepper.test.ts`:
    - ausente, vazio, 31 bytes (incluindo multibyte: 16 caracteres de 2 bytes = 32 bytes **passa**) → erro;
    - a mensagem não contém o valor (`assertNoSecretsLeaked` de `#test-support`);
    - id inválido → erro;
    - id padrão `"1"`.
  - [x] Sem vazamento (AC 6): `assertNoSecretsLeaked` sobre:
    - a string PHC;
    - `util.inspect(provider)` e `JSON.stringify(provider)`;
    - as mensagens dos erros de configuração;
    - o resultado de `verifyPassword`.

    Com Pepper e senha como segredos.
  - [x] AD-1 (AC 7), teste estrutural `packages/providers/src/auth/argon2-boundary.test.ts`, no mesmo estilo do `single-serializer.test.ts` do core:
    - em `packages/*/src` (fora de testes), só `argon2id-auth-provider.ts` pode mencionar `argon2(` ou `argon2Sync(` ou importar `@node-rs/argon2`/`argon2`;
    - ignorar pacote sem `src`.
- [x] **T5. README do `@tecton/providers` (AC: 1)**
  - [x] `packages/providers/README.md` em inglês (superfície de dev), com:
    - a porta `AuthProvider`;
    - o adaptador `createArgon2idAuthProvider`;
    - as variáveis `TECTON_AUTH_PEPPER` e `TECTON_AUTH_PEPPER_ID`;
    - como gerar um Pepper;
    - a rotação (lista de Peppers + `currentPepperId`, rehash no login);
    - o formato PHC com `keyid`;
    - a normalização NFKC;
    - os parâmetros e o piso.
  - [x] Seção "Why native `crypto.argon2`", com o motivo da escolha (ver Dev Notes).
- [x] **T6. Verificação final**
  - [x] `pnpm build`, `pnpm typecheck`, `pnpm check:deps`, `pnpm lint:examples`, `pnpm validate:asyncapi` e `pnpm test`, todos verdes (inclui o teste de higiene de fonte da A2).
  - [ ] Code review desta story antes da 2.2 (retro do Epic 1, A1).

## Dev Notes

### Decisões desta story

- **`crypto.argon2` nativo.** Disponível desde o Node 24.7.0 (`engines` do projeto: `>=24.7 <25`). Verificado em 2026-10-15 na documentação da v24.20.0 (`doc/api/crypto.md`): `crypto.argon2` e `argon2Sync` não têm marcador `Stability: 1 - Experimental`, então valem a estabilidade do módulo `crypto` (Stable). Uma chamada real no Node 24.20.0 não emitiu `ExperimentalWarning`, e um hash com `m=19456,t=2,p=1` levou cerca de 50 ms. O `@node-rs/argon2` (2.2.2) seria um addon nativo, a ser liberado em `allowBuilds` do pnpm; o nativo evita isso.
- **Formato e parâmetros do `crypto.argon2`:**
  - `memory` é em blocos de 1 KiB (19 MiB = 19456);
  - `nonce` é o salt (mínimo 8 bytes; usar 16);
  - `tagLength` mínimo 4 (usar 32);
  - `secret` existe, mas **não** é usado: o AC exige HMAC-SHA256 com o Pepper antes do Argon2id, o que mantém o Pepper como camada independente do algoritmo de hash.
- **`keyid` no PHC.** O formato PHC define `keyid` (opcional, no máximo 8 bytes em B64) para Argon2. Ele carrega a versão do Pepper sem inventar um parâmetro próprio. Por isso o id do Pepper é limitado a 8 caracteres `[A-Za-z0-9_-]`.
- **NFKC.** O NIST SP 800-63B recomenda normalizar senhas Unicode (NFKC ou NFKD) antes do hash, para que a mesma senha digitada em teclados diferentes verifique igual. Precisa ser decidido agora: mudar depois invalidaria os hashes existentes.
- **Piso de parâmetros.** O padrão do AC é também o mínimo aceito (OWASP Password Storage: Argon2id com m=19 MiB, t=2, p=1). Configuração pode subir, nunca descer. Testes usam o piso (cerca de 50 ms por hash); não criar um "modo de teste" mais fraco.
- **Prova da ordem HMAC → Argon2id sem mudar a API.** O teste extrai salt e parâmetros do PHC gerado e recalcula à mão (`createHmac('sha256', pepper)` sobre a senha NFKC, depois `argon2('argon2id', ...)`), comparando com o hash do PHC. Não acrescentar gerador de salt injetável na fábrica.
- **Política de senha fora do provider.** O provider aceita qualquer string, inclusive vazia. Tamanho mínimo e máximo são do serviço de Auth (2.2). O HMAC deixa o custo independente do tamanho da senha.
- **Interface mínima.** O `AuthProvider` desta story cobre só senha. A Spine prevê Keycloak/OIDC como adaptador opcional atrás do `AuthProvider` (seção "Opcionais", registrado em 2026-10-07); quando isso entrar, a interface cresce. Não antecipar métodos de identidade agora.

### Como as próximas stories usam isto

- **2.2 (serviço `@tecton/auth`):** chama `hashPassword` ao criar credencial e `verifyPassword` no login; refaz o hash quando `needsRehash`. Para o "tempo de resposta equivalente" com login inexistente (EQ-7), a 2.2 verifica contra um hash fixo de mentira. Nada a fazer aqui além de garantir que `verifyPassword` com hash válido e senha errada custa o mesmo que com senha certa (mesmo Argon2id).
- **3.1 (`ConfigProvider`):** substitui `pepperFromEnv` e remove a validação mínima própria. Manter essa função pequena e isolada.

### Arquivos

| Arquivo | Situação |
|---|---|
| `packages/providers/src/index.ts` | UPDATE: hoje só exporta o placeholder `packageName`, que ninguém importa; passa a exportar a porta, a fábrica, `pepperFromEnv`, `PepperConfigError` e os tipos |
| `packages/providers/src/auth/auth-provider.ts` | NEW |
| `packages/providers/src/auth/pepper.ts` | NEW |
| `packages/providers/src/auth/argon2id-auth-provider.ts` | NEW |
| `packages/providers/src/auth/*.test.ts` | NEW |
| `packages/providers/README.md` | NEW (inglês) |
| `packages/providers/package.json` | sem dependência nova; `node:crypto` é built-in |

- `@tecton/providers` só pode depender de `@tecton/manifest` (AD-3). Esta story não precisa de nenhum pacote `@tecton`.
- O Vitest resolve `@tecton/*` para o `src`, e `#test-support` para `tests/support/index.ts` (em produção, o `check:deps` proíbe isso).

### Padrões do Epic 1 a seguir

- Código, mensagens de erro e README em inglês; este arquivo em PT-BR.
- Editar TypeScript só pelo editor, nunca por script com escapes. Nunca escreva `\uXXXX` em arquivo novo: a ferramenta Write converteu esse escape no caractere literal. Para caracteres especiais em teste, use `String.fromCodePoint(...)`. O teste de higiene de fonte (A2) pega o BOM, mas não pega um `ﬁ` literal, que é legítimo.
- Desvio de AC ou de task vai para o Dev Agent Record no momento em que acontece.
- O detector de segredos de `#test-support` exige segredos de 6 caracteres ou mais e checa as formas literal, JSON, URL e base64.

### Testes

- Vitest (`*.test.ts`), sem Docker. Esta story não precisa de container.
- Para testes com Docker em outras stories: túnel SSH para o Docker remoto (receita em `.env.example`).
- **Fase vermelha obrigatória (A3)** para cada teste negativo: senha errada, hash malformado, Pepper curto, parâmetro abaixo do piso, vazamento e a fronteira AD-1. Registre no Debug Log como cada um foi visto falhando: rode antes da implementação, ou quebre a implementação de propósito e volte.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1]
- [Source: _bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md#FR-12]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#AD-1, AD-3, AD-7]
- [Source: _bmad-output/test-artifacts/test-design-qa.md#P0-005] (HMAC antes do hash, PHC, rehash, Pepper ausente/curto)
- [Source: _bmad-output/test-artifacts/test-design-architecture.md] (Pepper ≥ 32 bytes nunca em log/span/erro)
- [Source: _bmad-output/implementation-artifacts/epic-1-retro-2026-10-15.md] (A1, A3)
- [Source: Node.js v24.20.0 doc/api/crypto.md, `crypto.argon2`]
- [Source: PHC string format, seção Argon2 (`keyid`)]
- [Source: NIST SP 800-63B §5.1.1.2 (normalização Unicode); OWASP Password Storage Cheat Sheet (Argon2id m=19 MiB, t=2, p=1)]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Fase vermelha inicial: `pepper.test.ts` e `argon2id-auth-provider.test.ts` falharam por módulos inexistentes. O `argon2-boundary.test.ts` passou sem nada a verificar (ainda não havia Argon2 no código) e por isso entrou na verificação por mutação abaixo.
- Fase vermelha dos testes negativos (retro do Epic 1, A3), por mutação da implementação já verde, uma de cada vez, sempre restaurada (34/34 verde depois de cada uma):

  | # | Mutação | Testes que falharam |
  |---|---|---|
  | 1 | comparação removida (senha errada aceita) | 3 |
  | 2 | hash malformado lança em vez de devolver falso | 1 |
  | 3 | teto de parâmetros desligado | 1 |
  | 4 | sem HMAC antes do Argon2id | 2 |
  | 5 | Pepper exposto como propriedade do provider | 1 (vazamento) |
  | 6 | rotação de Pepper sem `needsRehash` | 1 |
  | 7 | Pepper curto aceito (`MIN_PEPPER_BYTES = 0`) | 3 |
  | 8 | piso de parâmetros não aplicado | 3 |
  | 9 | chamada `argon2(` plantada fora do adaptador | 1 (fronteira AD-1) |
  | 10 | valor do Pepper na mensagem de erro | 2 (vazamento) |
  | 11 | sem normalização NFKC | 1 |

- O teste do teto usava `m=4294967295`, valor que o `crypto.argon2` provavelmente recusaria sozinho e na hora, deixando o teste verde mesmo sem o teto. Trocado por `m=1100000`, logo acima de 1 GiB, que o Argon2id aceitaria. A mutação 3 confirmou que o teste agora depende do teto.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **Porta e retorno:** `AuthProvider` em `@tecton/providers`, com `hashPassword(password)` → string PHC e `verifyPassword(password, storedHash)` → `{ valid, needsRehash }`.
- **Adaptador `createArgon2idAuthProvider({ peppers, currentPepperId, params? })`:**
  - senha normalizada em NFKC, depois HMAC-SHA256 com o Pepper, depois `crypto.argon2` nativo e assíncrono (salt de 16 bytes, tag de 32);
  - PHC `$argon2id$v=19$m=…,t=…,p=…,keyid=<B64(id)>$salt$hash`;
  - piso OWASP (m=19456, t=2, p=1) como padrão e mínimo;
  - verificação com parse estrito (B64 com ida e volta), teto contra DoS (1 GiB, 16 passes, 16 lanes, ou o configurado se maior) e `timingSafeEqual`;
  - `needsRehash` para parâmetros menores, tag menor ou Pepper que não é o atual;
  - chaves só na closure.
- **Pepper:** `pepperFromEnv` (`TECTON_AUTH_PEPPER` com 32 bytes ou mais, `TECTON_AUTH_PEPPER_ID`, padrão `1`) e `PepperConfigError`, sem o valor na mensagem. É o único ponto do pacote que lê o ambiente, até a Story 3.1.
- **AD-1:** teste estrutural garante que só o adaptador chama Argon2.
- **README do pacote** em inglês, com a decisão pelo `crypto.argon2` nativo: estável na 24.20.0, sem marcador experimental nem `ExperimentalWarning`, e sem addon nativo para liberar no pnpm.
- **Testes:** 34 novos (8 de Pepper, 25 do adaptador, 1 de fronteira). Suíte rápida com 393 verdes; build, typecheck, `check:deps` (80 módulos), `lint:examples` e `validate:asyncapi` verdes.
- **Pendente nesta story:** o subitem "Code review desta story antes da 2.2" fica desmarcado de propósito. É o próximo passo (retro A1), não algo feito no desenvolvimento.

### File List

- `packages/providers/src/index.ts` (modificado: exporta a porta, o adaptador e o Pepper; placeholder removido)
- `packages/providers/src/auth/auth-provider.ts` (novo)
- `packages/providers/src/auth/pepper.ts` (novo)
- `packages/providers/src/auth/argon2id-auth-provider.ts` (novo)
- `packages/providers/src/auth/pepper.test.ts` (novo)
- `packages/providers/src/auth/argon2id-auth-provider.test.ts` (novo)
- `packages/providers/src/auth/argon2-boundary.test.ts` (novo)
- `packages/providers/README.md` (novo)
- `_bmad-output/implementation-artifacts/2-1-authprovider-com-argon2id-e-pepper.md` (esta story)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status)

## Change Log

- 2026-10-15: Story criada (Create Story).
- 2026-10-15: Validate Story: teto de parâmetros contra DoS na verificação, validação estrita de B64, política de senha fora do provider, prova da ordem HMAC → Argon2id sem salt injetável.
- 2026-10-15: Story implementada (Dev Story): `AuthProvider`, adaptador Argon2id nativo com Pepper e PHC, testes com fase vermelha por mutação; status → review.
