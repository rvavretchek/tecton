# Story 2.8: Interface `KeyCustodyProvider` e aviso de `sensitive.quorum` sem provider

Status: ready-for-dev

## Story

Como **dev que marcou uma action como `sensitive.quorum`**,
quero que o framework declare o contrato do Custodiante e me avise toda vez que a action rodar sem proteção real,
para que a ausência de custódia nunca passe despercebida e a implementação futura já nasça no lugar certo (FR-11).

## Critérios de Aceite

1. **Contrato documentado.** Dado a interface `KeyCustodyProvider` em `@tecton/providers`, quando eu leio a documentação do contrato (TSDoc e README do pacote), então ela diz, em inglês, que a interceptação de `sensitive.quorum` acontece no nível de acesso ao dado e nunca só num middleware de rota HTTP (FR-11).
2. **Sem requisição HTTP por construção.** Nenhum método da interface recebe objeto de requisição HTTP: os parâmetros são só dados da operação (domínio, action, recurso, quem pede, motivo). Um teste de tipos prova isso, e o `@tecton/providers` continua sem depender de `fastify` nem de `node:http` (o `check:deps` já impede).
3. **Executa sem provider.** Dado uma action `sensitive.quorum` e nenhum `KeyCustodyProvider` configurado, quando ela é chamada, então executa normalmente, sem bloquear e sem responder `202` (FR-11, com precedência sobre o FR-25).
4. **Aviso a cada execução.** E cada execução registra um aviso em log, em inglês, com o domínio e o nome da action, dizendo que rodou sem proteção de quórum (`event: "sensitive_quorum_unprotected"`). O aviso sai também quando o handler falha ou quando a action responde 501 (sem handler): o que conta é a tentativa de executar.
5. **O resto funciona.** Dado um serviço sem `KeyCustodyProvider` configurado, quando ele sobe, então todas as outras funções do framework funcionam normalmente: actions sem `sensitive`, actions com `approval`, públicas e protegidas, nenhuma mudança de resposta.

> **Nota (epics.md):** o aviso de build/CI do `tecton-admin lint` para `sensitive.quorum` sem provider é do Epic 6 (FR-17). A implementação real (OpenBAO, quórum x/n, auditoria encadeada) é roadmap.

## Tasks / Subtasks

- [ ] **T1. Interface (AC: 1, 2)** — `packages/providers/src/custody/key-custody-provider.ts`
  - [ ] `KeyCustodyProvider` com métodos que recebem só dados (ex.: `requestAccess(operation)` e `decisionOf(requestId)`), devolvendo uma decisão (`approved`, `pending` com `requestId`, `denied`). `SensitiveOperation` com `domain`, `action`, `resource` (identificador do dado protegido), `requestedBy` (`subject` e `kind`, como o `Principal` do core, sem importar o core) e `reason`. Nada de `request`, `reply`, cabeçalhos ou URL.
  - [ ] TSDoc em inglês: a interceptação acontece no nível de acesso ao dado (o adaptador de persistência ou a porta do domínio pede a decisão antes de ler a chave ou o dado), nunca só num middleware de rota HTTP, porque uma rota é contornável por outro serviço, um script de manutenção ou acesso direto ao banco; o 202 do FR-25 só existe com aprovação real pendente.
  - [ ] Exportar do `index.ts` do `@tecton/providers`. Nenhum adaptador concreto (roadmap).
- [ ] **T2. Aviso em runtime (AC: 3, 4, 5)** — `packages/core/src/routes.ts`
  - [ ] Para cada action com `sensitive.quorum: true`, a rota registra `warn` com `event: "sensitive_quorum_unprotected"`, `domain`, `action` e a mensagem `action "<nome>" is sensitive.quorum but no KeyCustodyProvider is configured: running without quorum protection` a cada execução, depois da autenticação (uma chamada recusada com 401 ou 403 não executou nada). Sem token ou segredo no log.
  - [ ] Um aviso na subida listando as actions `sensitive.quorum` sem proteção (uma linha por serviço), para o operador ver logo.
  - [ ] Respostas iguais às de hoje: nenhum 202, nenhum bloqueio.
- [ ] **T3. Provider configurado (decisão desta story)** — `packages/core/src/routes.ts` e `domain-server.ts`
  - [ ] Opção `keyCustody?: KeyCustodyProvider` em `ActionRoutesOptions` e `DomainServerOptions`. Como a interceptação no nível de dado ainda não existe (roadmap), um provider configurado **impede a subida** com erro claro: o framework nunca finge proteger o que não protege. Sem provider, o comportamento do T2.
- [ ] **T4. Documentação**
  - [ ] README do `@tecton/providers`: a seção do `KeyCustodyProvider` (contrato, onde interceptar, o que acontece sem provider, roadmap).
  - [ ] README do `@tecton/core`: o aviso de `sensitive.quorum` e o erro com provider configurado.
- [ ] **T5. Testes**
  - [ ] Tipos: os parâmetros dos métodos não aceitam objeto de requisição (`expectTypeOf` do Vitest), e o arquivo da interface não importa `fastify`, `node:http` nem `@tecton/core`.
  - [ ] Rotas (`app.inject`): action `sensitive.quorum` responde como sem `sensitive` (200 com handler, 501 sem), nunca 202, com o aviso a cada chamada (duas chamadas, dois avisos), com o nome e o domínio; o aviso sai mesmo quando o handler lança erro; nenhum aviso em 401 ou 403; action sem `sensitive`, com `approval` e pública sem aviso; o aviso da subida lista as actions.
  - [ ] `keyCustody` configurado: `registerActionRoutes` e `startDomainServer` recusam com a mensagem esperada.
  - [ ] Fase vermelha por mutação (A3), no mínimo: aviso só na primeira execução; aviso antes da autenticação; aviso ausente em erro do handler; 202 ou bloqueio sem provider; provider configurado aceito em silêncio; aviso em action sem `sensitive`.
- [ ] **T6. Verificação final**
  - [ ] `pnpm build`, `typecheck`, `check:deps`, `lint:examples`, `validate:asyncapi`, `test`, `test:generation`, `test:containers` e `test:persistence` (no CI se o ubt-host02 não responder).
  - [ ] Code review por story antes da retrospectiva do Epic 2 (retro A1).

## Dev Notes

### Decisões desta story

- **Provider configurado impede a subida (fail closed; Boss, 2026-10-24).** A interface existe, mas nenhuma camada do framework chama o provider no acesso ao dado ainda. Aceitar um provider e não usá-lo daria a falsa impressão de que o quórum está protegido. A Story que implementar a interceptação (roadmap) troca o erro pelo uso real.
- **O aviso fica na rota, mas não é proteção.** O FR-11 proíbe que a *interceptação* seja só um middleware de rota; o aviso é observabilidade da execução e pode ficar onde a action executa hoje. Quando a mensageria do Epic 3 executar actions por evento, o aviso precisa sair lá também (registrar no `deferred-work.md`).
- **Aviso depois da autenticação:** uma chamada recusada com 401 ou 403 não executa a action; contar só execuções evita poluir o log com tentativas inválidas.
- **`approval` não muda:** é aprovação de negócio, nunca depende de `KeyCustodyProvider` (FR-25); o 202 dela é do Epic 5.
- **Sem dependência nova.**

### Código existente que esta story toca

| Arquivo | Hoje | Muda | Preservar |
|---|---|---|---|
| `packages/providers/src/index.ts` | portas de auth, relógio, Valkey, bloqueio, revogação | exporta `KeyCustodyProvider` e tipos | o resto da API |
| `packages/core/src/routes.ts` | rotas com verificação (2.4 a 2.7b) | aviso de `sensitive.quorum`; opção `keyCustody` recusada | toda a sequência de verificação; 501 sem handler; cópias do principal |
| `packages/core/src/domain-server.ts` | monta verificador e `directUserCalls` | repassa `keyCustody` | o resto |
| `packages/manifest` | `sensitive: { quorum, description }` já validado, recusado junto com `approval` | nada | o schema |

### Padrões a seguir

- Código, mensagens, logs e README em inglês; scripts Python longos em arquivo no scratchpad; barra invertida em string Python vira caractere de controle (usar a ferramenta de edição).
- Portas sem dependência de framework HTTP (AD-1); `check:deps` como guarda.

### Perguntas ao Boss (antes do desenvolvimento)

1. **Provider configurado antes de existir a interceptação:** **recusa a subida** (Boss, 2026-10-24).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.8]
- [Source: _bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md#FR-11, FR-25]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md] (portas em `@tecton/providers`; `KeyCustodyProvider` real no roadmap)
- [Source: packages/manifest/src/schema.ts] (`sensitive`)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

## Change Log

- 2026-10-24: Story criada (Create Story).
