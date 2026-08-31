# Constituição do Tecton

Princípios não negociáveis do projeto. Qualquer decisão de produto, arquitetura ou escopo que contradiga um destes itens precisa primeiro alterar este documento — explicitamente, com o motivo registrado — e não ser feita por atalho silencioso.

## 1. Identidade

Tecton é um framework React.js + Node.js **modular orientado a microsserviços por domínio**. Não é um monólito. "Aether" é um projeto separado do autor (framework monolítico, repositório irmão `../Aether`) — a identidade e o framing do Tecton nunca se confundem com os do Aether.

**Exceção única e explícita**: os dois projetos compartilham autor, objetivos e, por convergência independente, várias decisões de subsistema (core de identidade/diretório hierárquico, custódia de chave por limiar, postura de segurança). `docs/aether-tecton-compatibility.md` é o **único lugar sancionado** neste repositório onde Aether pode ser referenciado, para manter esses subsistemas compatíveis entre os dois projetos. Nenhum outro arquivo do Tecton (README, CLAUDE.md, brief, código) referencia o Aether além de um ponteiro para esse documento.

## 2. Monólito primeiro, sempre

Para sistemas greenfield, a melhor estratégia de desenvolvimento continua sendo monolítica. Tecton não compete com "comece em microsserviços" — ele existe para a etapa seguinte: portar um sistema que já provou seu domínio e passou a sofrer com escalabilidade, ou um legado maduro cujo domínio já é bem conhecido pelo PO. Qualquer funcionalidade que assuma um usuário começando do zero em microsserviços está fora do propósito do framework.

## 3. Dois objetivos, toda decisão de escopo passa por eles

1. **Principal**: ser um projeto de portfólio interessante.
2. **Secundário**: reduzir o tempo de desenvolvimento de migrações para microsserviços por domínio, sendo um framework facilmente manipulável por agentes de IA.

Uma funcionalidade só entra em discussão de MVP/roadmap se servir a pelo menos um destes objetivos — estar listada em `Tecton.md` não é justificativa suficiente por si só.

## 4. Nenhuma aplicação de demonstração fictícia

O framework não constrói sistemas de negócio fictícios (ex.: e-commerce, ingressos, billing) só para provar a arquitetura. Os próprios domínios embutidos (Tenant, Usuário/Grupo, Custodiante) são a prova de conceito.

## 5. Contrato declarativo em primeiro lugar

Todo domínio — embutido ou de terceiros — se declara por um manifest declarativo (YAML/JSON: eventos, contratos, dependências). O framework gera interoperabilidade a partir dele; não se escreve *plumbing* de integração manual. Esse manifest é também o contrato que um agente de IA deve conseguir ler antes de alterar qualquer serviço com segurança.

## 6. Desenhar o encaixe agora, adiar a dor depois

Para qualquer funcionalidade complexa, o MVP entrega a interface/ponto de extensão declarativo (ex.: um provider agnóstico de fornecedor). A implementação pesada de integrações externas (cofres de segredo, HSMs, PAMs etc.) pode ficar para o roadmap — desde que o encaixe já exista, para não exigir retrabalho do núcleo depois.

## 7. Segurança: nunca reimplementar, sempre integrar

O framework nunca reimplementa primitivos criptográficos (ex.: secret sharing por limiar). Funcionalidades de segurança sensíveis se apoiam em cofres/HSMs/PAMs auditados e maduros (ex.: OpenBAO, Vault Enterprise) por trás de uma interface agnóstica de fornecedor. Nenhuma alegação de segurança é feita sem rigor: "seguro e auditável" significa reforço criptográfico real (ex.: aprovação por quórum que efetivamente impede a descriptografia sem o limiar, log de auditoria encadeado/assinado) — nunca apenas um formulário de aprovação sem consequência técnica.

## 8. Idioma

Três eixos, não dois:

1. **Conversa e documentação de planejamento** do projeto (specs, PRDs, ADRs, artefatos BMAD) — Português do Brasil.
2. **Código e toda superfície voltada a dev/agente de IA** — identificadores, comentários no código, texto de ajuda de CLI (`tecton-admin --help` e saída de terminal), logs internos/de operação, documentação gerada automaticamente (ex.: OpenAPI/AsyncAPI a partir do manifest), nomes de arquivo de código — em inglês, sem exceção, quando a implementação começar. O corte não é "identificador vs. resto do código": é documentação de planejamento vs. qualquer coisa que vira parte do repositório de código/artefato entregável.
3. **Mensagens e superfícies expostas ao usuário final de um sistema construído com o Tecton** (corpo de erro RFC 9457 `title`/`detail` retornado ao cliente, UI gerada — formulários, telas do Directory Service) — multi-idioma: o framework entrega Português do Brasil como padrão e inglês como secundário nas próprias superfícies (Directory Service, boilerplate de erro), e fornece a infraestrutura de i18n (catálogo de mensagens, negociação por `Accept-Language`) para que o dev que usa o framework estenda a domínios e idiomas próprios — nunca é obrigatório para código de domínio de terceiros, só possível.

## 9. Zero Trust na comunicação interna

Nenhum serviço confia numa chamada só por ela ter vindo "de dentro da rede". Todo serviço verifica a assinatura do token de quem o chamou — gateway ou outro serviço de domínio — ele mesmo, nunca aceitando um header pré-decodificado sem verificação própria. Toda chamada serviço-a-serviço carrega uma credencial verificável, mesmo em tráfego interno. Maturidade avançada de Zero Trust (mTLS/service mesh, identidade de workload via SPIFFE/SPIRE, políticas de rede) é roadmap explícito (referência: NIST SP 800-207) — não bloqueia o MVP, mas a verificação própria por serviço não é negociável desde o início.

## 10. Open source, sem pressa

Tecton é gratuito e aberto desde o início, sem prazo e sem cliente além do próprio autor. Adoção externa e comunidade são ganhos bem-vindos, nunca critério de sucesso ou motivo para acelerar decisões de arquitetura.

## Como emendar

Mudanças a estes princípios exigem discussão explícita (ex.: nova sessão de `bmad-party-mode` ou conversa direta), com o motivo da mudança registrado no [Product Brief](_bmad-output/planning-artifacts/briefs/) ou em seu addendum — nunca uma reversão silenciosa.
