---
name: 'review-adversarial'
type: architecture-review
target: '_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md'
method: 'adversarial pair construction — two units one level down, each AD obeyed to the letter, yet incompatible'
created: '2026-08-31'
---

# Adversarial Review — Architecture Spine (Tecton)

Método: para cada AD, construir um par concreto de unidades (dois domain services, ou domain service + gateway, ou domain service + Directory Service) que respeitam o texto literal de TODA Rule do spine e, mesmo assim, colidem. O objetivo não é achar violação — é achar onde a Rule, como está escrita, *permite* a divergência que o "Prevents" dela alega evitar.

Total de achados: **9** (7 pares adversariais AD-a-AD, 1 achado transversal, 1 buraco dedicado AD-2/atributo — o pedido explícito da tarefa).

---

## H1 — AD-7 (Zero Trust): verificar a assinatura não é o mesmo que confiar só em claims auto-extraídos

**Par:** `Gateway` (gerado, "fino, sem lógica de negócio") + domínio de negócio `Faturamento` (gerado via `generate domain`).

**Cenário:** Gateway recebe o JWT, verifica a assinatura (AD-7 cumprida) e, por conveniência/performance, também decodifica o token e repassa `X-Tenant-Id`/`X-User-Id` como headers para o domínio a jusante — nada no spine proíbe isso, e é o padrão natural para um gateway "fino". `Faturamento` também verifica a assinatura do JWT ele mesmo, de forma independente (AD-7 cumprida ao pé da letra: "verifica a assinatura... ele mesmo, sempre"). Mas para a decisão de autorização em si (qual tenant, qual escopo), `Faturamento` lê `X-Tenant-Id` do header pré-decodificado pelo Gateway, não o claim do próprio token que acabou de verificar.

**Onde a Rule permite isso:** o texto de AD-7 diz literalmente "verifica a assinatura do token/credencial ele mesmo" — não diz "usa exclusivamente os claims que ele mesmo extraiu do token verificado para qualquer decisão de autorização". Um serviço pode fazer a verificação de assinatura pro forma (só para "carimbar compliance") e ainda assim tomar a decisão real de negócio a partir de um header pré-decodificado de outro serviço — exatamente o cenário que o "Prevents" da própria AD-7 diz que quer evitar ("um serviço confiando num header pré-decodificado"). A Rule fecha a verificação de assinatura, mas não fecha o uso do dado derivado dela.

**Por que isso quebra:** um atacante que comprometa (ou apenas tenha bug em) o Gateway pode forjar `X-Tenant-Id` sem invalidar a assinatura do JWT — `Faturamento` "verificou" o token, mas autorizou com base no header, reintroduzindo o confused deputy que Zero Trust deveria eliminar.

---

## H2 — AD-5 (UUID v7): "é uma string UUID v7" não fixa codificação nem algoritmo de geração, e isso quebra exatamente a ordenação que a AD existe para proteger

**Par:** `Directory Service` (dono da Closure Table, ordenação por `id` entre Tenant/Usuário/Grupo) + qualquer domínio de negócio publicando eventos CloudEvents consumidos/mesclados num mesmo feed de auditoria.

**Cenário A (encoding):** a Rule diz "todo identificador... é uma string UUID v7" mas não fixa representação textual canônica (caixa, hífens, RFC 4122 vs. Base32/Crockford). Directory canonicaliza para lowercase hifenizado; um domínio gerado por outro dev serializa em uppercase (ou usa uma lib que emite sem hífen para URLs). Ambos são, tecnicamente, "uma string UUID v7" — mas joins/lookups por igualdade de string entre o domínio e a Closure Table falham silenciosamente se algum ponto do pipeline não normalizar.

**Cenário B (ordenação, mais grave):** o RFC 9562 permite múltiplos métodos de preenchimento do componente sub-milissegundo (contador monotônico vs. randomização pura) dentro da própria definição de UUID v7. O spine nunca pina uma lib/estratégia única. Dois serviços gerando UUID v7 "corretos" e 100% conformes à Rule podem, mesmo assim, produzir IDs que não preservam ordem cronológica estrita quando intercalados de origens diferentes no mesmo milissegundo — que é *literalmente* o motivo declarado da AD-5 ("Prevents: ...quebrando... ordenação da Closure Table"). A Rule cumprida ao pé da letra não impede o problema que ela mesma existe para prevenir.

---

## H3 — AD-3 (direção de dependência): a Rule só liga pacotes `@tecton/*`, não domínios gerados — dois domínios podem se importar diretamente sem violar nada

**Par:** domínio `Pedidos` e domínio `Estoque`, ambos gerados via `tecton-admin generate domain` no mesmo workspace pnpm/Turborepo do dev.

**Cenário:** AD-3 lista explicitamente o `binds` como `@tecton/manifest, core, providers, directory, service-client, cli` — os seis pacotes do framework. `Pedidos` e `Estoque` não são pacotes do framework; são código do dev. Nada em AD-3 impede `Pedidos` de declarar `Estoque` como dependência de workspace e importar diretamente o tipo `Order` de `Estoque` (ou vice-versa), em vez de usar o `ServiceClient` gerado. A única convenção que toca nisso é "Persistência por serviço... nunca acesso direto a banco de outro domínio" — que fala de banco, não de código/tipos. Dois domínios podem, portanto, compartilhar (e divergir sobre) a forma de uma entidade sem que nenhuma Rule ou Convention seja violada ao pé da letra, produzindo acoplamento direto de código e duas definições da "mesma" entidade que podem divergir silenciosamente a partir do primeiro merge.

---

## H4 — AD-4 (importa, nunca copia): cobre o pacote do framework, não o código de scaffold gerado inline — drift entre domínios gerados em versões diferentes é 100% compatível com a Rule

**Par:** domínio `Contratos` (gerado com `@tecton/core@0.9.x`) e domínio `Pagamentos` (gerado meses depois, `@tecton/core@1.3.x`, após o formato de envelope de evento ou a lógica de publicação CloudEvents mudar internamente no core).

**Cenário:** AD-4 exige só que o scaffold declare `@tecton/*` como dependência versionada e que nenhum comando do CLI grave *código-fonte do pacote do framework* no repo do dev. Isso não cobre o código de cola específico do domínio que o próprio `tecton-admin generate` escreve inline no repo do dev (handlers, publicação de evento, wiring de validação) — esse código não é "pacote do framework", é "scaffold do domínio", então gravá-lo lá não viola AD-4. Resultado: `Contratos` carrega para sempre a lógica de publicação de evento da época em que foi gerado (v0.9), `Pagamentos` tem a versão v1.3. Ambos "importam, nunca copiam" `@tecton/core` ao pé da letra — mas o comportamento efetivo de publicação diverge entre os dois, e não existe no spine nenhum mecanismo de re-geração/detecção de drift para scaffolds já emitidos (o item mais próximo no "Deferred" é sobre versão de patch do React, não sobre isso).

---

## H5 — AD-6 (i18n): o limite de "texto voltado a usuário final" é ambíguo sobre dado dinâmico vs. template estático, e não há convenção de namespace para `i18nKey`

**Par:** domínio `Onboarding` e domínio `Suporte`, ambos expondo RFC 9457 Problem Details.

**Cenário 1:** `Onboarding` trata como "texto de usuário final" apenas os templates estáticos de erro (i18n-catalogados, conforme AD-6). Valores dinâmicos vindos de dado de domínio (ex.: rótulos de um enum configurado pelo tenant, nomes de campos customizados) ele deixa hardcoded em um idioma, argumentando que "isso é dado, não texto de UI" — a Rule diz "todo texto voltado a usuário final usa chave de catálogo i18n", mas não define se rótulo dinâmico-vindo-de-dado conta como "texto". `Suporte` faz a leitura oposta e catalogiza tudo. Ambos alegam compliance literal; a UI final (montada pelo Gateway/formulário `react-jsonschema-form` de FR-8) fica com uma mistura inconsistente de idiomas dependendo de qual domínio gerou o campo.

**Cenário 2:** nenhuma Rule ou Convention exige namespace por domínio para `i18nKey`. `Onboarding` e `Suporte` podem ambos cunhar a chave `error.notFound` com textos-fonte diferentes; ao consolidar catálogos (algo que o Directory precisa fazer para renderizar formulário unificado, FR-8) as chaves colidem silenciosamente — sem violar a letra de AD-6.

---

## H6 — AD-1 (Hexagonal): a Rule garante que o núcleo só depende de portas, não que as portas do mesmo conceito sejam a mesma interface entre domínios

**Par:** domínio `Notificações` e domínio `Cobrança`, ambos precisando de cache.

**Cenário:** cada um define seu próprio port `CacheProvider` no núcleo — `Notificações` com `get(key): Promise<string>`, `Cobrança` com `fetch(key): Promise<Buffer>`. Os dois são 100% hexagonais: o núcleo de cada um só importa a própria porta, nunca uma implementação concreta (Valkey) diretamente. AD-1 não exige (nem menciona) que as portas para o mesmo conceito venham de um catálogo compartilhado — isso só aparece implicitamente no Capability Map, associando `@tecton/providers` a "interfaces de Provider + implementações de referência", mas AD-1 em si não obriga o uso dessa interface compartilhada, só exige *alguma* porta. Resultado: dois serviços plenamente conformes ao AD-1, sem nenhuma interoperabilidade de adaptador entre eles — o oposto do que se espera de um "framework".

---

## H7 — Duplo dono do mesmo atributo: Directory Service (fonte da verdade) vs. domínio de negócio (cópia local persistida)

**Par:** `Directory Service` (dono canônico do objectClass `Usuário`, atributo `preferredLanguage`/telefone) + domínio `Faturamento` (precisa do telefone do usuário para nota fiscal, denormaliza-o na própria tabela por performance/disponibilidade offline).

**Cenário:** "Persistência por serviço" permite explicitamente que `Faturamento` tenha seu próprio banco. Nada nas Rules impede `Faturamento` de armazenar uma cópia de um atributo que já é canonicamente dono do Directory (ele só precisa não acessar o banco do Directory diretamente — e ele não acessa, ele guarda a própria cópia). Não há Rule ou Convention exigindo que domínios que denormalizam um atributo do Directory se inscrevam nos eventos de atualização (`events.consumes`) para manter a cópia sincronizada — é só uma prática recomendada implícita no diagrama Valkey Streams, nunca uma Rule vinculante. Resultado: dois "donos" do mesmo dado, sem mecanismo de consistência obrigatório, plenamente compatível com a letra do spine.

---

## H8 — Achado transversal: "compliance literal" cria drift de versão de framework sem nenhuma Rule de re-sync (relacionado a H4, mas separado: afeta manifest/contratos, não só scaffold)

`Contratos` gerado contra `@tecton/manifest@0.x` e `Pagamentos` contra `@tecton/manifest@1.x` podem, cada um, ter uma versão de manifest (`manifestVersion`) diferente — o próprio PRD (§8, citado no source do spine) admite "nenhuma política formal [de migração entre versões do manifest] pré-v1.0". A spine herda essa lacuna sem qualificá-la: AD-3 fixa a direção de dependência entre pacotes do framework, mas não a compatibilidade de manifests entre domínios de gerações diferentes rodando lado a lado no mesmo Gateway. Isso não é per se uma violação de nenhuma AD — é um Deferred implícito que deveria estar explícito na seção "Deferred" e não está.

---

## H9 — O BURACO PRINCIPAL: AD-2 não explica o mecanismo pelo qual um atributo declarativo novo vira uma mudança de schema real num serviço que o dev não pode editar

**Pedido específico da tarefa — resposta: SIM, é um buraco genuíno, não estilístico.**

A Rule de AD-2 diz: "customização só por `objectClass.attributes` declarativo" — e trata isso como se fosse suficiente. Mas:

1. **AD-2 fecha as duas saídas óbvias.** Um dev que precise de um atributo genuinamente novo no `Usuário` (ex.: `cpf` com constraint de unicidade, indexado, ou uma FK para um domínio próprio) normalmente resolveria isso editando o schema Prisma do serviço dono do dado. AD-2 proíbe explicitamente as duas formas de fazer isso: (a) `generate domain` está proibido para Tenant/Usuário/Grupo/Custodiante ("nunca via `tecton-admin generate domain`"), e (b) o código-fonte do Directory "vive sempre dentro do pacote `@tecton/directory`" — um pacote do framework que, por AD-4, não pode ter seu código-fonte gravado/editado dentro do repo do dev. O dev literalmente não tem onde editar um `schema.prisma` para adicionar a coluna.

2. **O spine não diz qual modelo de storage o Directory usa para atributos declarados, e as duas opções plausíveis falham de formas diferentes:**
   - Se o schema por trás de `objectClass.attributes` for **relacional fixo** (colunas reais por atributo, migradas via Prisma) — então customização "declarativa" exigiria uma migration real rodando contra o banco do Directory, e não há nenhum mecanismo descrito (nem no spine, nem no PRD — conferido: FR-6/FR-7/FR-8) que gere/aplique essa migration a partir do YAML do dev num pacote cujo código-fonte ele não possui. `tecton-admin migrate` (FR-15) "roda migrations Prisma" — mas migrations Prisma vivem junto do schema Prisma, que por AD-2 mora dentro de `@tecton/directory`, não no repo do dev.
   - Se for **EAV/JSONB genérico** (schema-less, plausível dado o vocabulário LDAP-like "objectClass") — aí sim a adição é puramente declarativa e sem migration. Mas então o dev **não consegue** ter o que o cenário adversarial pede (unicidade indexada, FK, constraint real a nível de banco) — a "customização declarativa" tem um teto funcional silencioso que o spine nunca admite. Isso contradiz a suposição implícita de que atributos de objectClass suportam qualquer necessidade de dado do domínio.

3. **Evidência de que o PRD também não resolve isso:** FR-8 (revisado) só garante que o *formulário de UI* (`react-jsonschema-form`) reflete automaticamente um atributo novo "sem código de UI escrito à mão" — isso é sobre renderização de formulário, não sobre persistência. FR-7 menciona que o "schema de relações permite evoluir para um motor externo (ex. OpenFGA) sem migração de dados" — mas isso é sobre o grafo de ACL/hierarquia (Closure Table), não sobre os atributos arbitrários do objectClass em si. Nenhum FR ou Open Question (§9) trata do mecanismo atributo-declarativo → schema-real. A Open Question §9-2 chega perto (escopo de criptografia por atributo do Custodiante) mas é sobre outra coisa.

4. **Consequência prática:** o dev que precisa de um atributo com garantia de banco real (não só um campo solto num JSON) fica sem caminho documentado. Ou o Directory Service silenciosamente usa JSONB e a "customização" nunca oferece integridade referencial/unicidade — um limite que devia estar em "Deferred" e não está — ou existe um mecanismo de geração de migration contra um serviço "pré-construído" que o spine nunca descreve, violando na prática o espírito de AD-4 (framework não grava código dentro do repo do dev) ou o espírito de AD-2 (dev nunca edita lógica interna do Directory).

**Recomendação:** este item deveria estar na seção "Deferred" com o mesmo tratamento dado a `KeyCustodyProvider`/`WorkflowEngineProvider` (interface fixada, implementação real adiada) — no mínimo, a spine devia declarar explicitamente qual dos dois modelos de storage (relacional migrado vs. EAV/JSONB) o Directory usa, porque isso muda o que "customização declarativa" pode e não pode prometer ao dev.

---

## Resumo por severidade

| # | Par | Tipo de falha |
| --- | --- | --- |
| H9 | Directory Service + dev que adiciona atributo | Mecanismo ausente — bloqueia caso de uso central do produto |
| H1 | Gateway + domínio de negócio | Loophole de Zero Trust — reabre confused deputy |
| H2 | Directory Service + domínio publicando eventos | Loophole — quebra a garantia que a própria AD existe para proteger |
| H7 | Directory Service + domínio que denormaliza atributo | Dois donos, sem Rule de consistência |
| H3 | Domínio A + Domínio B (acoplamento direto) | Rule com escopo estreito demais (só pacotes do framework) |
| H4 | Domínio gerado em versões diferentes do framework | Drift não coberto por nenhuma Rule nem Deferred |
| H5 | Domínio A + Domínio B (i18n) | Ambiguidade de escopo + falta de namespace |
| H6 | Domínio A + Domínio B (Provider bespoke) | Rule cumprida sem interoperabilidade real |
| H8 | Domínio A + Domínio B (versão de manifest) | Deferred implícito não declarado |
