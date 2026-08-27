---
title: Addendum — PRD: Tecton
status: draft
created: 2026-08-27
updated: 2026-08-27
---

# Addendum: PRD Tecton

Conteúdo de mecanismo/detalhe técnico levantado na reconciliação de inputs do PRD (2026-08-27) que aprofunda o `prd.md` mas não cabe no corpo do documento — PRD descreve capacidade, este addendum guarda o "como" e o contexto que motivou a decisão.

## ConfigProvider — candidato de roadmap (mecanismo)

A FR-22 registra que o `ConfigProvider` do MVP é env vars/`.env` com validação tipada no startup. O candidato de roadmap para um config server real é **OpenBAO**, não Vault — mesma lógica já aplicada ao `KeyCustodyProvider` (FR-11): OpenBAO entrega o mesmo núcleo do Vault Enterprise, de graça, como fork open source mantido pela Linux Foundation desde a mudança de licença da HashiCorp em 2023. **AWS Parameter Store/Secrets Manager** é alternativa opcional para quem já vive em AWS, atrás da mesma interface `ConfigProvider` — não é um segundo caminho arquitetural, é só outra implementação da mesma interface agnóstica de fornecedor.

## Custodiante — interceptação no nível de dado (alerta de segurança)

Alerta do especialista de segurança convidado à sessão de fundação (Vex), registrado no addendum do Product Brief e agora reforçado na FR-11: a interceptação de uma ação `sensitive.quorum` **precisa acontecer no nível de acesso ao dado, não apenas no nível de rota HTTP**. Um middleware restrito a uma rota específica pode ser contornado por outro serviço, por um script de manutenção, ou por acesso direto ao banco — qualquer um desses caminhos ignoraria o quórum se a proteção só existisse na camada HTTP. Isso não muda o escopo do MVP (a implementação real do Custodiante continua roadmap), mas restringe desde já o design aceitável do `KeyCustodyProvider`: qualquer implementação futura precisa interceptar no nível de acesso ao dado (ex.: camada de repositório/ORM, não middleware de framework web).

Mecanismo completo já fechado (Product Brief, addendum de 2026-08-10, seção "Detalhamento técnico: domínio Custodiante"), para quando a implementação real sair do roadmap:
- Guarda por limiar entre custodiantes: mínimo de 3, quórum configurável (2/3, 3/3, 3/4, 4/4, 3/5, 4/5, 5/5... até um limite razoável).
- Operação normal (indisponibilidade/recuperação) não depende de acionar custodiantes a cada incidente — precisa se auto-recuperar, à semelhança do *unseal* do OpenBAO/Vault Enterprise.
- "Seguro à prova de balas e auditável" significa aprovação **criptograficamente forçada**: envelope encryption por recurso/lote, chave de dado embrulhada pela chave mestra do tenant, só desembrulhável combinando o quórum real de fragmentos — mais log de auditoria encadeado/assinado (hash-chain), pra que nem um admin com acesso total consiga reescrever o histórico. Um gate de workflow simples (aprovação clicada, sem reforço criptográfico) foi descartado como insuficiente.
- Decisão de engenharia confirmada (Vex + Amelia + autor): não reimplementar Shamir's Secret Sharing na unha — o domínio Custodiante é uma camada de integração + workflow declarativo sobre um cofre auditado existente (candidato inicial OpenBAO; outros candidatos Vault Enterprise, HSMs), nunca o cofre em si.

## Custodiante — motivação regulatória (framing)

A FR-11 generaliza a motivação do domínio Custodiante para "custódia de chave por limiar" sem nomear os regimes regulatórios que a justificam. Para contexto de quem for implementar: o domínio existe para apoiar conformidade com **LGPD, GDPR e HIPAA** — ações sensíveis configuráveis (dump de dados, download de relatórios grandes ou de dados muito sensíveis) exigem aprovação x/n dos custodiantes especificamente porque esses regimes exigem controle de acesso multi-parte sobre dado sensível/pessoal em escala. A chave de criptografia fica com o tenant/empresa, nunca com o fornecedor do framework — decisão de zero-trust explicitamente validada pelo Vex na sessão de fundação.

## Pesquisa competitiva — status pendente

O Product Brief registra uma pesquisa comparativa inicial (2026-08-11) contra Moleculer.js, Dapr e NestJS microservices module, concluindo que nenhum dos três oferece (1) ferramental de migração assistida a partir de monólito real, (2) core de objeto/diretório hierárquico com *drag-and-drop*, ou (3) domínio de custódia de chave por limiar embutido — e que a diferenciação central do Tecton é tratar um agente de IA como consumidor de primeira classe do manifest de domínio, eixo em que nenhum dos três concorrentes se posiciona.

Essa pesquisa foi **por busca web, não uma auditoria exaustiva de cada ferramenta** (limite honesto já registrado no brief) — o PM (John) alertou que, antes de qualquer alegação pública de diferenciação, é preciso um comparativo técnico escrito mais profundo. Esse comparativo formal **continua pendente** — não foi feito até o fechamento do PRD (2026-08-27). Rastreado como Open Question §9 do PRD.
