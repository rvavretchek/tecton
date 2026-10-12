# Tecton ↔ Aether — Notas de Compatibilidade

> **Cópia espelhada.** A fonte de verdade deste documento vive no repositório do Aether (`../Aether/docs/aether-tecton-compatibility.md`). Se as duas versões divergirem, a versão do Aether vence, e esta cópia deve ser atualizada para igualar.
>
> Aether (`c:\Users\rvavretchek\OneDrive\Integrit\Projetos\Aether`) é o "irmão monolítico" do Tecton (orientado a microsserviços/domínio) — mesmo autor, repositório real e independente.
>
> **Regra de convivência** (ver `CONSTITUTION.md` §1 deste repositório): a `CONSTITUTION.md` do Tecton proíbe explicitamente referenciar ou confundir o Tecton com o Aether em qualquer outro arquivo deste repositório. Este documento é o único lugar sancionado onde os dois projetos se referenciam entre si.

## Política vinculante entre os dois projetos

O Boss é dono/PO/PM/diretor dos dois projetos. Consequência direta: **qualquer política aprovada de um lado que afete o outro lado vale automaticamente para os dois** — não é sugestão a reavaliar do outro lado, é a mesma decisão em dois lugares. Quem propaga (a sessão que originou a decisão) atualiza os dois arquivos na mesma janela de trabalho sempre que tiver acesso aos dois repositórios; se só tiver acesso a um, deixa uma pendência explícita registrada no Log de Sincronização abaixo até o outro lado ser atualizado.

## Log de Sincronização

Append-only — uma linha por evento, mais recente por último. `origem` é o lado onde a decisão nasceu. Este é o **único** mecanismo de status deste documento (uma tabela paralela "Status de sincronização" existiu por um instante em versões concorrentes dos dois lados e foi deduplicada aqui).

- 2026-08-10 — origem: Aether — criação do documento de compatibilidade original (convergência independente identificada: escopo, core de identidade, custódia de chave, postura de segurança).
- 2026-08-10 — origem: Tecton — espelho criado no repositório do Tecton a partir deste documento; `CONSTITUTION.md` do Tecton §1 emendada com a exceção sancionada.
- 2026-08-10 — origem: Tecton — política de compartilhamento de código decidida (impacto arquitetural + ganho real) e propagada para os dois lados.
- 2026-08-11 — origem: Aether — política vinculante cross-projeto formalizada nesta seção.
- 2026-08-11 — origem: Aether — mecanismo de status deduplicado (log único, ver nota acima); seções "Política de compartilhamento de código" e "Regra de propagação" do espelho do Tecton incorporadas ao canônico; refinamento do subsistema de Autenticação (nome `AuthProvider` sugerido como padrão a adotar do lado do Tecton) trazido de volta.
- 2026-08-11 — origem: Tecton — decisão de auth fechada: `AuthProvider` + Argon2id/Pepper adotados do Aether; refresh token confinado ao serviço de Auth; revogação via `TokenRevocationStore` Redis-backed **real já no MVP** (não seam) por já haver Redis como dependência padrão do transporte assíncrono. Convenção de nomenclatura sem prefixo de projeto formalizada para abstrações compartilháveis.
- 2026-08-11 — origem: Aether — decisão de revogação fechada: interface `TokenRevocationStore` adotada (mesmo nome, sem prefixo — compatível com o Tecton), mas Redis **continua fora do MVP do Aether** (decisão própria já fechada, o raciocínio do Tecton não se aplica aqui). Implementação MVP é Postgres/Prisma-backed. Backend Redis-backed fica previsto como opção futura da mesma interface, não implementado agora.
- 2026-08-11 — origem: Tecton — padrão de persistência da hierarquia decidido: Closure Table, por exigência explícita do autor de não travar o framework a um único banco (Postgres, MySQL, MS-SQL, Oracle suportados).
- 2026-08-11 — origem: Tecton — modelo de ACL/herança decidido: estilo NDS/Active Directory (herança + bloqueio + override) com schema desenhado em relações estilo ReBAC para permitir motor tipo OpenFGA no roadmap. Objetivo explícito do autor: intercambiável (ideal) ou ao menos compatível com o Aether. **🔔 Pedido de crítica ativo** — ver seção "Modelo de ACL/herança" acima antes de aceitar como fechado.
- 2026-08-11 — origem: Tecton — ORM revisado: Prisma adotado para os dois projetos (exigência de Oracle removida); vocabulário de CLI formalizado como igual nos dois (`new`/`generate`/`dev`/`migrate` + extensões do Tecton).
- 2026-08-11 — origem: Tecton — nome do binário fechado: `tecton-admin`/`aether-admin`, um único binário (sem estrutura de dois níveis do Django) — mais fácil de assimilar por um dev novo.
- 2026-08-11 — origem: Tecton — teste de mesa (3 cenários de migração) encontrou 2 achados: `objectClass` é opcional no manifest; framework precisa de primitivo nativo de aprovação simples (`approval`, reaproveita ACL/árvore) + interface `WorkflowEngineProvider` (roadmap, candidato Temporal) para workflow complexo, unificando o antigo coordenador de Saga. MCP por domínio decidido como 100% roadmap, zero escopo de MVP dedicado; migração assistida do Caso 1 fechada (`extract` = scaffold + fachada strangler fig + export/import único, CDC como roadmap).
- 2026-08-11 — origem: Tecton — formato de resposta/erro de API fechado: sucesso sem envelope + `traceparent` (W3C Trace Context); erro em RFC 9457 Problem Details + `invalid-params`; pendente de aprovação como `202 Accepted` dedicado. Última pergunta em aberto do documento resolvida.
- 2026-08-12/13 — origem: Tecton (pergunta originada no Aether) — Zero Trust na comunicação interna fechado: verificação de token própria por serviço + credencial em toda chamada leste-oeste no MVP (NIST SP 800-207); mTLS/service mesh e NetworkPolicies como roadmap. Virou Constitution §9 do Tecton.
- 2026-08-15 — origem: Tecton — correção: MVP do Tecton entrega a árvore do Core de Diretório como navegação/leitura, **sem** drag-and-drop (contradição com decisão anterior identificada durante o PRD). Aether constrói a UI drag-and-drop primeiro (produto mais leve, sai antes); Tecton prevê o encaixe no schema/containment mas reaproveita a implementação do Aether num release posterior, em vez de duplicar.
- 2026-08-11 — origem: Aether — modelo de ACL/herança resolvido após crítica: herança **aditiva simples** adotada para os dois projetos no MVP (permissão flui pros descendentes, sem bloqueio/override por nó — risco de opacidade identificado, contrário ao objetivo de legibilidade por agente de IA). Bloqueio/override vira extensão futura explícita. Schema ReBAC sobre Closure Table mantido sem alteração. Pedido de crítica fechado.
- 2026-08-28 — origem: Tecton — correção achada durante a sessão de Arquitetura: **Redis substituído por Valkey** em toda a stack do Tecton (Streams de eventos, rate limiting do gateway, `TokenRevocationStore`, Dev Services) — mesmo raciocínio já aplicado à troca Vault→OpenBAO (Redis Ltd. mudou de BSD-3 para SSPL/RSALv2 em 2024; Valkey é o fork BSD-3 mantido pela Linux Foundation, sem gap de feature pro uso que o Tecton faz). **Relevância pro Aether**: baixa por ora — o Aether decidiu manter `TokenRevocationStore` Postgres/Prisma-backed no MVP, sem Redis/Valkey como dependência. Pendência registrada aqui para o lado do Aether: se/quando o Aether adotar Redis-like como dependência (backend Redis-backed futuro do `TokenRevocationStore`, ou qualquer outro uso), preferir Valkey desde o início pelo mesmo motivo.
- 2026-10-06 — origem: Tecton — bancos-alvo do MVP do Tecton reduzidos para PostgreSQL e MySQL; MS-SQL vira roadmap (custo de teste alto e falta do tipo `Json` no Prisma para SQL Server). Prisma e Closure Table continuam iguais.
- 2026-10-06 — origem: Tecton — correção de versão: o Tecton fixa **Prisma 7.x**, não 8.x. O Prisma 8 ainda é release candidate (GA prevista para outubro de 2026) e não suporta MySQL; o 7.x recebe correções por 18 meses após a GA do 8. Relevante para o Aether, que usa o mesmo ORM.
- 2026-10-07 — origem: Tecton — bancos-alvo do MVP do Tecton passam a ser PostgreSQL, MariaDB e MySQL (MariaDB é o banco do laboratório compartilhado e software livre sem ressalvas; Prisma 7 o suporta oficialmente). Keycloak e OpenBAO confirmados como adaptadores opcionais de IAM/PAM e segredos depois do MVP, nunca padrão — mesma posição do Aether.
- 2026-10-08 — origem: Aether — discussão de UX do admin do Aether (reaproveitando o UX já finalizado do Directory Service do Tecton, `ux-Tecton-2026-09-03`) escalou pra uma reavaliação de arquitetura: o autor confirmou que o Aether deve migrar User/Group/Role (hoje modelos Prisma concretos, Epic 5) pro padrão "domínio = classe de objeto" do Tecton (AD-2/`DIRECTORY_OBJECT`) — **"não importa o custo, erro = retrabalho"**. Duas correções/refinamentos ao padrão do Tecton saíram dessa discussão, ver subseções novas abaixo: (1) separação objeto-em-código vs. persistência — a AD-2 do Tecton aceita perder unicidade/FK/index reais em troca do bag JSONB; o Aether mantém essas garantias reais no banco mesmo com o objeto sendo tratado de forma genérica no código — refinamento que vale propagar de volta pro Tecton; (2) Papel (Role) formalizado como objeto de primeira classe persistido nos dois projetos, nunca uma string solta (o Tecton hoje só tem `ACL_GRANT.role: string`, sem entidade própria).
- 2026-10-08 — origem: Aether — nova pergunta em aberto registrada: avaliação de IDM (Identity Management, ex.: Keycloak) não feita a fundo em nenhum dos dois projetos ainda — ver "Outras perguntas em aberto".

## Como usar este documento

- Atualizar sempre que uma decisão em um dos dois projetos afetar um subsistema listado abaixo — e adicionar uma linha ao Log de Sincronização.
- Antes de decidir algo num desses subsistemas em qualquer um dos projetos, checar aqui se o outro já decidiu algo incompatível.
- Ao abrir uma sessão em qualquer um dos dois repositórios, checar a última linha do log contra a memória/sessão anterior daquele lado — se houver entrada nova desde a última vez, revisar antes de continuar.

## O que os dois projetos já têm em comum (convergência independente)

Os dois nasceram do mesmo autor, com os mesmos dois objetivos (portfólio + redução de tempo de dev + framework manejável por IA), e chegaram **sozinhos, em sessões separadas de `bmad-party-mode`**, às mesmas ideias centrais — o que é um bom sinal de que não são caprichos isolados:

- A mesma regra de escopo: Aether chama de "teste de duas perguntas" (agrega valor real? preparável sem impactar o funcionamento atual?); Tecton chama de "desenhar o encaixe agora, adiar a dor depois". É a mesma regra, dois nomes.
- O mesmo núcleo de identidade: objetos/diretório hierárquico gerenciável por drag-and-drop, inspirado no NDS/Novell NetWare 4.1.
- O mesmo domínio de custódia de chave por limiar (estilo Shamir), multi-custodiante, com aprovação x/n para ações sensíveis.
- A mesma postura sobre segurança: nunca reimplementar primitivos criptográficos, sempre integrar com cofre auditado (OpenBAO/Vault) por trás de uma interface agnóstica de fornecedor — este princípio está explícito na Constituição do Tecton (§7) e vale igualmente para o Aether, mesmo sem estar ainda formalizado lá.

## Relação de produto: Aether como ponto de partida, Tecton como destino de migração

Esclarecido do lado do Aether (2026-08-11): o item "Distributed Evolution" do roadmap someday do Aether **não** significa o Aether ganhar arquitetura de microsserviços própria — seria redundante com o Tecton e violaria a separação de identidade dos dois projetos. Significa um caminho de migração assistida **do Aether para o Tecton** quando um projeto monolítico precisar escalar além do que o monólito aguenta. Isso encaixa diretamente na filosofia do próprio Tecton (Constituição §2: "monólito primeiro, sempre" — Tecton existe para a etapa de portar um monólito maduro). Nenhuma ação concreta agora dos dois lados — só a narrativa de produto registrada, para não ser esquecida nem reinventada de forma incompatível depois.

## Subsistemas com compatibilidade pretendida

### Core de identidade/diretório hierárquico (admin)

- **Aether:** usuário, grupo, papel, módulo/submódulo como objetos de primeira classe, com relações de contenção (pai/filho), associação (membro de) e atribuição (papel sobre). Dois tipos de recurso: permissão nomeada (MVP, real) e objeto de negócio real (contrato pronto, implementação futura). MVP entrega tela funcional sem drag-and-drop; a árvore visual completa é o próximo marco. Ver `_bmad-output/planning-artifacts/aether-mvp-vision-decisoes.md` (Aether).
- **Tecton:** o mesmo conceito, mas arquiteturalmente mais central — é o **core genérico de objeto/diretório** do framework inteiro; todo domínio embutido (Tenant, Usuário/Grupo, Custodiante) é, no fundo, uma classe de objeto declarada nesse core. **Correção de 2026-08-15**: o MVP do Tecton entrega a árvore como **navegação/leitura, sem drag-and-drop** — o Aether é produto mais leve e deve construir a UI drag-and-drop primeiro; o Tecton prevê o encaixe (schema/containment já suporta mover objeto) mas **reaproveita a implementação do Aether** num release posterior, em vez de duplicar o trabalho. **Padrão de persistência: Closure Table** (tabela ancestral×descendente) — descartados Nested Set (movimentação cara, incompatível com drag-and-drop frequente) e `ltree`/Materialized Path (prende o banco a Postgres). **Revisão de 2026-08-11**: exigência de suportar Oracle **removida** — ver decisão de ORM abaixo.
- **RESOLVIDO em 2026-10-08** (era "a trazer para o Aether"): o Aether migra User/Group/Role pro padrão "domínio = classe de objeto" — ver subseções "Separação objeto (código) vs. persistência" e "Papel como objeto de primeira classe" abaixo.

#### Modelo de ACL/herança (decidido em 2026-08-11, após crítica do lado do Aether — RESOLVIDO)

Lacuna original (real, identificada pelo Tecton): o modelo do Aether (usuário/grupo/papel com atribuição "papel sobre X") não deixava claro se a atribuição propaga pros descendentes do objeto.

Proposta original do Tecton (herança estilo NDS/Active Directory completa, com bloqueio e override por nó) foi **criticada pelo lado do Aether e revisada**: block+override por nó é historicamente uma das maiores fontes de opacidade em sistemas de permissão reais ("por que esse usuário tem/não tem acesso" exige andar a árvore inteira) — o que vai contra o objetivo de legibilidade por agente de IA que os dois projetos compartilham. Sistemas de IAM modernos (AWS IAM, GCP IAM, Kubernetes RBAC) evitam deliberadamente esse modelo por esse motivo.

**Decisão final, para os dois projetos**: herança **aditiva simples** no MVP — permissão flui pros descendentes por padrão, **sem** bloqueio/override por nó. Bloqueio/override fica como extensão futura explícita, não implementada agora. Mantido sem alteração: schema desenhado em relações estilo ReBAC (usuário─membro de─→grupo─tem papel─→objeto, objeto─contém─→objeto) sobre a Closure Table, mesmo com checagem MVP mais simples que um motor de verdade — guarda a porta aberta pra um motor tipo OpenFGA/Ory Keto no roadmap sem reformar o schema.

**Objetivo do autor mantido**: as duas implementações deveriam ser intercambiáveis (ou no mínimo compatíveis) — candidato forte a compartilhamento de código real (ver política de compartilhamento abaixo).

#### Separação objeto (código) vs. persistência (decidido em 2026-10-08, achado do lado do Aether — refina a AD-2 do Tecton)

A AD-2 do Tecton (`DIRECTORY_OBJECT` único, `attributes` como bag JSON/JSONB) aceita conscientemente um trade-off: *"unicidade/FK/index reais não são garantidos pelo banco nesses atributos, só validação de aplicação"*. Discutindo a migração do Aether pro mesmo padrão, o autor apontou que essa perda **não é uma consequência necessária** de "tudo ser objeto" — é uma escolha de implementação específica do Tecton (JSONB puro), não do padrão em si.

**Decisão para os dois projetos:** o código trata entidades administráveis (Usuário, Grupo, Papel, Tenant, Custodiante, Módulo quando aplicável) de forma polimórfica/genérica — extensível por classe, sem precisar alterar código já existente pra adicionar um tipo novo. Mas a **persistência de um campo que precisa de garantia real de banco (unicidade, FK, índice) usa coluna/constraint real**, nunca cai automaticamente num bag JSONB só porque o objeto em si é genérico. "Objeto genérico no código" e "atributo solto em JSON no banco" são duas decisões independentes — a primeira é sobre como o FRAMEWORK é estendido (classes, sem editar código original); a segunda é sobre o que cada atributo específico precisa garantir. Um objeto pode (e deve, quando fizer sentido) ter alguns atributos como colunas reais com constraint e outros como bag genérico, ao mesmo tempo.

**Ação:** Tecton reavaliar a AD-2 à luz desta separação — provavelmente querendo as mesmas garantias reais pra atributos que já sabe que precisam (ex.: nome de Tenant). Aether usa este padrão desde já na migração de User/Group/Role (Story de migração a ser criada) — forma final do schema (tabela única com colunas tipadas + extensão JSONB vs. tabela base + tabelas de extensão por tipo vs. outra abordagem) fica para uma sessão de arquitetura dedicada, não decidida aqui.

#### Papel (Role) como objeto de primeira classe, persistido, distinto de Grupo (decidido em 2026-10-08, achado do lado do Aether)

O modelo do Tecton (`UML.md`, `ACL_GRANT`) não tem um objeto "Papel" — `role` é uma string solta no grant, sem identidade própria, sem poder agrupar Recursos/permissões reutilizáveis. O Aether já tem algo mais maduro aqui (Epic 5): `Role` é uma entidade nomeada, reutilizável, que agrupa N `Resource`.

**Decisão para os dois projetos:** Papel é um objeto de primeira classe tão importante quanto Usuário/Grupo, com identidade e persistência próprias (nunca um rótulo solto num grant) — e é conceitualmente diferente de Grupo (Grupo agrupa *sujeitos*; Papel agrupa *permissões/recursos* concedidos a um sujeito). "Persistido" aqui é deliberadamente aberto ao mecanismo: banco de dados relacional é o padrão hoje nos dois projetos, mas a interface deve admitir, no futuro, um IDM externo como fonte da verdade (ver "Outras perguntas em aberto" — avaliação de IDM) — nunca arquivo JSON solto como mecanismo de persistência (rejeitado explicitamente pelo autor).

**Ação:** Tecton avalia promover `role` de string pra um objectClass `Role` próprio dentro do `DIRECTORY_OBJECT` (ou equivalente), reconciliando com `ACL_GRANT`. Aether trata `Role` como objeto de primeira classe na própria migração desta sessão.

### `objectClass` é opcional (achado do Tecton em 2026-08-11, teste de mesa)

Nem todo domínio participa do core de diretório — só quem precisa ser um objeto gerenciável na árvore (Tenant, Usuário/Grupo, Custodiante) declara `objectClass` no manifest. Domínios de negócio comuns (Catálogo, Relatórios etc.) não têm. Relevante para o Aether se/quando adotar a mesma moldura "domínio = classe de objeto".

### Aprovação de negócio e workflow complexo (decidido em 2026-08-11, achado do teste de mesa do Tecton)

Achado: nenhum dos dois projetos tinha um primitivo pra "fluxo de aprovação de negócio" comum (ex.: gerente aprova solicitação) — não deve ser confundido com o quórum do Custodiante (que é especificamente sobre custódia criptográfica de dado sensível). Decisão para os dois projetos: primitivo nativo e leve de **aprovação simples** (reaproveita o modelo de ACL/árvore — aprovador resolvido por papel + escopo, ex.: `reportingChain`), sempre disponível, sem motor externo. Para processos mais complexos (paralelismo, compensação, espera durável): interface `WorkflowEngineProvider` (sem prefixo de projeto), unificando o antigo encaixe de coordenador de Saga do Tecton — implementação via integração com motor consagrado, candidato inicial **Temporal** (SDK TS oficial, sem lock-in de nuvem, mais alinhado ao ecossistema Node que Camunda/Step Functions) — decisão final de motor em aberto, interface é o que entra agora. Candidato relevante a compartilhamento de código real, mesma lógica do modelo de ACL/herança.

### Custódia de chaves / criptografia (o item mais amadurecido do lado Tecton)

- **Tecton (mais detalhado — usar como referência):** domínio "Custodiante", opcional/plugável. Custódia de chave por limiar (estilo Shamir's Secret Sharing) — chave fica com o tenant, guardada por pelo menos 3 custodiantes, recuperável por quórum configurável (2/3, 3/3, 3/4, 4/4, 3/5...). Operação normal não depende de chamar custodiantes (auto-recuperação, referência a unseal do OpenBAO/Vault Enterprise); ações sensíveis (dump de dados, relatórios grandes/sensíveis) exigem aprovação x/n **criptograficamente forçada** (envelope encryption + quórum real, não gate de workflow) com log de auditoria encadeado/assinado. Configurável: criptografar tudo ou só campos sensíveis. Objetivo declarado: apoiar LGPD/GDPR/HIPAA. Interface de extensão: `KeyCustodyProvider`, agnóstica de fornecedor.
- **Aether (hoje, mais vago):** "criptografia seletiva + custódia múltipla de chaves + multitenant com custodiantes por tenant" — mesma ideia, bem menos especificada.
- **Ação:** a especificação do Tecton é a canônica para este domínio nos dois projetos, incluindo o nome `KeyCustodyProvider` para a interface de extensão.

### Autenticação (decidido do lado do Tecton em 2026-08-10)

- **Aether (referência original):** `AuthProvider` como abstração/adapter. MVP: local (Argon2id + Pepper). Extensível a Keycloak/OpenBAO.
- **Tecton:** adota o mesmo nome/padrão `AuthProvider` e o mesmo hashing local (Argon2id + Pepper) — sem reinventar. A diferença é topológica, não de nome: auth é centralizada mas distribuída em efeito — um serviço de Auth emite o token, o gateway valida a assinatura e propaga *claims* pros serviços de domínio via header; cada serviço confia na assinatura sem chamar o Auth de volta por request. Refresh token fica confinado ao serviço de Auth — nunca é visto pelos serviços de domínio (mais seguro, menos superfície). Revogação/blacklist: como um Redis leve já é dependência padrão do Tecton (transporte assíncrono MVP), a interface de revogação (`TokenRevocationStore`, nome sem prefixo de projeto) ganha implementação **real Redis-backed já no MVP**, não um seam adiado — o custo extra é ~zero porque o Redis já estaria lá de qualquer forma.
- **Resolvido do lado do Aether (2026-08-11):** o raciocínio do Tecton não se aplica — Redis continua fora do MVP do Aether por decisão própria já fechada. `TokenRevocationStore` é adotado (mesmo nome), com implementação MVP Postgres/Prisma-backed; o backend Redis-backed do Tecton fica previsto como opção futura da mesma interface, não implementado agora.

### Convenção de nomenclatura de abstrações compartilháveis (decidido em 2026-08-10)

Interfaces/abstrações de extensão (providers, stores etc.) **nunca levam prefixo de projeto** — nada de `TectonXxx` ou `AetherXxx`. O nome descreve o conceito (`AuthProvider`, `KeyCustodyProvider`, `TokenRevocationStore`), nunca o projeto, para que a mesma abstração possa, quando fizer sentido pela política de compartilhamento de código acima, ser literalmente reaproveitada entre os dois sem rebatizar.

### Multitenancy

- **Aether:** `tenant_id`/isolamento em todas as tabelas desde o MVP — decisão de schema, não um domínio à parte.
- **Tecton:** "Gerenciamento de Tenants" é um **domínio embutido de primeira classe** (mesmo status que Usuário/Grupo), não só uma coluna de isolamento.
- **Observação:** a diferença faz sentido dado que um é monólito e o outro é orientado a domínio — não necessariamente precisa convergir, mas os dois devem tratar tenant como objeto no mesmo core de diretório quando o Aether formalizar isso.

### ORM (decidido/revisado em 2026-08-11 — igual nos dois projetos)

**Prisma** para os dois projetos — Tecton abandona a exigência de suportar Oracle (bancos alvo confirmados: PostgreSQL, MySQL, MS-SQL) em troca de reaproveitar a mesma ferramenta do Aether, reduzindo esforço e mantendo convenção real (migrations, client gerado, schema) idêntica nos dois lados. **Extensibilidade futura para Oracle/outros bancos**: tecnicamente possível — o Prisma tem um mecanismo de *driver adapters* que permite, em tese, construir suporte a um banco não oficial — mas não existe hoje nenhum adapter (oficial ou comunitário) pra Oracle apesar de pedidos recorrentes há anos; tratar como "possível, sem esforço existente pra apoiar, não prometer prazo". Se algum dia for necessário, valeria pros dois projetos ao mesmo tempo.

### Vocabulário de CLI (decidido em 2026-08-11 — igual nos dois projetos, resolve a pergunta em aberto anterior)

Comandos: `new`, `generate <tipo> <nome...>` (aceita múltiplos nomes de uma vez — variádico, funciona de graça com expansão de chaves do shell: `generate domain financeiro materiais comercial`), `dev`, `migrate`. Tecton adiciona `test:contracts` (Contract Testing derivado do manifest) e reserva `extract` / `mcp:serve` como comandos anunciados no `--help` mas ainda não implementados (roadmap). `generate domain --from <arquivo>` fica previsto para gerar vários domínios de uma vez a partir de um arquivo de planejamento (YAML com nome+descrição por domínio) — cenário de um dev que já chega com domínios bem definidos.

**Nome do binário (decidido em 2026-08-11 — RESOLVIDO)**: `tecton-admin`/`aether-admin`, inspirado no Django, mas **sem** a estrutura de dois níveis do Django (`django-admin` + `manage.py` por projeto) — um único binário faz tudo (`tecton-admin new`, `tecton-admin generate ...`, `tecton-admin dev`, etc.). Motivo explícito do autor: mais fácil de assimilar por um dev novo — aprende um nome só e descobre o resto via `tecton-admin --help`, sem precisar entender por que existem dois comandos diferentes.

## Política: compartilhamento de código vs. conceitual (decidido em 2026-08-10)

Compartilhar código entre os dois projetos **só quando as duas condições se cumprirem**:

1. **Sem impacto arquitetural** — não força acoplamento entre um projeto monolítico (Aether) e um orientado a microsserviços por domínio (Tecton); a peça precisa ser genuinamente neutra de arquitetura de execução.
2. **Ganho real para o projeto** — redução de esforço e padronização que favoreça componentização, não compartilhamento por elegância.

Candidato mais próximo de cumprir as duas condições: o core de objeto/diretório hierárquico + as interfaces `KeyCustodyProvider`/`AuthProvider`/`TokenRevocationStore` — são abstrações de infraestrutura, não amarradas a monólito-vs-microsserviços. **Candidato mais forte de todos (2026-08-11): o modelo de ACL/herança** — objetivo explícito do autor é que sejam intercambiáveis entre os dois projetos, não só compatíveis. Decisão concreta de virar pacote compartilhado fica pra quando o código de fato existir dos dois lados o suficiente pra avaliar as duas condições com evidência, não suposição.

### Zero Trust na comunicação interna (decidido em 2026-08-12/13, originado por uma pergunta do autor no Aether)

Achado real: a formulação de auth do Tecton ("cada serviço confia na assinatura sem chamar o Auth de volta") era ambígua entre verificação criptográfica própria (seguro) e confiança implícita num header pré-decodificado por "estar na rede interna" (inseguro). **Decisão MVP, para os dois projetos**: todo serviço verifica a assinatura do token ele mesmo, sempre; toda chamada serviço-a-serviço carrega credencial verificável — "nunca confiar, sempre verificar" (referência: **NIST SP 800-207**), a custo quase zero. **Roadmap** (maturidade avançada, deliberadamente cara): mTLS/service mesh (Istio/Linkerd ou SPIFFE/SPIRE); Kubernetes NetworkPolicies como parte do item já existente de Kubernetes Native no Tecton. Princípio virou Constitution §9 do Tecton. Relevância pro Aether: menor (é monólito, sem múltiplos saltos internos), mas o princípio "nunca confiar em input só por origem" vale igual pro canal front-back.

### Formato de resposta e erro de API (decidido em 2026-08-11 — igual nos dois projetos, resolve a última pergunta em aberto)

Se existe padrão consolidado, adota-se em vez de inventar. **Sucesso**: payload puro, sem envelope. **Correlação**: header `traceparent` (W3C Trace Context — mesmo padrão do OpenTelemetry, sem inventar `requestId` próprio). **Erro**: **RFC 9457 "Problem Details for HTTP APIs"** (`type`/`title`/`status`/`detail`/`instance`) + extensão de comunidade `invalid-params` para erro de validação por campo. **Pendente de aprovação** (ação sensível/quórum, inclusive via MCP): não é erro — `202 Accepted` dedicado, corpo `{ status: "pending_approval", requestId, pollUrl }`.

## Outras perguntas em aberto

### Avaliação de IDM (Identity Management) — nenhum dos dois projetos chegou lá ainda (registrado em 2026-10-08)

`AuthProvider` já cita Keycloak como alvo de extensibilidade desde a decisão original de autenticação, mas **nenhum dos dois projetos avaliou de fato IDM/IAM externo** — Keycloak apareceu como placeholder/suposição inicial, nunca uma decisão comparativa real. O autor observou que Keycloak pode não ser a opção mais adequada pra um ambiente multi-tenant especificamente, e levantou alternativas open source a considerar quando essa avaliação acontecer: **ZITADEL, Ory (Kratos/Hydra), Logto, Casdoor, Authentik** (além do próprio Keycloak).

**Nota para quando qualquer um dos dois projetos (Aether ou Tecton) discutir IDM de verdade:** avaliar opções **open source e gratuitas** explicitamente — não assumir Keycloak por ser o primeiro nome citado/mais conhecido. Isso é relevante tanto pro `AuthProvider` (autenticação) quanto pra decisão de onde Papel/Usuário/Grupo são persistidos de fato (ver seção "Papel como objeto de primeira classe" acima) se um IDM externo vier a ser a fonte da verdade em vez do banco local.
