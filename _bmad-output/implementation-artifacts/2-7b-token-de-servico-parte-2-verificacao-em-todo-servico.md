---
baseline_commit: 4b32205fc81fedc7322bb4403bab487ec789df98
---

# Story 2.7b: Token de serviço, parte 2: verificação em todo serviço

Status: review

## Story

Como **dev de um domínio que chama outro domínio**,
quero que todo serviço aceite o token de serviço do chamador, sozinho ou junto com o token do usuário em nome de quem chama,
para que quem recebe saiba qual serviço está chamando e em nome de qual usuário, verificando os dois por conta própria (FR-13, D3).

> Segunda metade da Story 2.7, dividida no Create Story de 2026-10-23 (decisão do Boss; nota no `epics.md`). A 2.7a entregou a credencial de serviço, o `register-service` e o `POST /auth/service-token`. Esta story faz cada serviço de domínio aceitar e conferir esses tokens.
>
> **Emenda do AD-7 (Validate Story, 2026-10-24, decisão do Boss):** toda chamada a um domínio leva token de serviço. O domínio recusa o token de usuário sozinho em `Authorization`, salvo com `TECTON_ENV=development`; o Gateway (Story 3.6) passa a ser um serviço que põe o token do usuário em `Tecton-On-Behalf-Of`; o Auth continua recebendo o token de usuário direto. Ver o AD-7 na Spine e a nota no `epics.md`.

## Critérios de Aceite

1. **Token de serviço aceito.** Dado um token de serviço válido (`typ: service`, `sub: service:<domínio>`, mesmas regras de assinatura, `kid`, `iss`, `aud`, `exp`, `iat`, `perms` e revogação da Story 2.4 e 2.5), quando ele chega em `Authorization: Bearer` numa action protegida, então o serviço o verifica localmente pelo JWKS e o aceita como chamada de serviço.
2. **`call:<próprio domínio>` exigido.** Dado uma chamada com token de serviço, com ou sem `Tecton-On-Behalf-Of`, quando ela chega, então o serviço chamado exige `call:<domínio do manifest dele>` no token de serviço, além das permissões de `auth.requires`. Sem ele, a resposta é 403, mesmo com um token de usuário válido em `Tecton-On-Behalf-Of` (um serviço que não declarou o domínio chamado em `dependencies`).
3. **Em nome de um usuário.** Dado uma chamada com o token de serviço em `Authorization` e o token do usuário em `Tecton-On-Behalf-Of`, quando ela chega, então os dois tokens são verificados de forma independente, com as mesmas regras da Story 2.4 (e a revogação da 2.5), e `auth.requires` é avaliado contra as permissões do usuário, nunca contra as do serviço.
4. **Sem usuário.** Dado uma chamada só com o token de serviço (job, consumo de evento), quando ela chega, então `auth.requires` é avaliado contra as permissões do serviço.
5. **Um dos dois inválido.** Dado um token de serviço e um token de usuário em `Tecton-On-Behalf-Of` em que um dos dois é inválido, forjado, expirado ou revogado, quando a chamada chega, então ela é rejeitada com 401. Um token de serviço em `Tecton-On-Behalf-Of` também é 401 (o usuário em nome de quem se age é sempre um usuário). Se a verificação de qualquer um dos dois estiver indisponível (JWKS ou revogação), a resposta é 503, como na 2.4. O 401 é um só, com o mesmo corpo e `WWW-Authenticate: Bearer`, qualquer que seja o token que falhou: quem chama não descobre qual dos dois foi recusado.
6. **O handler sabe quem é quem.** Dado uma chamada aceita, quando o handler roda, então `context.principal` é de quem as permissões foram avaliadas (o usuário em nome de quem se age, ou o serviço sem usuário), com um campo que diz se é usuário ou serviço, e `context.service` é o serviço chamador sempre que a chamada veio com token de serviço. Os dois são cópias novas por requisição, como na 2.4; sem usuário, `principal` e `service` são o mesmo serviço, em cópias distintas. Como `principal` agora pode ser um serviço, o handler que precisa de um usuário confere `principal.kind`.
7. **Token de usuário sozinho só em desenvolvimento (emenda do AD-7).** Dado um token de usuário válido sozinho em `Authorization`, quando a chamada chega a um domínio fora de `TECTON_ENV=development`, então a resposta é 401, o mesmo 401 de qualquer token recusado. Com `TECTON_ENV=development`, a chamada segue como na 2.4 (`call:` não é exigido; `Tecton-On-Behalf-Of` é ignorado, identidade só pelo token verificado), e o serviço avisa no log ao subir que aceita token de usuário sem token de serviço.
8. **O Auth continua só com usuário.** Dado um token de serviço, quando ele é apresentado à action protegida do Auth (`registerService`), então é recusado com 401, como na 2.7a: registrar serviço é ato de administrador. E o Auth aceita o token de usuário direto em qualquer ambiente (exceção permanente do AD-7: o CLI chama o Auth sem Gateway).
9. **Sem segredos nos logs.** Nenhum token (nem o do serviço, nem o do usuário) aparece em log ou corpo de erro.

> **Risco aceito (auditoria de segurança de 2026-10-06, com a emenda de 2026-10-24):** um serviço comprometido pode reaproveitar, até expirarem (15 minutos), tokens de usuário que recebeu. É inerente à propagação de token. Com a emenda, esse token só é aceito por um domínio junto do token de serviço de quem chama, e o domínio exige `call:<próprio domínio>` desse serviço: o serviço comprometido só alcança os domínios que declarou em `dependencies`. Registrar no README do `@tecton/core` e corrigir a redação no do `@tecton/auth`.

## Tasks / Subtasks

- [x] **T1. Verificador (AC: 1, 3, 5)** — `packages/core/src/auth/token-verifier.ts`
  - [x] `Principal` ganha `kind: 'user' | 'service'` (obrigatório). Token de serviço: `sub` é `service:` seguido de um nome no `DOMAIN_NAME_PATTERN` do `@tecton/manifest` (`packages/manifest/src/schema.ts`), até `DOMAIN_NAME_MAX_LENGTH`, nunca `service:auth` (a 2.7a não registra o Auth). Token de usuário: `sub` nunca começa com `service:`. Qualquer outro `typ` é 401.
  - [x] O resto das regras é o mesmo para os dois tipos (assinatura, `kid`, `at+jwt`, `iss`, `aud`, `exp`, `iat` não futuro, `perms` lista de texto, revogação por `jti` e por sujeito). A revogação por sujeito `service:<domínio>` é a da rotação da 2.7a.
  - [x] **A interface `TokenVerifier` não muda** (`verify(authorization)` só): as rotas conferem o valor cru de `Tecton-On-Behalf-Of` contra `^[A-Za-z0-9_.-]+$` e `MAX_TOKEN_LENGTH` e chamam `verifier.verify('Bearer ' + valor)`. Assim, nenhum verificador de terceiros ou de teste ganha método novo; só o `kind` do `Principal` muda.
  - [x] `tests/support/tokens.ts`: o item `'service token'` de `forged()` continua forjado (tem `typ: service` com `sub` de usuário) e é renomeado para `'service typ with a user subject'`; entra `'user typ with a service subject'` (`valid({ sub: 'service:billing' })`). O factory ganha um atalho separado para token de serviço válido (`typ: service`, `sub: service:<domínio>`).
- [x] **T2. Rotas (AC: 2 a 7)** — `packages/core/src/routes.ts`
  - [x] No `onRequest` de action protegida, **em sequência, a primeira falha vence** (nunca `Promise.all`):
    1. verifica `Authorization` (401 ou 503);
    2. se `kind === 'user'`: 401, a menos que a opção `directUserCalls` esteja ligada; ligada, segue como na 2.4, sem olhar `Tecton-On-Behalf-Of` (o verificador nem é chamado de novo);
    3. se `kind === 'service'` e o cabeçalho `tecton-on-behalf-of` existe: verifica o valor (401 ou 503); um token de serviço ali é 401;
    4. exige `call:<manifest.domain>` no token de serviço (403);
    5. avalia `auth.requires` contra o usuário, se houver, ou contra o serviço (403).
    Qualquer outro `kind` (verificador escrito à mão sem `kind`) é 401: nunca tratado como usuário por omissão.
  - [x] "Ausente" é só `undefined`: valor vazio, só espaços, repetido (o Node junta com `, `), com `Bearer` ou longo demais é 401.
  - [x] Opção `directUserCalls?: boolean` em `ActionRoutesOptions` (padrão `false`): aceitar token de usuário sozinho em `Authorization`. Só duas fontes a ligam: o `startDomainServer` quando `TECTON_ENV=development` (com um `warn` ao subir, `event: "direct_user_calls_enabled"`) e o serviço de Auth, sempre. `DomainServerOptions` aceita a opção explícita, que vence o ambiente.
  - [x] `ActionContext`: `principal` (de quem as permissões foram avaliadas) e `service?: Principal` (o chamador, quando é serviço). Cópias por requisição, incluindo as datas.
  - [x] Log `warn` de 403 por falta de `call:` com o serviço chamador e o domínio chamado (sem token), para o operador achar um `dependencies` esquecido.
  - [x] Descrições de 401 e 403 do `routeSchema` inalteradas (o documento OpenAPI gerado não muda).
- [x] **T3. Auth (AC: 8)** — `packages/auth/src/adapters/jose/own-access-token.ts` e `packages/auth/src/service.ts`
  - [x] `createOwnTokenVerifier` devolve `kind: 'user'`; continua recusando token de serviço.
  - [x] O `registerActionRoutes` do Auth liga `directUserCalls: true` (exceção permanente do AD-7).
- [x] **T4. Documentação e registros (AC: 6, 9)**
  - [x] README do `@tecton/core`: token de serviço, `Tecton-On-Behalf-Of` (JWT cru, sem `Bearer`; ignorado com token de usuário), `call:<domínio>`, a ordem das respostas, `context.principal` (com `kind`) e `context.service`, e o risco aceito na redação decidida pelo Boss (pergunta 1).
  - [x] README do `@tecton/auth`: a frase "the callee checks it (Story 2.7b)" e o risco aceito, na mesma redação.
  - [x] Comentário do `main.ts` do template de domínio: o token de serviço, `Tecton-On-Behalf-Of` e a exceção de `TECTON_ENV=development`.
  - [x] Registrar o formato de `Tecton-On-Behalf-Of` (JWT cru, sem `Bearer`) para a Story 3.9 (`ServiceClient`) no `epics.md` (feito no Validate Story, com a emenda das Stories 2.7 e 3.6). Ainda no `deferred-work.md`: o cabeçalho no OpenAPI (Epic 5, FR-24) e, para a Story 3.10, que o verificador recuse access token assinado por chave de evento de serviço (as chaves de evento vão para o mesmo JWKS, AD-7).
- [x] **T5. Testes (AC: todos)** — Test Design P0-019 (4), P0-020 (2)
  - [x] Verificador: token de serviço aceito com `kind: 'service'`; `sub` de serviço fora do padrão, token de usuário com `sub: service:...` e `typ` desconhecido recusados; token de serviço revogado por sujeito (rotação) recusado; `verifyToken` com valor repetido, longo demais ou com `Bearer` recusado.
  - [x] Rotas (`app.inject`, `tokenFactory`, revogação em memória):
    - serviço sem usuário: `requires` contra o serviço (200 com a permissão, 403 sem);
    - em nome de usuário: `requires` contra o usuário (200 quando o usuário tem e o serviço não; 403 quando o serviço tem e o usuário não);
    - `call:` ausente: 403 com usuário válido, e também sem usuário;
    - token de serviço forjado, expirado ou revogado: 401; token de usuário em `Tecton-On-Behalf-Of` forjado, expirado ou revogado: 401; token de serviço em `Tecton-On-Behalf-Of`: 401;
    - 401 antes de 403 (serviço sem `call:` e usuário inválido: 401);
    - JWKS ou revogação indisponível na verificação do token de usuário: 503;
    - chamada de usuário com `Tecton-On-Behalf-Of` de outro usuário: o principal é o do `Authorization` (P0-013 continua);
    - `context.principal` e `context.service` corretos e copiados por requisição;
    - nenhum dos dois tokens em log ou corpo de erro;
    - todas as falsificações de `forged()` contra `Tecton-On-Behalf-Of`, além de `Authorization`;
    - serviço inválido com o JWKS indisponível para o segundo token: 401 (a primeira falha vence);
    - `Tecton-On-Behalf-Of` vazio, só espaços, repetido, com `Bearer` e longo demais: 401;
    - o 401 é idêntico (corpo e cabeçalhos) para cada token que falha;
    - o verificador é chamado uma vez só em chamada de usuário e nenhuma em action pública;
    - token de usuário sozinho: 401 sem `directUserCalls`; com a opção, o comportamento da 2.4;
    - `startDomainServer`: `TECTON_ENV=development` liga a opção e avisa no log; sem ele, desligada; a opção explícita vence o ambiente.
  - [x] Testes existentes que chamam um domínio com token de usuário sozinho (`routes-auth.test.ts`, `routes.test.ts`, `domain-server.test.ts`, `revocation` e outros das 2.4 e 2.5) passam a ligar `directUserCalls: true` ou o `TECTON_ENV=development` (provam o comportamento da 2.4, agora só de desenvolvimento). O `new.generation.test.ts` já usa `TECTON_ENV=development` no `.env`.
  - [x] Ponta a ponta em `packages/auth/src/` (o `core` não pode importar o `auth`, `.dependency-cruiser.cjs`), no modelo do `packages/cli/src/commands/auth-register-service.test.ts`: o Auth em processo (`createAuthService` escutando numa porta), o registro de serviço e o `service-token`, e um domínio com `startDomainServer({ verifier: createTokenVerifier({ jwksUrl: <url http do Auth>, devMode: true, revocations: <o mesmo store em memória dado ao Auth> }) })`. Chamado com o token de serviço sozinho e com `Tecton-On-Behalf-Of` de um usuário que fez login; depois da rotação, o token antigo do serviço é 401 no domínio (só observável porque o store de revogação é o mesmo).
  - [x] Fase vermelha por mutação (A3), no mínimo: aceitar qualquer `typ`; não exigir `call:`; exigir `call:` de token de usuário (quebra o AC 7); `requires` contra o serviço quando há usuário; não verificar `Tecton-On-Behalf-Of`; verificá-lo sem revogação; aceitar token de serviço em `Tecton-On-Behalf-Of`; honrar `Tecton-On-Behalf-Of` com token de usuário (quebra o P0-013); 403 antes de 401; as duas verificações em paralelo ou na ordem errada; `call:` de outro domínio aceito; `sub` de serviço sem prefixo aceito; `kind` ausente tratado como usuário; token de usuário sozinho aceito sem `directUserCalls`; `TECTON_ENV=development` sem o aviso no log; o Auth sem `directUserCalls`.
- [x] **T6. Verificação final**
  - [x] `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:generation`, `test:containers` e `test:persistence` (no CI se o ubt-host02 não responder).
  - [ ] Code review por story antes da 2.8 (retro A1).

## Dev Notes

### Decisões desta story

- **Formato de `Tecton-On-Behalf-Of`: o JWT cru do usuário, sem `Bearer`.** É um cabeçalho do Tecton, não um esquema de autenticação HTTP; o `ServiceClient` (Story 3.9) tira o prefixo do `Authorization` que recebeu. Cabeçalho repetido é 401.
- **Emenda do AD-7 (Boss, 2026-10-24): token de usuário sozinho em `Authorization` é 401 nos domínios**, salvo com `TECTON_ENV=development` (Boss: "Sim, só em dev"). O Gateway vira serviço na 3.6. O Auth aceita o token de usuário direto sempre.
- **Em desenvolvimento, token de usuário com `Tecton-On-Behalf-Of` é ignorado, não recusado.** Preserva o P0-013 da 2.4 (identidade só pelo token verificado). Só um serviço age em nome de alguém.
- **`call:` vem antes de `requires`, mas depois das duas verificações, em sequência:** um token inválido sempre dá 401, nunca 403, e a primeira falha vence (resultado determinístico).
- **Interface `TokenVerifier` inalterada (validação da story):** o segundo token passa pelo mesmo `verify` como `Bearer <valor>`, depois de as rotas conferirem o formato cru. Evita mudar todo verificador escrito à mão.
- **Actions públicas continuam públicas:** nenhum token é verificado nelas, nem `call:` exigido (é a regra da 2.4; uma action pública é chamável por qualquer um).
- **O Auth não aceita token de serviço** na sua action protegida (`registerService` é de administrador). Nenhuma outra action do Auth é protegida.
- **Sem dependência nova:** jose 6.2.12 e o padrão de domínio do `@tecton/manifest` (já dependência do core).
- **Fora do escopo:** anexar os tokens automaticamente no `ServiceClient` e nos eventos (Epic 3, FR-21, FR-26); `Tecton-On-Behalf-Of` no OpenAPI (Epic 5).

### Código existente que esta story toca

| Arquivo | Hoje | Muda | Preservar |
|---|---|---|---|
| `packages/core/src/auth/token-verifier.ts` | só `typ: user` (`typ !== 'user'` é 401); `Principal` sem tipo; `verify(authorization)`; o `tokenVerifierFromEnv` devolve um objeto novo só com `verify`, `close` e `ready` | aceita `typ: service` com `sub: service:<domínio>`; `kind` | cache do JWKS, cooldown, backoff, CA, limites, 503 distinto de 401, revogação obrigatória, a interface `TokenVerifier` |
| `packages/core/src/routes.ts` | `onRequest` verifica `Authorization` e avalia `requires`; `principal` copiado | serviço, `Tecton-On-Behalf-Of`, `call:`, `context.service`, opção `directUserCalls` | `onRequest` antes do corpo; 401 antes de 400; 501 sem handler; recusa de action protegida sem verificador ou sem `requires` |
| `packages/core/src/openapi.ts` | verificador falso que recusa tudo | nada (a interface não muda) | documento gerado igual |
| `packages/core/src/domain-server.ts` | monta o verificador pelo ambiente | `directUserCalls` por `TECTON_ENV=development` (com aviso) ou pela opção | espera do Valkey, fechamento do verificador próprio |
| `packages/auth/src/service.ts` | `registerActionRoutes` com o verificador próprio | `directUserCalls: true` | o resto |
| `packages/cli/templates/domain/src/main.ts` | comentário sobre token de usuário | token de serviço e exceção de dev | o código |
| `packages/auth/src/adapters/jose/own-access-token.ts` | `createOwnTokenVerifier` só com usuário | `kind: 'user'`, interface nova | recusa de token de serviço; revogação; uso do leitor no logout |
| `tests/support/tokens.ts` | `forged()` inclui `'service token'` (`typ: service` com `sub` de usuário) | renomeado, continua em `forged()`; nova falsificação `'user typ with a service subject'`; atalho para token de serviço válido | as outras falsificações (usadas pela 2.4) |
| Testes com verificador ou `Principal` escritos à mão: `packages/core/src/routes.test.ts` (`ACCEPT_ALL`), `domain-server.test.ts`, `routes-auth.test.ts` (stubs `{ verify }` e o objeto `shared`), `auth/token-verifier.test.ts` (`toEqual` do principal exato) | sem `kind` | `kind: 'user'` onde o tipo pede; o `toEqual` passa a incluir `kind` | o que cada teste prova |
| `packages/core/src/index.ts` | exporta `Principal` | exporta qualquer tipo novo (ex.: o tipo de `kind`) | o resto da API |
| `packages/auth/README.md` | "the callee checks it (Story 2.7b)"; risco aceito | comportamento entregue; redação do risco decidida | o resto |
| `packages/core/README.md` | verificação só de usuário | serviço, `Tecton-On-Behalf-Of`, `call:` | o resto |

### Padrões a seguir (Stories 2.1 a 2.7a)

- Código, mensagens, logs e README em inglês; nunca `\uXXXX`. Scripts Python longos vão para arquivo no scratchpad (heredoc longo falha); barra invertida em string Python vira caractere de controle (usar a ferramenta de edição).
- Erro único por classe de motivo; tokens nunca em mensagem nem log; datas da `Clock`.
- O verificador sempre exige revogação; 503 com `Retry-After: 5` para indisponibilidade.
- Instantes: o `iat` tem precisão de segundo e a revogação de milissegundo (lição da 2.7a, P1). A revogação por sujeito da rotação já está datada para nunca pegar os tokens do segredo novo.
- Docker remoto: sem o túnel, containers e persistência no CI.

### Inteligência da story anterior (2.7a)

- O Auth emite o token de serviço com `typ: service`, `sub: service:<domínio>`, `perms` = dadas pelo administrador mais `call:<dep>`, cabeçalho `at+jwt`, mesma chave, `iss` e `aud`, 5 minutos; o `iat` pode estar 1 a 2 s à frente do relógio logo depois de uma rotação (dentro da tolerância de 30 s).
- A rotação revoga o sujeito `service:<domínio>` antes de trocar o segredo; o verificador do domínio precisa só da revogação por sujeito que já existe.
- O verificador próprio do Auth (`createOwnTokenVerifier`) é a referência de leitura de `iat`, `perms` e revogação.
- O teste do CLI contra um Auth real em processo (`auth-register-service.test.ts`) é o modelo para o ponta a ponta.

### Perguntas ao Boss (antes do desenvolvimento)

1. **Risco aceito e o alcance do `call:` (achado da validação):** **emenda do AD-7, "Gateway como serviço"** (2026-10-24). Domínios recusam o token de usuário sozinho; o Gateway da 3.6 põe o do usuário em `Tecton-On-Behalf-Of`.
2. **Exceção de desenvolvimento:** **sim, só com `TECTON_ENV=development`** (2026-10-24), com aviso no log ao subir.

Formato de `Tecton-On-Behalf-Of` (JWT cru, sem `Bearer`): decidido sem pergunta e registrado na Story 3.9 do `epics.md`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.7] (critérios originais e a nota de divisão)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#AD-7] (token de serviço, dois tokens verificados de forma independente, `call:<domínio>` exigido pelo chamado; emenda de 2026-10-24: toda chamada a um domínio com token de serviço, Gateway como serviço, exceção de desenvolvimento e do Auth)
- [Source: _bmad-output/test-artifacts/test-design-qa.md#P0-019, P0-020, P0-013]
- [Source: Stories 2.4 (verificador e rotas), 2.5 (revogação), 2.7a (emissão do token de serviço e rotação)]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5), Dev Story do BMAD.

### Debug Log References

- `pnpm build`, `typecheck`, `check:deps` (167 módulos), `lint:examples`, `validate:asyncapi`: limpos.
- `pnpm test`: 61 arquivos, 1051 testes verdes (1044 antes do reforço da fase vermelha); `test:generation`: 3 verdes (o `.env` gerado já tem `TECTON_ENV=development`).
- `test:containers` e `test:persistence`: pelo CI (sem Docker local). Nenhum deles chama um domínio com token de usuário sozinho.
- Fase vermelha (A3), 19 mutações, todas mortas no fim. Duas sobreviveram na primeira rodada e os testes foram reforçados:
  - `sub` de serviço aceito sem o prefixo `service:`: faltava um caso com outro prefixo do mesmo tamanho (`account:billing`);
  - `Tecton-On-Behalf-Of` malformado aceito até o verificador: o resultado era o mesmo 401, mas as rotas devem recusar sem chamar o verificador; o teste passou a conferir que não há segunda verificação.
- Problema encontrado: o teste de revogação revogava `USER` e `service:billing` no store compartilhado do arquivo e derrubava os testes seguintes; passou a usar sujeitos próprios.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- **T1:** `Principal.kind` (`'user' | 'service'`), `typ` e `sub` precisam concordar (`kindOf`), `serviceDomainOf` (domínio no padrão do manifest, até 63, nunca `auth`), `SERVICE_SUBJECT_PREFIX`. A interface `TokenVerifier` não mudou. `forged()` ganhou cinco falsificações de tipo e sujeito; `tokenFactory` ganhou `service(domain)`.
- **T2:** `callerOf` em sequência (Authorization, token de usuário sozinho só com `directUserCalls`, `Tecton-On-Behalf-Of` cru e verificado, `call:<domínio>`), depois `auth.requires` contra quem age. `context.service`. `ON_BEHALF_OF_HEADER`, `callPermissionFor`. Log `service_call_refused`.
- **Emenda do AD-7:** `directUserCalls` em `registerActionRoutes` e `startDomainServer` (pelo `TECTON_ENV=development`, com `warn` `direct_user_calls_enabled`; a opção explícita vence). Os testes das 2.4 e 2.5 que chamam com token de usuário sozinho ligam a opção.
- **T3:** o verificador próprio do Auth devolve `kind: 'user'`; o Auth liga `directUserCalls: true`.
- **T4:** README do `@tecton/core` (chamadas entre serviços, tabela de respostas, risco aceito), README do `@tecton/auth` (o `call:` exigido e o risco), comentário do `main.ts` do template, três itens no `deferred-work.md` (OpenAPI, chaves de evento da 3.10, Gateway da 3.6).
- **T5:** verificador (+15), rotas de serviço (`routes-service.test.ts`, 55), `startDomainServer` (+3) e ponta a ponta com o Auth em processo (`packages/auth/src/service-call.test.ts`, 3: serviço sozinho, em nome de usuário, 403 sem dependência, 401 de usuário sozinho, rotação, logout do usuário).

### File List

- `packages/core/src/auth/token-verifier.ts`, `token-verifier.test.ts` (modificados)
- `packages/core/src/routes.ts` (modificado)
- `packages/core/src/routes-service.test.ts` (novo)
- `packages/core/src/routes.test.ts`, `routes-auth.test.ts` (modificados)
- `packages/core/src/domain-server.ts`, `domain-server.test.ts` (modificados)
- `packages/core/src/index.ts`, `packages/core/README.md` (modificados)
- `packages/auth/src/adapters/jose/own-access-token.ts`, `packages/auth/src/service.ts`, `packages/auth/README.md` (modificados)
- `packages/auth/src/service-call.test.ts` (novo)
- `packages/cli/templates/domain/src/main.ts` (modificado)
- `tests/support/tokens.ts` (modificado)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modificado)
- Planejamento (Validate Story): `ARCHITECTURE-SPINE.md` (AD-7), `epics.md` (2.7, 3.6, 3.9), `test-design-qa.md` (P0-020, P0-022)

## Change Log

- 2026-10-24: Story criada (Create Story).
- 2026-10-24: Validate Story: 15 achados aplicados (fixture de `forged()`, ordem sequencial das verificações, cabeçalho vazio, `sub` de serviço, interface `TokenVerifier` inalterada, implementadores de teste, ponta a ponta em `packages/auth`, registros para 3.9, 3.10 e Epic 5, mutações); uma pergunta ao Boss sobre o risco aceito.
- 2026-10-24: Decisões do Boss: emenda do AD-7 (Gateway como serviço; domínios recusam token de usuário sozinho) e exceção só com `TECTON_ENV=development`. Spine, `epics.md` (2.7, 3.6, 3.9) e Test Design (P0-020, P0-022) emendados.
- 2026-10-24: Dev Story concluída (T1 a T6, salvo o code review); status `review`.
