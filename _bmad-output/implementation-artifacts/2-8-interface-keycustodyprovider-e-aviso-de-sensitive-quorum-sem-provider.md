# Story 2.8: Interface `KeyCustodyProvider` e aviso de `sensitive.quorum` sem provider

Status: ready-for-dev

## Story

Como **dev que marcou uma action como `sensitive.quorum`**,
quero que o framework declare o contrato do Custodiante e me avise toda vez que a action rodar sem proteção real,
para que a ausência de custódia nunca passe despercebida e a implementação futura já nasça no lugar certo (FR-11).

## Critérios de Aceite

1. **Contrato documentado.** Dado a interface `KeyCustodyProvider` em `@tecton/providers`, quando eu leio a documentação do contrato (TSDoc e README do pacote), então ela diz, em inglês, que a interceptação de `sensitive.quorum` acontece no nível de acesso ao dado e nunca só num middleware de rota HTTP (FR-11).
2. **Sem requisição HTTP por construção.** Nenhum método da interface recebe objeto de requisição HTTP: os parâmetros são só dados da operação. Um teste de tipos prova as assinaturas exatas, e uma regra nova do `check:deps` impede o `@tecton/providers` inteiro de importar `fastify`, `@fastify/*`, `node:http`, `node:https` e `node:http2`.
3. **Executa sem provider.** Dado uma action `sensitive.quorum` e nenhum `KeyCustodyProvider` configurado, quando ela é chamada, então executa normalmente, sem bloquear e sem responder `202` (FR-11, com precedência sobre o FR-25).
4. **Aviso a cada execução.** E cada execução registra um aviso em log, em inglês, com o domínio e o nome da action, dizendo que rodou sem proteção de quórum. "Execução" é chegar ao handler da rota: há aviso em 200, quando o handler lança erro e em 501 (sem handler); não há aviso em 400, 401, 403 nem 503, que param antes.
5. **O resto funciona.** Dado um serviço sem `KeyCustodyProvider` configurado, quando ele sobe, então todas as outras funções do framework funcionam normalmente: actions sem `sensitive`, com `sensitive.quorum: false`, com `approval`, públicas e protegidas, sem nenhuma mudança de resposta nem do documento OpenAPI.

> **Nota (epics.md):** o aviso de build/CI do `tecton-admin lint` para `sensitive.quorum` sem provider é do Epic 6 (FR-17, Story 6.3). A implementação real (OpenBAO, quórum x/n, auditoria encadeada) é roadmap; o 202 com provider (falso) configurado é da Story 5.5.

## Tasks / Subtasks

- [ ] **T1. Interface (AC: 1, 2)** — `packages/providers/src/custody/key-custody-provider.ts`
  - [ ] Assinaturas exatas:
    - `requestAccess(operation: SensitiveOperation): Promise<CustodyDecision>`;
    - `decisionOf(requestId: string): Promise<CustodyDecision | undefined>` (`undefined`: id desconhecido; vira o 404 da 5.5);
    - `CustodyDecision = { status: 'approved' } | { status: 'pending'; requestId: string } | { status: 'denied'; reason?: string }`;
    - `SensitiveOperation = { domain: string; action: string; resource: string; tenant?: string; requestedBy: CustodyRequester; reason?: string }`, com `reason` texto opcional de quem pede (a `sensitive.description` fica no manifest);
    - `CustodyRequester = { kind: CustodyRequesterKind; subject: string; via?: { subject: string } }`, com `CustodyRequesterKind = 'user' | 'service'` definido no providers (`via` é o serviço chamador quando um serviço age em nome do usuário, 2.7b). Sem prazo de expiração (a 5.5 guarda o prazo no banco do domínio).
  - [ ] TSDoc em inglês:
    - a interceptação acontece no nível de acesso ao dado (o adaptador de persistência ou a porta do domínio pede a decisão antes de ler a chave ou o dado), nunca só num middleware de rota HTTP, porque uma rota é contornável por outro serviço, um script de manutenção ou acesso direto ao banco;
    - `pending` é um resultado que quem acessa o dado devolve para cima, e a rota o transforma no 202 do FR-25; a rota nunca decide sozinha;
    - uma decisão `approved` vale só para a operação exata pedida (domínio, action, recurso, tenant) e não pode ser reaproveitada para outro recurso;
    - a trilha de auditoria é do provider (a encadeada é roadmap); quem chama não registra a decisão.
  - [ ] Exportar do `index.ts` do `@tecton/providers`; o `@tecton/core` não reexporta. Nenhum adaptador concreto.
- [ ] **T2. Guarda de dependência (AC: 2)** — `.dependency-cruiser.cjs`, `tools/check-deps/`
  - [ ] Regra `providers-no-http-framework`: `^packages/providers/src/` não importa `fastify`, `@fastify/*`, `node:http`, `node:https`, `node:http2` (nem os nomes sem `node:`). Fixture em `tools/check-deps/fixtures/` e caso em `tools/check-deps/check-deps.test.ts`, no padrão das regras existentes.
- [ ] **T3. Aviso em runtime (AC: 3, 4, 5)** — `packages/core/src/routes.ts`
  - [ ] Por execução: `request.log.warn({ event: 'sensitive_quorum_unprotected', domain, action }, 'action "<nome>" is sensitive.quorum but no KeyCustodyProvider is configured: running without quorum protection')` como **primeira instrução do handler da rota**, antes do `if (!handler)` do 501. Só para `sensitive?.quorum === true` (pública ou protegida). Campos exatamente `event`, `domain` e `action`, do manifest: nada de corpo, input, output, permissões ou sujeito (o input de uma action sensível pode ser o dado protegido). Sem limite de taxa, de propósito: o FR-11 pede um aviso por execução.
  - [ ] Na subida: dentro do `registerActionRoutes`, uma vez, só quando alguma action tem `sensitive.quorum === true`: `app.log.warn({ event: 'sensitive_quorum_unprotected_actions', domain, actions: [...] }, 'sensitive.quorum actions run without quorum protection: no KeyCustodyProvider is configured')`. Cobre o `startDomainServer`, o Auth e quem chama `registerActionRoutes` direto; o `buildOpenApiDocument` fica em silêncio (usa `logger: false`).
  - [ ] Respostas e `routeSchema` iguais: nenhum 202 no schema nem na resposta.
  - [ ] O `event` e o texto viram contrato: as Stories 4.2 (P0-039, `exportTenantData`) e 5.5 (P0-050) vão conferi-los.
- [ ] **T4. Provider configurado recusado (decisão do Boss)** — `packages/core/src/routes.ts` e `domain-server.ts`
  - [ ] Opção `keyCustody?: KeyCustodyProvider` em `ActionRoutesOptions` e `DomainServerOptions`. "Configurado" é `options.keyCustody !== undefined`, com ou sem actions `sensitive` no manifest.
  - [ ] `registerActionRoutes` lança `KeyCustodyProvider is not supported yet: sensitive.quorum is not enforced at the data level (FR-11); remove keyCustody` antes de qualquer `app.post` (nenhuma rota registrada pela metade).
  - [ ] `startDomainServer` recusa com a mesma mensagem **antes** de montar o `tokenVerifierFromEnv` (nenhum cliente Valkey aberto) e nunca chega ao `listen`. Repasse com spread condicional (`exactOptionalPropertyTypes`).
- [ ] **T5. Documentação e registros**
  - [ ] README do `@tecton/providers`: a seção do `KeyCustodyProvider` (contrato, onde interceptar, `pending` e o 202, decisão por operação, auditoria do provider, o que acontece sem provider, roadmap).
  - [ ] README do `@tecton/core`: os dois avisos, a recusa de `keyCustody` e por quê.
  - [ ] `deferred-work.md`: (a) a Story 5.5 tira a recusa, ao menos para o provider falso dos testes dela; (b) a Story 6.3 precisa de um sinal declarativo (manifest ou ambiente) de provider configurado, porque o provider da 2.8 só existe no código; (c) quando a mensageria do Epic 3 executar actions por evento, o aviso precisa sair lá também.
  - [ ] A descrição de `sensitive` no `schema.ts` do manifest fica como está (continua certa para o futuro).
- [ ] **T6. Testes** — Test Design P1-011 (3 casos: aviso a cada execução; nenhum método recebe requisição HTTP)
  - [ ] Tipos (`expectTypeOf`, falha no `pnpm typecheck`, não no `vitest run`): `keyof SensitiveOperation` exato; `Parameters<KeyCustodyProvider['requestAccess']>` igual a `[SensitiveOperation]`; `Parameters<KeyCustodyProvider['decisionOf']>` igual a `[string]`; no core, `PrincipalKind` atribuível a `CustodyRequesterKind`.
  - [ ] Rotas (`app.inject`; o `docs/examples/tenant-domain-manifest-v0.yaml` com `exportTenantData` pode ser a fixture, carregado com `loadDomainManifest`):
    - `sensitive.quorum` responde como sem `sensitive` (200 com handler, 501 sem), nunca 202;
    - um aviso por chamada (duas chamadas, dois avisos), com `event`, `domain` e `action`;
    - aviso quando o handler lança erro e no 501;
    - nenhum aviso em 400 (corpo inválido), 401, 403 e 503 (verificador indisponível);
    - nenhum aviso em action sem `sensitive`, com `sensitive.quorum: false` e com `approval`; aviso em action pública com `sensitive.quorum`;
    - o aviso da subida uma vez, listando as actions; nenhum aviso de subida sem actions `sensitive.quorum`;
    - log sem input nem token (`assertNoSecretsLeaked`);
    - documento OpenAPI da action `sensitive.quorum` igual ao da mesma action sem `sensitive` (sem 202).
  - [ ] `keyCustody` configurado: `registerActionRoutes` recusa sem registrar rota; `startDomainServer` recusa sem abrir Valkey e sem `listen`, mesmo com manifest sem `sensitive`.
  - [ ] `check:deps`: o fixture com `fastify` no providers é recusado.
  - [ ] Fase vermelha por mutação (A3), no mínimo: aviso só na primeira execução; aviso no `onRequest` ou `preValidation` (avisaria em 400 ou 401); aviso depois do `if (!handler)` (perde o 501); aviso ausente em erro do handler; aviso sempre que existe `sensitive` (inclusive `quorum: false`); 202 sem provider; provider configurado aceito em silêncio; a regra nova do `check:deps` removida; uma assinatura da interface trocada (pelo `typecheck`).
- [ ] **T7. Verificação final**
  - [ ] `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:generation`, `test:containers` e `test:persistence` (no CI se o ubt-host02 não responder).
  - [ ] Code review por story antes da retrospectiva do Epic 2 (retro A1).

## Dev Notes

### Decisões desta story

- **Provider configurado impede a subida (fail closed; Boss, 2026-10-24).** A interface existe, mas nenhuma camada do framework chama o provider no acesso ao dado ainda; aceitar um provider e não usá-lo daria a falsa impressão de proteção. A **Story 5.5** (MVP, não roadmap) tira a recusa ao menos para o provider falso dos testes dela; registrar no `deferred-work.md`.
- **O aviso fica no handler da rota, mas não é proteção.** O FR-11 proíbe que a *interceptação* seja só um middleware de rota; o aviso é observabilidade de onde a action executa hoje. O lugar exato (primeira instrução do handler) faz "execução" significar "passou pela autenticação e pela validação".
- **`approval` não muda:** aprovação de negócio, nunca depende de `KeyCustodyProvider` (FR-25); o 202 dela é do Epic 5.
- **Interface mínima para o futuro no nível de dado:** decisão em três estados, consulta por `requestId`, operação com tenant e quem pede (usuário e serviço chamador, 2.7b). Sem prazo, sem auditoria na interface: o prazo fica no banco do domínio (5.5) e a auditoria é do provider.
- **Sem dependência nova.**

### Código existente que esta story toca

| Arquivo | Hoje | Muda | Preservar |
|---|---|---|---|
| `packages/providers/src/index.ts` | portas de auth, relógio, Valkey, bloqueio, revogação | exporta `KeyCustodyProvider` e tipos | o resto da API |
| `packages/core/src/routes.ts` | rotas com verificação (2.4 a 2.7b); handler da rota em `app.post` | aviso por execução no handler, aviso na subida, recusa de `keyCustody` | a sequência de verificação; 501 sem handler; cópias do principal; `routeSchema` |
| `packages/core/src/domain-server.ts` | monta verificador e `directUserCalls` | recusa `keyCustody` antes do verificador | o resto |
| `packages/core/src/index.ts` | API pública do core | nada (não reexporta a custódia) | — |
| `.dependency-cruiser.cjs`, `tools/check-deps/` | regras de direção entre pacotes `@tecton/*` | regra `providers-no-http-framework`, fixture e teste | as regras existentes |
| `packages/manifest` | `sensitive: { quorum, description }` validado; recusado junto com `approval` | nada | o schema e a descrição |

### Padrões a seguir

- Código, mensagens, logs e README em inglês; scripts Python longos em arquivo no scratchpad; `\n` em string Python vira quebra real no arquivo (usar a ferramenta de edição); procurar caracteres de controle no fim.
- Portas sem dependência de framework HTTP (AD-1).
- O teste de tipos só vale no `pnpm typecheck` (o `tsconfig.test.json` inclui os `*.test.ts`); o `vitest run` não confere tipos.

### Perguntas ao Boss (antes do desenvolvimento)

1. **Provider configurado antes de existir a interceptação:** **recusa a subida** (Boss, 2026-10-24).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.8], Stories 4.2, 5.5 e 6.3 (consumidores do aviso e da interface)
- [Source: _bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md#FR-11, FR-25, FR-17]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md] (portas em `@tecton/providers`, AD-1; `KeyCustodyProvider` real no roadmap)
- [Source: _bmad-output/test-artifacts/test-design-qa.md#P1-011] (desta story), P0-039 e P0-050 (consumidores)
- [Source: packages/manifest/src/schema.ts] (`sensitive`), `docs/examples/tenant-domain-manifest-v0.yaml` (`exportTenantData`)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

## Change Log

- 2026-10-24: Story criada (Create Story); decisão do Boss: provider configurado recusa a subida.
- 2026-10-25: Validate Story: 17 achados aplicados (regra nova do `check:deps`, P1-011 e consumidores 4.2/5.5/6.3, lugar exato do aviso, aviso da subida, mensagem e ordem da recusa, `quorum: false`, teste de tipos no `typecheck`, assinaturas exatas, tenant e serviço chamador, TSDoc de decisão e auditoria, OpenAPI inalterado, campos do log).
