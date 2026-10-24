# Story 2.7b: Token de serviço, parte 2: verificação em todo serviço

Status: ready-for-dev

## Story

Como **dev de um domínio que chama outro domínio**,
quero que todo serviço aceite o token de serviço do chamador, sozinho ou junto com o token do usuário em nome de quem chama,
para que quem recebe saiba qual serviço está chamando e em nome de qual usuário, verificando os dois por conta própria (FR-13, D3).

> Segunda metade da Story 2.7, dividida no Create Story de 2026-10-23 (decisão do Boss; nota no `epics.md`). A 2.7a entregou a credencial de serviço, o `register-service` e o `POST /auth/service-token`. Esta story faz cada serviço de domínio aceitar e conferir esses tokens.

## Critérios de Aceite

1. **Token de serviço aceito.** Dado um token de serviço válido (`typ: service`, `sub: service:<domínio>`, mesmas regras de assinatura, `kid`, `iss`, `aud`, `exp`, `iat`, `perms` e revogação da Story 2.4 e 2.5), quando ele chega em `Authorization: Bearer` numa action protegida, então o serviço o verifica localmente pelo JWKS e o aceita como chamada de serviço.
2. **`call:<próprio domínio>` exigido.** Dado uma chamada com token de serviço, com ou sem `Tecton-On-Behalf-Of`, quando ela chega, então o serviço chamado exige `call:<domínio do manifest dele>` no token de serviço, além das permissões de `auth.requires`. Sem ele, a resposta é 403, mesmo com um token de usuário válido em `Tecton-On-Behalf-Of` (um serviço que não declarou o domínio chamado em `dependencies`).
3. **Em nome de um usuário.** Dado uma chamada com o token de serviço em `Authorization` e o token do usuário em `Tecton-On-Behalf-Of`, quando ela chega, então os dois tokens são verificados de forma independente, com as mesmas regras da Story 2.4 (e a revogação da 2.5), e `auth.requires` é avaliado contra as permissões do usuário, nunca contra as do serviço.
4. **Sem usuário.** Dado uma chamada só com o token de serviço (job, consumo de evento), quando ela chega, então `auth.requires` é avaliado contra as permissões do serviço.
5. **Um dos dois inválido.** Dado um token de serviço e um token de usuário em `Tecton-On-Behalf-Of` em que um dos dois é inválido, forjado, expirado ou revogado, quando a chamada chega, então ela é rejeitada com 401. Um token de serviço em `Tecton-On-Behalf-Of` também é 401 (o usuário em nome de quem se age é sempre um usuário). Se a verificação de qualquer um dos dois estiver indisponível (JWKS ou revogação), a resposta é 503, como na 2.4.
6. **O handler sabe quem é quem.** Dado uma chamada aceita, quando o handler roda, então `context.principal` é de quem as permissões foram avaliadas (o usuário em nome de quem se age, ou o serviço sem usuário), com um campo que diz se é usuário ou serviço, e `context.service` é o serviço chamador sempre que a chamada veio com token de serviço. Os dois são cópias novas por requisição, como na 2.4.
7. **Chamadas de usuário não mudam.** Dado um token de usuário em `Authorization`, quando a chamada chega, então tudo segue como na 2.4: `call:` não é exigido e `Tecton-On-Behalf-Of` é ignorado (identidade só pelo token verificado; o Gateway da Story 3.6 remove esse cabeçalho de chamadas externas).
8. **O Auth continua só com usuário.** Dado um token de serviço, quando ele é apresentado à action protegida do Auth (`registerService`), então é recusado com 401, como na 2.7a: registrar serviço é ato de administrador.
9. **Sem segredos nos logs.** Nenhum token (nem o do serviço, nem o do usuário) aparece em log ou corpo de erro.

> **Risco aceito (auditoria de segurança de 2026-10-06):** um serviço comprometido pode reaproveitar, até expirarem (15 minutos), tokens de usuário que recebeu. É inerente à propagação de token; a exigência de `call:<domínio>` limita para onde ele pode usá-los. Registrar no README do `@tecton/core` (o do `@tecton/auth` já registra, desde a 2.7a).

## Tasks / Subtasks

- [ ] **T1. Verificador (AC: 1, 3, 5)** — `packages/core/src/auth/token-verifier.ts`
  - [ ] `Principal` ganha `kind: 'user' | 'service'`. Token de serviço: `sub` precisa ser `service:<domínio>` (domínio no padrão do manifest, `DOMAIN_NAME_PATTERN`); token de usuário: `sub` nunca começa com `service:`. Qualquer outro `typ` é 401.
  - [ ] O resto das regras é o mesmo para os dois tipos (assinatura, `kid`, `at+jwt`, `iss`, `aud`, `exp`, `iat` não futuro, `perms` lista de texto, revogação por `jti` e por sujeito). A revogação por sujeito `service:<domínio>` é a da rotação da 2.7a.
  - [ ] Verificação do valor cru de `Tecton-On-Behalf-Of` (o JWT do usuário, sem `Bearer`): o mesmo caminho da verificação, com o mesmo limite de tamanho (`MAX_TOKEN_LENGTH`). Cabeçalho repetido (o Node junta com `, `) não casa com o formato de JWT e é 401. Expor isso na interface `TokenVerifier` (ex.: `verifyToken(token)` ao lado de `verify(authorization)`), e atualizar todos os que a implementam: o `tokenVerifierFromEnv`, o verificador próprio do Auth e o verificador falso do `buildOpenApiDocument`.
  - [ ] `tests/support/tokens.ts`: o item `'service token'` de `forged()` deixa de ser forjado para o verificador (passa a ser token válido de outro tipo). Tirar de `forged()` e cobrir à parte; o factory ganha um atalho para token de serviço (`sub: service:<domínio>`, `typ: service`).
- [ ] **T2. Rotas (AC: 2 a 7)** — `packages/core/src/routes.ts`
  - [ ] No `onRequest` de action protegida: verifica `Authorization`. Se for usuário, segue como hoje (ignora `Tecton-On-Behalf-Of`). Se for serviço: verifica `Tecton-On-Behalf-Of` quando presente (precisa ser usuário; serviço é 401); só depois, com os dois verificados, exige `call:<manifest.domain>` no token de serviço (403) e avalia `auth.requires` contra o usuário (se houver) ou contra o serviço (403).
  - [ ] Ordem das respostas: 401 e 503 vêm antes de 403 (um token inválido nunca recebe 403, que diria que a assinatura passou).
  - [ ] `ActionContext`: `principal` (de quem as permissões foram avaliadas) e `service?: Principal` (o chamador, quando é serviço). Cópias por requisição, incluindo as datas.
  - [ ] Log `warn` de 403 por falta de `call:` com o serviço chamador e o domínio chamado (sem token), para o operador achar um `dependencies` esquecido.
- [ ] **T3. Auth (AC: 8)** — `packages/auth/src/adapters/jose/own-access-token.ts`
  - [ ] `createOwnTokenVerifier` devolve `kind: 'user'` e implementa a nova forma da interface; continua recusando token de serviço.
- [ ] **T4. OpenAPI e documentação (AC: 6, 9)**
  - [ ] `buildOpenApiDocument`: o verificador falso implementa a interface nova. O cabeçalho `Tecton-On-Behalf-Of` não entra no contrato público agora (Epic 5, FR-24); registrar como adiado se o code review pedir.
  - [ ] README do `@tecton/core`: token de serviço, `Tecton-On-Behalf-Of` (formato, quando é ignorado), `call:<domínio>`, tabela de respostas atualizada, `context.principal` e `context.service`, risco aceito.
  - [ ] Comentário do `main.ts` do template de domínio, se ele descrever só tokens de usuário.
- [ ] **T5. Testes (AC: todos)** — Test Design P0-019 (4), P0-020 (2)
  - [ ] Verificador: token de serviço aceito com `kind: 'service'`; `sub` de serviço fora do padrão, token de usuário com `sub: service:...` e `typ` desconhecido recusados; token de serviço revogado por sujeito (rotação) recusado; `verifyToken` com valor repetido, longo demais ou com `Bearer` recusado.
  - [ ] Rotas (`app.inject`, `tokenFactory`, revogação em memória):
    - serviço sem usuário: `requires` contra o serviço (200 com a permissão, 403 sem);
    - em nome de usuário: `requires` contra o usuário (200 quando o usuário tem e o serviço não; 403 quando o serviço tem e o usuário não);
    - `call:` ausente: 403 com usuário válido, e também sem usuário;
    - token de serviço forjado, expirado ou revogado: 401; token de usuário em `Tecton-On-Behalf-Of` forjado, expirado ou revogado: 401; token de serviço em `Tecton-On-Behalf-Of`: 401;
    - 401 antes de 403 (serviço sem `call:` e usuário inválido: 401);
    - JWKS ou revogação indisponível na verificação do token de usuário: 503;
    - chamada de usuário com `Tecton-On-Behalf-Of` de outro usuário: o principal é o do `Authorization` (P0-013 continua);
    - `context.principal` e `context.service` corretos e copiados por requisição;
    - nenhum dos dois tokens em log ou corpo de erro.
  - [ ] Ponta a ponta com o Auth em processo: `register-service` (2.7a), `service-token`, e um domínio montado com `startDomainServer` contra o JWKS do Auth, chamado com o token de serviço e com `Tecton-On-Behalf-Of` de um usuário que fez login; depois da rotação, o token antigo do serviço é 401 no domínio.
  - [ ] Fase vermelha por mutação (A3), no mínimo: aceitar qualquer `typ`; não exigir `call:`; `requires` contra o serviço quando há usuário; não verificar `Tecton-On-Behalf-Of`; aceitar token de serviço em `Tecton-On-Behalf-Of`; 403 antes de 401; `call:` de outro domínio aceito; `sub` de serviço sem prefixo aceito.
- [ ] **T6. Verificação final**
  - [ ] `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:generation`, `test:containers` e `test:persistence` (no CI se o ubt-host02 não responder).
  - [ ] Code review por story antes da 2.8 (retro A1).

## Dev Notes

### Decisões desta story

- **Formato de `Tecton-On-Behalf-Of`: o JWT cru do usuário, sem `Bearer`.** É um cabeçalho do Tecton, não um esquema de autenticação HTTP; o `ServiceClient` (Story 3.9) tira o prefixo do `Authorization` que recebeu. Cabeçalho repetido é 401.
- **Token de usuário com `Tecton-On-Behalf-Of` é ignorado, não recusado.** Preserva o P0-013 da 2.4 (identidade só pelo token verificado; cabeçalhos de identidade não mudam nada) e o Gateway (3.6) já remove o cabeçalho de chamadas externas. Só um serviço age em nome de alguém.
- **`call:` vem antes de `requires`, mas depois das duas verificações:** um token inválido sempre dá 401, nunca 403.
- **Actions públicas continuam públicas:** nenhum token é verificado nelas, nem `call:` exigido (é a regra da 2.4; uma action pública é chamável por qualquer um).
- **O Auth não aceita token de serviço** na sua action protegida (`registerService` é de administrador). Nenhuma outra action do Auth é protegida.
- **Sem dependência nova:** jose 6.2.12 e o padrão de domínio do `@tecton/manifest` (já dependência do core).
- **Fora do escopo:** anexar os tokens automaticamente no `ServiceClient` e nos eventos (Epic 3, FR-21, FR-26); `Tecton-On-Behalf-Of` no OpenAPI (Epic 5).

### Código existente que esta story toca

| Arquivo | Hoje | Muda | Preservar |
|---|---|---|---|
| `packages/core/src/auth/token-verifier.ts` | só `typ: user` (`typ !== 'user'` é 401); `Principal` sem tipo; `verify(authorization)` | aceita `typ: service` com `sub: service:<domínio>`; `kind`; verificação de token cru | cache do JWKS, cooldown, backoff, CA, limites, 503 distinto de 401, revogação obrigatória |
| `packages/core/src/routes.ts` | `onRequest` verifica `Authorization` e avalia `requires`; `principal` copiado | serviço, `Tecton-On-Behalf-Of`, `call:`, `context.service` | `onRequest` antes do corpo; 401 antes de 400; 501 sem handler; recusa de action protegida sem verificador ou sem `requires` |
| `packages/core/src/openapi.ts` | verificador falso que recusa tudo | implementa a interface nova | documento gerado igual |
| `packages/auth/src/adapters/jose/own-access-token.ts` | `createOwnTokenVerifier` só com usuário | `kind: 'user'`, interface nova | recusa de token de serviço; revogação; uso do leitor no logout |
| `tests/support/tokens.ts` | `forged()` inclui `'service token'` | sai de `forged()`; atalho para token de serviço | as outras falsificações (usadas pela 2.4) |
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

Nenhuma decisão em aberto: o formato de `Tecton-On-Behalf-Of` e o tratamento dele com token de usuário seguem as regras já decididas (P0-013 e AD-7). Se o Boss preferir recusar com 401 um token de usuário acompanhado de `Tecton-On-Behalf-Of`, é uma troca de uma linha no T2.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.7] (critérios originais e a nota de divisão)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#AD-7] (token de serviço, dois tokens verificados de forma independente, `call:<domínio>` exigido pelo chamado)
- [Source: _bmad-output/test-artifacts/test-design-qa.md#P0-019, P0-020, P0-013]
- [Source: Stories 2.4 (verificador e rotas), 2.5 (revogação), 2.7a (emissão do token de serviço e rotação)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

## Change Log

- 2026-10-24: Story criada (Create Story).
