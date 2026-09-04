---
name: 'review-adversarial-ad10'
type: architecture-review
target: '_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md#AD-10'
scope: 'AD-10 apenas — AD-1..AD-9 já revisadas em review-adversarial.md (H1-H9), não repetidas aqui'
method: 'adversarial pair construction — dois pares de unidades um nível abaixo, cada uma obedecendo a letra de toda Rule de AD-10 (e de qualquer AD que ela toque — AD-1, AD-3, AD-6, AD-7, AD-8, AD-9), ainda assim divergindo do que o "Prevents" de AD-10 alega evitar'
created: '2026-09-02'
---

# Adversarial Review — AD-10 (`@tecton/ui`, runtime compartilhado de frontend)

Método idêntico ao da revisão anterior (`review-adversarial.md`), aplicado só a AD-10: para cada Rule dentro de AD-10, construir um par concreto de unidades (dois times de dev contra `@tecton/ui`, a SPA admin do próprio Directory Service vs. uma UI de domínio de negócio construída à mão que importa tokens per a permissão explícita de AD-10, etc.) que respeitam a letra de toda Rule envolvida e mesmo assim colidem. Verificação adicional pedida pela tarefa: (a) a porta `UiThemeProvider` se comporta como uma porta Hexagonal de verdade sob AD-1, ou tem o mesmo tipo de brecha do H6 anterior (duas portas bespoke incompatíveis pro mesmo conceito)? (b) uma UI de domínio de negócio que importa tokens de `@tecton/ui` pode acabar precisando de algo de `@tecton/directory` diretamente, tentando uma violação de AD-9?

Total de achados: **6** (H10–H15, numeração continua a partir de H9 da revisão anterior).

---

## H10 — Duas instâncias de `@tecton/ui` dentro da mesma SPA admin escapam do "único ponto de consolidação" que a Rule do i18nKey promete

**Par:** dentro da própria SPA admin do Directory Service, o módulo de tela do Tenant e o módulo de tela do Custodiante são desenvolvidos por dois squads diferentes do mesmo time de plataforma, cada um montando sua própria árvore `Core + UiThemeProvider` (dois pontos de entrada/mount independentes na mesma SPA — padrão comum quando telas são carregadas sob demanda ou via micro-frontend interno).

**Onde a Rule permite isso:** Rule 1 exige que "todo consumidor importa, nenhum reimplementa" — ambos os squads importam `@tecton/ui`, nenhum reimplementa o binding schema→formulário. Rule 4 diz que o namespace `<domínio>.<chave>` é "reforçado no ponto único onde catálogos de mensagem são consolidados para renderização — o próprio `@tecton/ui`" — mas nada na Rule exige que a SPA inteira instancie `@tecton/ui` (seu `Core`/`UiThemeProvider`) uma única vez. Nada impede dois pontos de montagem independentes, cada um sendo, por si só, "o próprio `@tecton/ui`" rodando isoladamente.

**Por que isso quebra:** o texto da Rule 4 justifica sua existência dizendo "Fecha H5" (a colisão de namespace `error.notFound` entre dois domínios da revisão anterior). Mas H5 era sobre colisão *entre* domínios gerados separadamente; aqui a colisão é *dentro* do próprio Directory Service, entre dois módulos que compartilham o único namespace permitido pelo exemplo dado (`directory.*`, já que os três objectClasses embutidos vivem todos sob o mesmo pacote `@tecton/directory` — não há uma AD que subdivida `directory.tenant.*` de `directory.custodian.*`). Se os dois squads cunham `directory.error.notFound` para dois erros semanticamente diferentes (Tenant não encontrado vs. Custodiante não encontrado) em duas instâncias `@tecton/ui` separadas que nunca compartilham cache de catálogo, cada instância "fecha H5" ao pé da letra (nenhum de seus próprios catálogos colide internamente) mas o produto final, quando as duas telas aparecem juntas na mesma SPA (ex.: notificação toast global lendo de ambos catálogos), tem duas mensagens divergentes sob a mesma chave — exatamente a ambiguidade que H5 apontava, sobrevivendo intacta um nível abaixo da granularidade que a Rule cobre.

---

## H11 — `UiThemeProvider` é um registro de slots, não uma porta Hexagonal única — um slot pode furar o isolamento dos outros dois

**Par:** dois overrides de Camada 1 dentro do mesmo projeto: um dev substitui só o slot `ScreenLayout` (para um layout de dashboard customizado); outro dev, meses depois, substitui só o slot `ObjectTreeView` (para uma árvore com drag-and-drop). Cada um, isoladamente, cumpre a Rule ao pé da letra: "registro de slots... substituíveis um a um; o que não for substituído cai no default da Camada 0."

**Onde a Rule permite isso:** AD-1 exige que "o núcleo [de domínio] nunca importa um pacote de infraestrutura concreta diretamente" — só a porta. AD-10 reivindica "mesmo padrão Hexagonal já aplicado a `AuthProvider`/`ConfigProvider`". Mas `AuthProvider`/`ConfigProvider` são portas de *concern único* (uma interface, uma responsabilidade). `UiThemeProvider` é, pela própria definição da Rule, um *registro* de três concerns distintos (árvore, formulário, layout) sob uma única porta nomeada. Nada na Rule exige que a implementação de um slot (`ScreenLayout` customizado) delegue de volta pro `Core`/porta para renderizar seus elementos internos (ex.: a árvore de navegação lateral que o layout precisa desenhar) — o dev que escreve `ScreenLayout` customizado pode simplesmente importar e renderizar sua própria árvore inline, em vez de invocar o slot `ObjectTreeView` resolvido pela porta.

**Por que isso quebra:** o `ScreenLayout` customizado passa a decidir, silenciosamente, como a árvore aparece dentro dele — sem que ninguém tenha "substituído" o slot `ObjectTreeView` (que continua no default da Camada 0, e é usado em qualquer outro lugar do app que o invoque diretamente). Resultado: a mesma tela mostra dois comportamentos de árvore diferentes dependendo de qual slot foi tocado por último — precisamente o cenário do H6 anterior (duas portas bespoke incompatíveis pro mesmo conceito), só que aqui não são dois domínios com duas portas nomeadas diferentes; é uma única porta nomeada (`UiThemeProvider`) cuja composição interna não é garantida pela Rule. Uma porta Hexagonal de verdade (como `AuthProvider`) não tem esse problema porque não há sub-portas aninhadas que um adaptador possa contornar re-implementando por conta própria — `UiThemeProvider`, por empacotar três concerns sob um registro só, tem.

---

## H12 — "Importar tokens" (Rule de Escopo) não tem fronteira de pacote que impeça a UI de domínio de negócio de importar tipos de `@tecton/directory` diretamente, tentando furar AD-9

**Par:** a SPA admin do Directory Service (dentro de `@tecton/directory`) vs. uma UI de domínio de negócio `Faturamento`, construída à mão pelo dev, que — per a permissão explícita da Rule ("`@tecton/ui` fica disponível como import opcional pro dev que queira reusar os tokens de tema numa UI própria por fora do Core de Diretório") — importa `@tecton/ui`.

**Onde a Rule permite isso:** a Rule descreve a intenção ("reusar os tokens") mas não estabelece uma fronteira de pacote que force esse reuso a ser só-tokens (não existe, por exemplo, um subpacote `@tecton/ui-tokens` separado do `Core`/`UiThemeProvider`/defaults de Camada 0). O pacote `@tecton/ui` exporta tudo junto (UML §1.4: `Core`, porta, defaults). Nada em AD-3 proíbe uma UI de domínio de negócio (que não é um pacote `@tecton/*`, é código do dev) de declarar `@tecton/directory` como dependência direta — AD-3 só rege dependências *entre pacotes do framework*; e o único import de `@tecton/directory` explicitamente proibido pela spine é o do Gateway (AD-8/AD-10: "Gateway... nunca importa `@tecton/directory` nem `@tecton/ui`"). Nenhuma Rule proíbe código de domínio de negócio de importar `@tecton/directory`.

**Por que isso quebra:** o dev de `Faturamento`, ao querer reusar o `ObjectTreeView`/`AttributeForm` de `@tecton/ui` para exibir um seletor de Tenant/Usuário embutido na própria tela (não só os tokens CSS — a Rule não impede tecnicamente esse import mais amplo, só o desaconselha em prosa), naturalmente quer tipar esse seletor contra o shape real do `objectClass` de Tenant. O caminho de menor resistência é `import type { TenantObjectClass } from '@tecton/directory'` para pegar essa definição — que é permitido pela letra de AD-9 (que fala de "domínio" acessando banco/código de "outro domínio"; `@tecton/directory` não é modelado como um "domínio" gerado, é um pacote do framework, então nem AD-9 nem AD-3 o cobrem nesse sentido) e pela letra de AD-3 (que só restringe pacotes `@tecton/*` entre si, não domínio-de-negócio → `@tecton/directory`). Resultado: `Faturamento` termina acoplado ao código-fonte interno de `@tecton/directory` para tipagem, exatamente o tipo de acoplamento direto que AD-9 existe para evitar ("nunca import direto de código... de outro domínio, Directory Service incluído") — só que a spine nunca fecha esse caminho porque a redação de AD-9 pressupõe que o import direto vem de outro *domínio gerado*, não de uma UI de negócio consumindo `@tecton/ui` do jeito que a própria Rule de AD-10 recomenda.

---

## H13 — "Gateway só roteia pra `/admin`" não diz se as chamadas de API da SPA (depois de carregada) também passam pelo Gateway — ambiguidade que apaga Zero Trust/rate-limit pra tráfego admin

**Par:** duas implementações da mesma Rule de hospedagem. Time A: a SPA em `/admin` faz todas as chamadas de API (CRUD de Tenant/Usuário) para o mesmo host/path que o Gateway expõe, então elas passam pelo Gateway como qualquer outra chamada (AD-7 primeira linha, rate limit do diagrama). Time B: como a SPA já sabe seu próprio `baseUrl` (é servida pelo próprio `@tecton/directory`), as chamadas de API que ela faz depois de carregada vão direto pro host interno do Directory Service, sem reatravessar o Gateway — só o carregamento inicial do HTML/assets estáticos passou pelo roteamento do Gateway.

**Onde a Rule permite isso:** o texto diz "O Gateway só roteia pra esse path a partir do manifest... nunca importa `@tecton/directory` nem `@tecton/ui`." Isso descreve o que o Gateway faz com o *path* `/admin` (roteamento do shell/assets), mas não especifica se as chamadas subsequentes de API feitas pelo JavaScript já carregado no browser são, elas também, obrigadas a atravessar esse mesmo roteamento. Ambos os times cumprem a letra: o Gateway "roteia pra `/admin`" nos dois casos — a Rule nunca menciona tráfego de API pós-carregamento.

**Por que isso quebra:** no cenário do Time B, a superfície administrativa (a mais sensível do sistema — Tenant/Usuário/Custodiante) passa a não se beneficiar do rate limiting descrito no diagrama (`Gateway -.->|rate limit, fail-open| Valkey`), porque esse rate limit está amarrado ao Gateway, e o Time B contornou o Gateway pro tráfego real. AD-7 ainda é cumprida tecnicamente (Directory verifica a assinatura do token ele mesmo, sempre, não importa por onde a chamada chegou) — mas a spine em outro lugar chama a validação do Gateway de "primeira linha, não a única" (nota de rodapé do diagrama runtime), implicando que ela deveria sempre estar no caminho. AD-10 nunca fixa isso para o path `/admin` especificamente, deixando uma divergência de postura de segurança real (rate-limit presente vs. ausente) totalmente compatível com a letra da Rule de hospedagem.

---

## H14 — Camada 0 promete "nunca exige escrever componente", mas não fixa contrato estável de nomes de token entre o consumidor embutido (co-versionado) e o consumidor externo (import opcional)

**Par:** a SPA admin do Directory Service (bundlada dentro de `@tecton/directory`, portanto sempre publicada na mesma versão de `@tecton/ui` que ela consome — mesmo release do monorepo do framework) vs. a UI de domínio de negócio `Faturamento` (import opcional per a Rule de Escopo, versionado independentemente via `package.json` do dev, podendo ficar defasada).

**Onde a Rule permite isso:** "Customização de identidade visual é só sobrescrever tokens — nunca exige escrever componente" — mas a Rule não define uma lista fixa/versionada de nomes de custom property que compõem "o tema completo", nem invoca AD-4 explicitamente para esse contrato (AD-4 fala de código gerado que importa pacote, não de estabilidade de superfície pública de um pacote entre versões).

**Por que isso quebra:** se uma versão futura de `@tecton/ui` renomear um token (ex.: `--tecton-color-primary` → `--tecton-color-brand-primary`, uma refatoração plausível de design system), a SPA bundlada nunca percebe quebra — ela é publicada e atualizada junto com o `@tecton/ui` novo, sempre em lockstep. Já `Faturamento`, que fixou seu CSS de override contra os nomes antigos (per a permissão explícita da própria Rule de Escopo), quebra silenciosamente ao atualizar `@tecton/ui` sozinho — sem quebrar nenhuma Rule (ela só "sobrescreveu tokens", nunca escreveu componente). O "nunca exige escrever componente" é cumprido pelos dois; a estabilidade que o dev de fora precisaria para confiar nisso a longo prazo não é uma garantia que a Rule realmente compromete.

---

## H15 — A restrição de escopo de `objectClass` é uma convenção de política do PRD, não um limite técnico em `@tecton/ui` — o import opcional da própria Rule permite contorná-la

**Par:** o Directory Service (único titular legítimo de `objectClass`, per PRD Glossário §3) vs. um domínio de negócio `Pedidos`, gerado via `tecton-admin generate domain` (100% backend, sem scaffold de frontend, conforme a Rule) mas cujo dev, insatisfeito com não ter UI gerada, usa o import opcional de `@tecton/ui` que a própria Rule de Escopo concede ("`@tecton/ui` fica disponível como import opcional pro dev que queira reusar os tokens de tema numa UI própria... não é geração automática pra domínio de negócio").

**Onde a Rule permite isso:** o núcleo de `@tecton/ui` (per UML §1.4) faz "binding schema→formulário" via `react-jsonschema-form` — uma biblioteca que funciona sobre qualquer JSON Schema, não sobre um tipo `objectClass` tecnicamente distinto e verificado. Nada na Rule (nem no `Core` descrito na UML) impede o dev de `Pedidos` de pegar o JSON Schema do *seu próprio* manifest (`tecton.yaml`, que já existe pra validação de `dependencies`/actions) e alimentá-lo diretamente no `Core` de `@tecton/ui` — usando exatamente o import opcional que a Rule concede — obtendo uma tela auto-gerada de formulário pro seu domínio de negócio, coisa que a Rule diz explicitamente que "não é" pra acontecer.

**Por que isso quebra:** a "consequência" que a Rule declara ("`tecton-admin generate domain` continua 100% backend, sem scaffold de frontend algum") é verdadeira só sobre o que o *CLI* gera — não é uma restrição técnica dentro de `@tecton/ui` que rejeite schemas não vindos de um `objectClass` real do Directory. O "Prevents" de AD-10 lista "a spine tratando o lado React do produto como um detalhe de stack" como o que a Rule evita — mas ao mesmo tempo abre, na sua própria Rule de Escopo, o caminho de importação que permite o dev fazer exatamely o schema→tela que o escopo alega reservar ao Directory. Ou o escopo de `objectClass` é reforçado tecnicamente em algum ponto que a spine nunca descreve (contradizendo "sem scaffold de frontend algum" ser garantia arquitetural, não só ausência de comando de CLI), ou o limite é só uma convenção de mercado que qualquer dev com o import opcional já concedido pode ultrapassar sem violar uma letra sequer de AD-10.

---

## Resumo por severidade

| # | Par | Tipo de falha |
| --- | --- | --- |
| H15 | Domínio de negócio `Pedidos` usando o próprio import opcional da Rule | Restrição de escopo central da AD é política, não técnica — o próprio texto da Rule abre o caminho que ela diz fechar |
| H12 | UI de `Faturamento` (import opcional) + `@tecton/directory` | Loophole de fronteira de pacote — tenta AD-9 via tipo importado, não coberto por AD-3 nem AD-9 |
| H13 | SPA admin (Time A vs. Time B) + Gateway | Ambiguidade de hospedagem que pode apagar Zero Trust/rate-limit no tráfego admin pós-carregamento |
| H11 | Dois overrides de slot (`ScreenLayout` vs. `ObjectTreeView`) na mesma SPA | `UiThemeProvider` não é uma porta Hexagonal de concern único — slot pode furar isolamento dos outros |
| H10 | Dois módulos de tela (Tenant vs. Custodiante) na mesma SPA | Namespace de `i18nKey` só fecha colisão entre domínios gerados, não entre instâncias `@tecton/ui` dentro do próprio Directory |
| H14 | SPA bundlada (co-versionada) vs. UI externa (import opcional, versão independente) | Camada 0 não tem contrato de token estável entre os dois modos de consumo que a própria Rule distingue |
