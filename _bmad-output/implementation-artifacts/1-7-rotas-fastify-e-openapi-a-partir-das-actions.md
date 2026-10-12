---
baseline_commit: aa1ac1e2343fdcf0f539eb5ae26406e66ac92f07
---

# Story 1.7: Rotas Fastify e OpenAPI a partir das actions

Status: review

## Story

Como **dev que declarou actions no manifest**,
quero que o `@tecton/core` registre as rotas Fastify e gere o OpenAPI a partir delas,
para que contrato HTTP e documentação nunca sejam escritos à mão nem fiquem desatualizados.

## Acceptance Criteria

1. **Rotas.** Dado um manifest válido com actions, quando o `@tecton/core` registra as rotas numa instância Fastify, então cada action vira uma rota `POST /<domínio>/<action-em-kebab-case>`, com `input` como schema do corpo e `output` como schema da resposta.
2. **400 antes do handler.** Dada uma requisição com corpo que não segue o `input`, quando ela chega à rota, então a validação nativa do Fastify a rejeita com status 400 antes de chegar ao handler. E o formato do corpo de erro é provisório (o RFC 9457 final é do Epic 5).
3. **501.** Dada uma rota registrada sem implementação de handler, quando ela é chamada com corpo válido, então responde 501 Not Implemented.
4. **OpenAPI.** Dadas as rotas registradas, quando o `@fastify/swagger` gera o documento, então o OpenAPI lista todas as actions, com schemas de entrada e saída e a `description` de cada action (FR-5).
5. **OpenAPI atualizado.** Dado que eu altero o `input` ou o `output` de uma action no manifest, quando eu rodo o build novamente, então o OpenAPI gerado reflete a mudança sem edição manual (FR-5).
6. **Abstração única de erro.** Dado qualquer erro gerado pelo framework, a partir desta story e em todos os épicos seguintes, quando ele é lançado, então passa por uma abstração única de erro do `@tecton/core` (status, `slug`, `i18nKey` e mensagem) e é convertido em resposta por um único serializador, provisório até o Epic 5. E nenhum outro código monta corpo de resposta de erro por conta própria.

> A verificação de token em cada rota (Zero Trust) é do Epic 2; o formato final de resposta, do Epic 5.

## Tasks / Subtasks

- [x] **T1. Dependências:** `@tecton/core` ganha `fastify@^5.12.5`, `@fastify/swagger@^9.9.2` e `@tecton/manifest` (`workspace:*`, com `reference` no `tsconfig.json`; permitido pelo AD-3).
- [x] **T2. Abstração de erro** (AC: 6)
  - [x] `src/errors/tecton-error.ts`: `class TectonError extends Error` com `status`, `slug` (kebab-case estável, futuro sufixo da URN `urn:tecton:problem:<slug>`), `i18nKey` (namespace `<domínio>.<chave>`, AD-10; o framework usa `tecton.*`), mensagem em inglês e `details?` (lista de problemas de campo, base do `invalid-params` da 5.3).
  - [x] Erros do framework nesta story: `validationFailed(details)` (400, `validation-failed`, `tecton.error.validationFailed`), `notImplemented(action)` (501, `not-implemented`), `internalError()` (500, `internal-error`, sem detalhe da exceção original).
  - [x] `src/errors/serializer.ts`: **único** ponto que transforma `TectonError` em resposta HTTP. Corpo provisório: `{ status, slug, i18nKey, message, details? }`. Erro que não é `TectonError` vira `internalError()` e a exceção vai só para o log.
  - [x] Teste estrutural: nenhum arquivo de `packages/*/src` fora de `errors/serializer.ts` chama `setErrorHandler` ou `reply.code(`/`reply.status(` com corpo de erro (varredura de texto simples).
- [x] **T3. Servidor e rotas** (AC: 1, 2, 3)
  - [x] `src/server.ts`: `createTectonServer(options?)` → `FastifyInstance` com Ajv configurado para requisições (`removeAdditional: false`, `coerceTypes: false`, `allErrors: true`; formatos `uuid`, `date`, `date-time` ativos) e o serializador de erro instalado.
  - [x] `src/routes.ts`: `registerActionRoutes(app, manifest, handlers = {})`. Para cada action: `POST /<domain>/<kebab>` (`actionRoutePath`), `schema.body = inputSchema`, `schema.response[200] = outputSchema`, `schema.description = description`, `schema.operationId = action.name`, `schema.tags = [domain]`. Handler ausente → `notImplemented`.
  - [x] `actionRoutePath(domain, actionName)` exportada (camelCase → kebab-case; `createTenant` → `create-tenant`).
  - [x] Handler recebe `(input, context)`; o retorno é serializado pelo `outputSchema` (campos fora do `output` são removidos pela serialização — base da Story 5.1).
- [x] **T4. OpenAPI** (AC: 4, 5)
  - [x] `src/openapi.ts`: `buildOpenApiDocument(manifest)` cria um servidor, registra `@fastify/swagger` (OpenAPI 3.1, `info.title = domain`, `info.version = version`, `info.description = description`), registra as rotas, chama `ready()` e devolve o documento.
  - [x] Teste de AC 5: mudar o `input` de uma action no manifest e regenerar muda o schema no documento.
- [x] **T5. Testes** (`app.inject`, sem rede): rota e método por action; 400 com corpo provisório e handler não chamado (spy); campo extra no corpo → 400; tipo errado → 400; `uuid` inválido → 400; 501 sem handler; handler implementado → 200 com só os campos do `output`; exceção comum no handler → 500 sem a mensagem da exceção; OpenAPI com todas as actions, `description`, `operationId`, schemas.
- [x] **T6. Verificação final:** `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm check:deps`, `pnpm lint:examples`.

## Dev Notes

- Fastify 5.12.5 e `@fastify/swagger` 9.9.2 (npm, 2026-10-09). O Fastify 5 usa `@fastify/ajv-compiler` com Ajv 8 e `ajv-formats`; os schemas compilados pelo `@tecton/manifest` são draft-07, aceitos por ele.
- O Fastify, por padrão, usa `removeAdditional: true` (remove campos extras em vez de recusar). Para requisições queremos recusar campo desconhecido, por isso `createTectonServer` ajusta o Ajv. Na **resposta**, a serialização pelo schema remove campos extras, que é o comportamento desejado da 5.1.
- Corpo de erro provisório: `{ status, slug, i18nKey, message, details? }`. O Epic 5 troca só o serializador para RFC 9457, sem mudar quem lança os erros.
- `i18nKey` do framework: namespace `tecton.` (ex.: `tecton.error.validationFailed`); o catálogo vem com a 4.6/5.2.
- Rotas fora da convenção RPC (JWKS, health, pendência) não são desta story.
- [Source: epics.md#Story 1.7; ARCHITECTURE-SPINE.md#Consistency Conventions (rotas, erro), AD-6, AD-10; PRD FR-5, FR-23, FR-24]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- `pnpm add @fastify/swagger@^9.9.2` fez o pnpm 12 acrescentar sozinho `minimumReleaseAgeExclude` (a 9.9.2 saiu horas antes). Em vez de contornar a política de idade mínima de release, a dependência ficou em `^9.9.1` e o lockfile foi refeito com `pnpm clean --lockfile` + `pnpm install` (recomendação do próprio pnpm), resolvendo 9.9.1 sem exceção.
- Typecheck: espalhar `FastifyServerOptions` fazia o TypeScript escolher a sobrecarga HTTP/2, e os tipos do `@fastify/ajv-compiler` marcam `removeAdditional`/`coerceTypes` como `never`. `createTectonServer` passou a aceitar só `logger`, e as opções do Ajv são tipadas explicitamente; os testes de campo extra e tipo errado (400) provam que o runtime as respeita.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- `TectonError` (status, `slug`, `i18nKey` `tecton.*`, mensagem em inglês, `details` com `{ name: JSON Pointer, reason }`) e `frameworkErrors` (`validationFailed`, `notFound`, `notImplemented`, `internal`).
- Serializador único `errors/serializer.ts`: `setErrorHandler` + `setNotFoundHandler`; corpo provisório `{ status, slug, i18nKey, message, details? }`; erro de validação do Fastify vira `validation-failed` com detalhes; qualquer outro erro vira 500 sem a mensagem original (que vai só para o log). Teste estrutural garante que nenhum outro arquivo de `packages/*/src` instala handler de erro nem responde 4xx/5xx por conta própria.
- `createTectonServer()`: Ajv de requisição com `removeAdditional: false`, `coerceTypes: false`, `allErrors: true` (recusa campo extra e tipo errado), formatos ativos (`uuid` inválido → 400).
- `registerActionRoutes(app, manifest, handlers)`: `POST /<domínio>/<action-kebab>` (`actionRoutePath`), `body` = `inputSchema`, `response[200]` = `outputSchema` (campos fora do `output` removidos na serialização), `operationId`, `description`, `tags`; sem handler → 501.
- `buildOpenApiDocument(manifest)`: OpenAPI 3.1 via `@fastify/swagger`, com `info` do manifest e todas as actions; regenerar depois de mudar o manifest reflete a mudança.
- Dependências do `@tecton/core`: `fastify` ^5.12.5, `@fastify/swagger` ^9.9.1, `@tecton/manifest` (AD-3).
- Testes: 15 novos (rotas, validação, 501, 500 sem vazamento, OpenAPI, regeneração, serializador único); suíte total 221 verde; build, typecheck, `check:deps` e `lint:examples` verdes.

### File List

- `packages/core/package.json`, `packages/core/tsconfig.json` (modificados)
- `packages/core/src/index.ts` (modificado)
- `packages/core/src/errors/tecton-error.ts`, `errors/serializer.ts`, `errors/single-serializer.test.ts` (novos)
- `packages/core/src/server.ts`, `routes.ts`, `routes.test.ts`, `openapi.ts`, `openapi.test.ts` (novos)
- `pnpm-lock.yaml` (refeito sob a política de idade mínima de release)

## Change Log

- 2026-10-09: Story 1.7 implementada: rotas Fastify por action, validação de entrada antes do handler, 501, abstração única de erro com serializador provisório e OpenAPI gerado do manifest.
