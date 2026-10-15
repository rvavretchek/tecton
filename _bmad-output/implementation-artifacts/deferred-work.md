# Deferred work

Itens reais, não acionáveis agora, registrados pelos code reviews.

## Deferred from: code review do Epic 1 (2026-10-13)

- W1 Fixture global `capturedOutput` (captura de logs/spans com varredura de segredos ao fim de cada teste, P0-003) não entregue no Test Framework [tests/support] — sem logs/spans estruturados ainda; entra com a Story 3.3 (OpenTelemetry) (story 1-1)
- W2 Fixture `jwksTls` adiada do Test Framework [tests/support] — depende do JWKS; entra na Story 2.4 (story 1-1)
- W3 `withDependencyDown` sem a API por nome (`valkey`/`jwks`/`directory`/`legacy`) do Test Design [tests/support/network-faults.ts] — completa conforme cada dependência existir (Epics 2–6) (story 1-1)
- W4 `lintWorkspace` sem ponto de extensão para checagens extras; busca de pacote feita a mão em vez de `createRequire` [packages/manifest/src/lint/lint-workspace.ts] — o Epic 6 (lint:gateway, aviso de quórum) define o hook; a busca manual funciona com pacotes cujo `exports` não expõe o package.json (story 1-6)
- W5 Jobs Playwright dormentes: `e2e` falha sem testes e `api` passa vazio sem `BASE_URL` [.github/workflows/nightly.yml:77] — corrigir ao ativar (Story 3.13 / Epic 4) (story 1-1)
- W6 `docs/aether-tecton-compatibility.md` (commit ca1f3e5 do autor) reordena um log declarado append-only [docs/aether-tecton-compatibility.md] — fora do escopo do Epic 1 (story 1-1)
- W7 `createTectonServer` usa `logger: false` por padrão, então a exceção de um 500 se perde fora do `main.ts` gerado [packages/core/src/server.ts] — configuração de log vem com o ConfigProvider/OTel (Stories 3.1/3.3) (story 1-7)
