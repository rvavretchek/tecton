# Aether — Visão e Decisões de MVP

> Notas de sessão (bmad-party-mode: Mary/Analista, John/PM, Winston/Arquiteto, Sally/UX, Amelia/Dev). Ponto de partida: `Aether.md`. Documento vivo — atualizar conforme a discussão evolui.

## Objetivos do projeto

1. **Principal:** peça de portfólio.
2. **Secundário:** framework que agregue valor real de desenvolvimento (padronização, redução de tempo, eliminação de trabalho básico repetido — auth, models/migrations, e-mail — no espírito do que o Django faz bem), e que seja facilmente manipulável por agentes de IA.

`Aether.md` é ponto de partida (brainstorm de possibilidades), não especificação final.

## Regra de decisão: teste de duas perguntas

Antes de qualquer investimento de tempo/robustez extra em uma funcionalidade, ela precisa responder sim às duas:

1. **Agrega valor real ao framework** (não é complexidade por capricho)?
2. **Pode ser preparada para o futuro sem impactar o funcionamento atual** (modelagem/abstração barata agora vs. reforma cara depois)?

Auth robusto (JWT + Refresh) passa nas duas — é o tipo de coisa cuja ausência seria crítica para qualquer dev competente. Redis/cache "porque sim" reprova as duas — complexidade sem necessidade agora.

## Decisões fechadas

- **Comunicação API:** tRPC (decisivo — sem "ambos suportados").
- **ORM:** Prisma.
- **Autenticação:** JWT + Refresh Token. Hashing local: Argon2id + Pepper.
- **CLI (escopo MVP):** `new`, `generate`, `migrate`, `dev`.
- **Testes:** Vitest, scaffolding automático gerado junto com cada `generate` (não é framework de teste completo no MVP).
- **Admin (MVP):** tela funcional de gestão de usuários/grupos/papéis, **sem** drag-and-drop — mas construída sobre o modelo de dados já preparado para a visão completa (ver Roadmap).

## Decisões de arquitetura para o MVP (preparação, não features novas)

Aprovadas pelo teste de duas perguntas — custam pouco agora, evitam reforma depois:

1. **Multitenancy no schema desde o início** — `tenant_id`/isolamento em todas as tabelas, mesmo que o MVP rode com um único tenant.
2. **Modelo de entidades genérico e hierárquico** — usuário, grupo, papel, módulo, submódulo como objetos de primeira classe, com relações de contenção (pai/filho), associação (membro de) e atribuição (papel sobre). Necessário para a árvore visual futura existir sem reescrita.
3. **`AuthProvider` como abstração/adapter** — implementação local (Argon2id) no MVP, ponto de extensão pronto para Keycloak/outros IDMs depois.
4. **Abstração de secrets/chaves** — MVP guarda pepper localmente; interface pronta para plugar OpenBAO (Transit engine) depois.

## Corte de MVP — tabela completa (`Aether.md`)

| Item | Veredito |
|---|---|
| Roteamento | MVP (fundação) |
| Abstração de Banco + Migrations | MVP (Prisma) |
| Autenticação + Autorização | MVP (JWT+Refresh, Argon2id+Pepper) |
| Validação de Dados | MVP (Zod, junto com tRPC) |
| API/RPC | MVP (tRPC) |
| Configuração Externalizada | MVP (fundação) |
| Logging Estruturado | MVP (Pino, default) |
| Tratamento de Erros Global | MVP (fundação) |
| Testes Automatizados | MVP (Vitest, scaffolding via CLI) |
| CLI | MVP (escopo reduzido) |
| Dev Server Hot-Reload | MVP (Vite + tsx) |
| Email/SMS/Notifications | MVP (interface unificada, 1 provider) |
| Sessão e CSRF | Absorvido pela decisão de Auth (JWT, não sessão tradicional) |
| Painel Administrativo | MVP-lite (sem drag-and-drop; ver Roadmap p/ visão completa) |
| Data Validation & Serialization | Absorvido por Zod+tRPC |
| TypeScript First | Premissa transversal |
| ESLint/Prettier | MVP (baixo custo) |
| Docker Integration | MVP-lite (Dockerfile + compose só p/ DB local) |
| Cache (Redis) | Fast-follow |
| Queue/Jobs | Fast-follow |
| Internacionalização (i18n) | Fast-follow |
| Plugin System | Someday |
| Distributed Evolution | Someday |
| CRUD UI Generator (genérico) | Someday (base = admin MVP-lite acima) |
| PWA | Someday |
| WebSockets | Someday |
| File Upload (Streaming) | Someday |
| API Client Generation (OpenAPI) | Someday |
| Orquestrador SDD (do `Aether.md` original) | Someday, estacionado |

## Pendências em aberto

- **Papel do OpenBAO no MVP vs. roadmap:** confirmado como secrets manager (guarda do pepper) no plano futuro; escopo exato de uso no MVP (se algum) a definir.

## Decisão: revogação de refresh token (2026-08-11)

Interface `TokenRevocationStore` (nome sem prefixo de projeto, compatível com o projeto irmão Tecton — ver `docs/aether-tecton-compatibility.md`) adotada. Implementação MVP: **Postgres/Prisma-backed**, não Redis — Redis permanece fora do MVP do Aether (decisão já fechada; o raciocínio que levou o Tecton a usar Redis-backed não se aplica aqui, já que lá o Redis já é dependência padrão por outro motivo). Um backend Redis-backed fica previsto como opção futura da mesma interface, não implementado agora.

## Decisão: o que é um "recurso" na árvore

Dois tipos de recurso, pesos diferentes:

1. **Permissão nomeada** (ex.: "pode editar fatura") — **MVP, implementação real**. Essencialmente sem custo extra: o sistema de papéis já precisa de um conceito de permissão para funcionar.
2. **Objeto de negócio real** (ex.: documento, servidor, ativo — inspirado nos objetos do NDS original) — **contrato/interface entra no MVP** (barato: `ResourceType` já nasce sabendo que existe mais de uma variante), **implementação/ferramenta de registro genérica fica para o próximo marco** (não é barata: exige um mecanismo de "qualquer entidade da aplicação pode virar nó na árvore").

Padrão validado em sistemas reais: Google Workspace/SharePoint (documento dentro de pasta com ACL herdado), AWS Organizations/GCP Resource Manager (recurso de infra dentro de pasta/projeto), ITSM/gestão de ativos tipo ServiceNow (ativo físico dentro de departamento) — todos aplicam controle de acesso a objetos de negócio reais posicionados numa hierarquia, mesmo padrão do NDS original.

## Roadmap — próximo grande marco (definido, fora do MVP, não "someday" vago)

Motivado por experiência pessoal de 30+ anos com Novell NetWare 4.1 / NDS — referência ainda sem equivalente real no ecossistema JS atual. Visto pela mesa como o diferencial real do framework frente a concorrentes (T3, RedwoodJS, etc.).

1. **Auth pluggable** — integração com Keycloak e OpenBAO inicialmente; extensível a mais IDMs/PAMs via contribuição da comunidade.
2. **Painel administrativo estilo NDS** — árvore visual de módulos/submódulos (OUs), usuários, grupos, papéis, com drag-and-drop para: mover usuário para grupo, atribuir papel a usuário/grupo, mover recurso para módulo. Tudo como objeto na mesma árvore.
3. **Criptografia seletiva de dados** (todos ou apenas sensíveis, configurável) com **custódia múltipla de chaves** (multi-custodiante).
4. **Multitenant com múltiplos custodiantes por tenant** — mecanismo de gestão de custodiantes embutido no framework, para que o dev que usa o Aether só precise implementar regras de negócio.

> Especificação completa deste item (quórum, auto-recuperação, aprovação criptograficamente forçada, interface `KeyCustodyProvider`) mantida em `docs/aether-tecton-compatibility.md`, compartilhada com o projeto irmão Tecton — não duplicar aqui para evitar divergência.

## Usuário primário da visão de admin

Fluxo de valor: o **cliente final do dev** (em produção) é quem usa o painel para gerir usuários/permissões da própria empresa e sente o valor diretamente. O dev que constrói com o Aether usa a mesma interface para o setup inicial da aplicação, e sente o valor de forma refletida — via satisfação do próprio cliente dele. Desenhar primeiro para o admin do cliente final; setup do dev é um caso de uso da mesma UI.
