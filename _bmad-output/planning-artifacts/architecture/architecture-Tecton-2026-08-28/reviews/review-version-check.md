---
title: 'Verificação de versões — Stack table (ARCHITECTURE-SPINE.md)'
type: review
target: '_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md'
date: '2026-08-31'
method: 'WebSearch (reality-check contra treinamento), sem execução de código'
---

# Verificação de versões — Stack da Architecture Spine (Tecton)

Contexto: revisão realizada em 31/ago/2026. Todas as afirmações abaixo vieram de busca web nesta data, não de conhecimento de treinamento.

## 1. Node.js 24.x — CONFIRMADO, correto

- Node.js 24 é a linha **Active LTS** atual (entrou em Active LTS em 28/out/2025).
- EOL declarado: **30/abr/2028** — bate exatamente com o que a spine diz ("suportado até abr/2028").
- Veredito: **entrada correta e atual**, nenhuma mudança necessária.

Fontes:
- [Node.js End-of-Life Dates — HeroDevs](https://www.herodevs.com/blog-posts/node-js-end-of-life-dates-you-should-be-aware-of)
- [Node.js End-of-Life Dates — DEV Community](https://dev.to/endoflifeai/nodejs-end-of-life-dates-official-eol-schedule-for-every-version-6do)
- [Node.js EOL/EOS — eosl.date (release 26.8.1, ago/2026)](https://eosl.date/eol/product/nodejs/)

## 2. TypeScript 6.0.3 — CONFIRMADO como release real; rationale ainda válido, mas com prazo de validade curto

- TypeScript 6.0.3 é um release real, lançado em **16/abr/2026** — é o último release da linha baseada em JavaScript, ponte entre 5.9 e 7.0 (que é a reescrita nativa em Go).
- **TypeScript 7.0 já foi lançado** — GA em **08/jul/2026** (antes da data desta revisão) — trazendo o compilador nativo Go (`tsgo`), com ganhos de ~8-12x em builds completos.
- A justificativa da spine ("TS 7 quebra compatibilidade com ts-node/tsx") **continua válida em 31/ago/2026**, mas por um motivo mais específico do que "TS7 recém-lançado": TypeScript 7.0 **não inclui API de compilador programática pública** — a Microsoft só promete isso em **7.1**, com previsão de chegar por volta de **out/2026** (3-4 meses após o 7.0). Ferramentas que dependem da API programática do TS (`ts-node` é citado como o "elo fraco"; `tsx` e a execução nativa de TS do Node são as alternativas recomendadas pela comunidade) não rodam em TS7 até essa API existir.
- Ou seja: **a pin em TS 6.0.3 está correta e a razão declarada não está obsoleta ainda** — mas o cenário está mudando rápido (TS 7.1 esperado ~2 meses depois desta revisão) e o texto da spine deveria citar a causa raiz mais precisa (falta de API programática, não "TS7 recém-lançado") e marcar esse pin para reavaliação quando TS 7.1 sair.

Fontes:
- [TypeScript 6.0.3 release — GitHub](https://github.com/microsoft/TypeScript/releases/tag/v6.0.3)
- [TypeScript 6.0 Ships as Final JavaScript-Based Release — Visual Studio Magazine](https://visualstudiomagazine.com/articles/2026/03/23/typescript-6-0-ships-as-final-javascript-based-release-clears-path-for-go-native-7-0.aspx)
- [Announcing TypeScript 7.0 — TypeScript DevBlog](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [TypeScript 7 is out — typescriptpro.com](https://typescriptpro.com/blog/typescript-version-7-2026-07-08)
- [TypeScript 7 Now Stable: 10x Faster Builds, But Not for Vue or Svelte Yet — Tech Times](https://www.techtimes.com/articles/320049/20260710/typescript-7-now-stable-10-faster-builds-not-vue-svelte-yet.htm)
- [Revisit TypeScript 7 upgrade (toolchain blocked until TS 7.1) — GitHub issue](https://github.com/wppconnect-team/wa-js/issues/3540)

## 3. Fastify 5.12.x — CONFIRMADO, real e atual

- Fastify 5.12.1 é a versão mais recente publicada (poucos dias antes desta revisão). Fastify v5 continua sendo a major estável em produção.
- Fastify v6 existe apenas como milestone em desenvolvimento no GitHub ("Draft — not ready", ~76% completo em 16/ago/2026) — **ainda não lançado**.
- Veredito: **entrada correta e atual**, sem necessidade de mudança.

Fontes:
- [Fastify releases — GitHub](https://github.com/fastify/fastify/releases)
- [Fastify v6.0.0 milestone — GitHub](https://github.com/fastify/fastify/milestone/6)
- [Long Term Support — Fastify docs](https://fastify.dev/docs/latest/Reference/LTS/)

## 4. Prisma 7.8.x — REAL, mas SUSPEITO/DESATUALIZADO a partir de 28/ago/2026

- Prisma 7.8.x é um release real e a rationale da spine ("100% TypeScript, sem engine Rust") está correta para a linha 7.x: Prisma 7 (lançado 19/nov/2025) removeu a engine Rust em favor de runtime TypeScript/WASM, com queries até 3x mais rápidas e bundles ~90% menores.
- **Alerta relevante**: **Prisma 8 atingiu GA em 28/ago/2026** — três dias antes desta revisão, e coincidentemente a mesma data do `created:` da spine. `prisma@latest` no npm já aponta para a major 8. Prisma 8 é "inteiramente implementado em TypeScript" e "substancialmente mais rápido que o Prisma 7" — ou seja, a mesma direção arquitetural da spine (sem Rust), só que uma major à frente.
- Veredito: a entrada não está errada (7.8.x existe e funciona como descrito), mas está a um passo atrás do "latest stable" no exato momento da spine — vale uma nota explícita tipo "avaliar Prisma 8 GA (28/ago/2026) antes de travar a versão na implementação", similar ao tratamento dado ao React.

Fontes:
- [Prisma ORM 7 Release — Rust-Free, Faster, and More Compatible](https://www.prisma.io/blog/announcing-prisma-orm-7-0-0)
- [The Next Evolution of Prisma ORM — Prisma blog](https://www.prisma.io/blog/the-next-evolution-of-prisma-orm)
- [Prisma 8 Roadmap — Prisma blog](https://www.prisma.io/blog/prisma-next-roadmap)
- [Prisma v8.0.0-rc.1 releases — GitClear](https://www.gitclear.com/open_repos/prisma/prisma/release/v8.0.0-rc.1-dev.25)
- [Prisma Changelog](https://www.prisma.io/changelog)

## 5. Valkey — CONFIRMADO, ainda a escolha certa

- Contexto da relicensing (Redis Inc. saiu de BSD para SSPLv1/RSALv2 em mar/2024, Linux Foundation forkou Redis 7.2.4 como Valkey sob BSD-3) permanece o pano de fundo correto.
- Desenvolvimento relevante desde então: em **maio/2025**, Redis 8 reintroduziu **AGPLv3** como terceira opção de licença — ou seja, "Redis Open Source" voltou a ser open source, mas sob copyleft forte (não a licença permissiva BSD original). Isso **não invalida** a escolha por Valkey (BSD-3 continua mais permissiva/compatível com uso comercial irrestrito do que AGPLv3), mas é um dado que a spine deveria mencionar como já resolvido/considerado.
- Adoção do Valkey continua forte e crescendo: >100M pulls no Docker Hub (17x YoY) até maio/2026; AWS ElastiCache usa Valkey 7.2 como default para clusters novos; Ubuntu 24.10+ e Debian 13+ já empacotam Valkey como `redis-server` padrão. Compatibilidade de comando com Redis permanece ~90%, com Valkey 8.x trazendo I/O multi-thread (~8% mais ops/s, ~22% menos p99 latency, ~20% menos memória).
- Nenhum sinal de estagnação do Valkey nem de motivo para reverter a decisão.
- Veredito: **"Valkey latest stable" continua a escolha correta**, com compatibilidade `ioredis`/`node-redis` como a spine assume. Nenhuma mudança necessária.

Fontes:
- [What is Valkey? A comparison with Redis — Redis blog](https://redis.io/blog/what-is-valkey/)
- [Redis vs Valkey: Features, Performance & Pricing in 2026 — Upstash blog](https://upstash.com/blog/upstash-redis-vs-valkey)
- [Redis vs Valkey in 2026: What the License Fork Actually Changed — DEV Community](https://dev.to/synsun/redis-vs-valkey-in-2026-what-the-license-fork-actually-changed-1kni)
- [Is Valkey Ready to Replace Redis in 2026? — devops-daily](https://devops-daily.com/posts/is-valkey-ready-to-replace-redis-2026)

## 6. React 19.x (patch não travado) — CONFIRMADO como decisão correta

- Última versão real no momento desta revisão: **19.2.8** (lançada 21/jul/2026); nenhuma 19.3 ou React 20 anunciada.
- O ecossistema React continua lançando patches com frequência (19.1.9 e 19.2.8 no mesmo dia, 21/jul/2026, em linhas paralelas) — confirma exatamente a preocupação da spine ("ecossistema muda rápido, não travar agora").
- Veredito: **deixar o patch em aberto foi a decisão certa**; não havia necessidade de um pin mais específico. Se quiser registrar um valor de referência para o momento da implementação, `19.2.8` é o mais recente confirmado nesta data — mas isso é só um dado de apoio, não uma correção à decisão de não travar.

Fontes:
- [Release 19.2.8 (July 21st, 2026) — GitHub](https://github.com/react/react/releases/tag/v19.2.8)
- [Release 19.1.9 (July 21st, 2026) — GitHub](https://github.com/react/react/releases/tag/v19.1.9)
- [React Versions — react.dev](https://react.dev/versions)

## Resumo — confirmado vs. suspeito

| Entrada | Status | Ação recomendada |
| --- | --- | --- |
| Node.js 24.x | Confirmado, atual | Nenhuma |
| TypeScript 6.0.3 | Confirmado, rationale ainda válida | Refinar o texto da rationale (causa raiz = falta de API programática do TS7, não "TS7 recém-lançado") e marcar para reavaliar quando TS 7.1 sair (~out/2026) |
| Fastify 5.12.x | Confirmado, atual | Nenhuma |
| Prisma 7.8.x | Real, mas uma major atrás do latest | Adicionar nota tipo "avaliar Prisma 8 GA (28/ago/2026) no início da implementação", no mesmo espírito do tratamento dado ao React |
| Valkey (latest stable) | Confirmado, decisão correta | Opcional: mencionar que Redis 8 (AGPLv3, mai/2025) não muda a escolha, para deixar registrado que foi considerado |
| React 19.x (patch deferido) | Confirmado, decisão correta | Nenhuma — a espera é a decisão certa |
