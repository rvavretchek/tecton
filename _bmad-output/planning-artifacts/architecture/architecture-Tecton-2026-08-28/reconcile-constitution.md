# Reconciliação Constitution vs. Architecture Spine

Data: 2026-09-01
Fontes: `CONSTITUTION.md` (10 princípios) vs. `ARCHITECTURE-SPINE.md` (2026-08-28, atualizada 2026-08-31)

## §7 — Segurança: nunca reimplementar, sempre integrar

**Verificado: respeitado, sem contradição.**

- AD-2 coloca o Custodiante dentro de `@tecton/directory`, mas a spine nunca descreve uma implementação de secret sharing/threshold crypto — trata isso como atributo declarativo (`objectClass.attributes`) mais um Provider (`KeyCustodyProvider`, citado no diagrama hexagonal da seção "Design Paradigm" e no Capability Map).
- A seção **Deferred** é explícita: "Implementação real do `KeyCustodyProvider` (integração OpenBAO) — PRD roadmap; a interface e a exigência de interceptação no nível de dado (FR-11) já estão fixadas." Isso é exatamente o padrão exigido pelo §7 (interface agnóstica de fornecedor agora, integração com cofre maduro depois) e também casa com AD-6 da própria Constitution (§6, "desenhar o encaixe agora, adiar a dor depois").
- A tabela **Stack** não lista nenhuma biblioteca de criptografia própria/threshold — só Argon2id é citado (hashing de senha, adaptador de borda no diagrama hexagonal), o que é primitivo padrão de biblioteca madura, não "reimplementação de criptografia" no sentido do §7.
- Nenhuma AD sugere construir HSM/PAM/secret-sharing in-house.

**Conclusão:** nenhum gap. AD-2 + Deferred respeitam o §7 corretamente.

## §8 — Idioma (3 eixos)

**Verificado: os três eixos aparecem corretamente refletidos, com uma lacuna textual pequena (não uma contradição).**

- **Eixo 1** (planejamento em PT-BR): a própria spine é escrita em Português do Brasil, incluindo nomes de AD, texto de regras e a tabela de convenções — consistente por construção, não precisa de uma AD dedicada.
- **Eixo 2** (código/dev-facing em inglês): AD-6 cita explicitamente "CLI, logs internos e comentários de código ficam fora desse eixo — inglês, sempre (Constitution §8, eixo 2)". A tabela **Consistency Conventions** reforça com a linha "Cross-cutting (log interno) | Inglês, sempre (Constitution §8, eixo 2)".
  - **Gap textual menor**: a linha "Naming (pacotes, arquivos)" da mesma tabela (classes PascalCase, funções/variáveis camelCase, arquivos kebab-case) não declara explicitamente que os *nomes* (identificadores) devem estar em inglês — só descreve a convenção de *casing*. A Constitution §8 eixo 2 é explícita que identificadores entram no eixo 2 ("O corte não é 'identificador vs. resto do código'"). A spine não contradiz isso (nada sugere identificadores em PT-BR), mas a tabela de convenções deixa essa exigência implícita em vez de explícita — vale considerar adicionar "em inglês" à linha de naming para fechar o eixo 2 por completo na única tabela que existe pra isso.
- **Eixo 3** (mensagens end-user multi-idioma): AD-6 é dedicada a isso — RFC 9457 `type` neutro de idioma, `title`/`detail` negociados por `Accept-Language`, `i18nKey` como extensão de lookup de máquina, catálogo i18n obrigatório. A tabela reforça: "Cross-cutting (mensagem exposta) | i18n, PT-BR padrão + EN secundário (AD-6)". Isso corresponde exatamente ao texto do §8 eixo 3 (PT-BR padrão + EN secundário nas próprias superfícies do framework, infraestrutura disponível pro dev estender).

**Conclusão:** nenhuma contradição encontrada. Nada na spine endossa código/logs em não-inglês nem endossa texto end-user apenas em inglês. Único ponto de polimento: explicitar "inglês" na linha de naming da tabela de convenções, para que a tabela cubra os 3 eixos de forma autocontida sem depender de inferência a partir de AD-6.

## §9 — Zero Trust na comunicação interna

**Verificado: AD-7 (texto) é suficiente e correto; o diagrama do Structural Seed tem uma lacuna de representação que pode ser lida como contradição, mas não é uma contradição na regra escrita.**

- O texto de AD-7 é forte e cobre exatamente os dois riscos do §9: (1) nunca aceitar header pré-decodificado sem verificação própria, e (2) nunca decidir autorização a partir de claim repassado por outro serviço mesmo que a chamada de origem já tenha sido autenticada (confused deputy) — isso vai além do texto literal da Constitution e fecha uma brecha que o §9 não nomeia explicitamente. AD-7 também nomeia o Directory Service como sujeito à mesma regra, coerente com AD-2 (Directory não é uma exceção de confiança, só de persistência).
- **Lacuna identificada**: o diagrama mermaid do "Structural Seed" mostra apenas `Gateway -.->|valida token| AuthSvc` — nenhuma seta equivalente sai de `DomainA`, `DomainB` ou `Directory` em direção a um verificador de token. Um leitor que só olhar o diagrama (sem ler o texto de AD-7) pode concluir que a validação acontece uma vez, no Gateway, e que o restante da malha "confia" na chamada já ter passado pelo gateway — exatamente o antipadrão que o §9 e a própria AD-7 proíbem.
  - Isso **não é uma contradição na regra** (o texto de AD-7 é explícito e vinculante, e diagramas de Structural Seed nesta spine são ilustrativos de topologia de deploy, não de fluxo de autorização), mas é uma lacuna de comunicação: o único diagrama de sistema da spine não visualiza o invariante mais crítico de segurança (§9) sendo aplicado em cada aresta, só numa. Vale nota para a próxima revisão do diagrama: adicionar a mesma anotação "valida token (self)" nas arestas Gateway→DomainA, Gateway→DomainB, Gateway→Directory (e nas chamadas síncronas DomainA→DomainB via ServiceClient) para que o desenho não seja lido como "validação centralizada no gateway".
  - Nota lateral (fora do escopo do §9, mas na mesma aresta): `Gateway -.->|rate limit, fail-open| Valkey` — "fail-open" é uma escolha de resiliência/disponibilidade, não uma violação de Zero Trust em si (rate limiting não é autenticação), mas indica que se o Valkey cair, o rate limit desaparece. Não contradiz §9 (que é sobre confiança de identidade, não sobre rate limit), citado aqui só por aparecer na mesma seta de anotações do diagrama.

**Conclusão:** nenhuma contradição na regra (AD-7 é suficiente e até mais rigorosa que o texto mínimo do §9). Gap é de representação visual: o diagrama do Structural Seed não desenha a verificação própria em cada salto, só no Gateway→AuthSvc, o que pode ser mal interpretado isoladamente do texto de AD-7.

## §1 — Fronteira de identidade Aether

**Verificado: sem gap. Zero menções.**

- Busca por "Aether" na spine inteira: nenhuma ocorrência, nem como ponteiro nem como referência direta.
- Isso está em conformidade estrita com o §1 (Aether só pode ser referenciado em `docs/aether-tecton-compatibility.md`) — a spine simplesmente não toca no assunto, o que é uma forma válida de cumprir a regra (a regra não exige que todo documento inclua um ponteiro, só proíbe menções fora do lugar sancionado).

**Conclusão:** nenhum gap.

---

## Resumo de gaps/confirmações

1. **§7 — confirmado, sem gap.** AD-2 + Deferred tratam Custodiante/KeyCustodyProvider como interface agnóstica de fornecedor com integração real (OpenBAO) adiada — exatamente o padrão exigido.
2. **§8 — confirmado nos 3 eixos, com 1 gap textual menor.** AD-6 e a tabela Consistency Conventions cobrem eixo 2 (logs/CLI/comentários) e eixo 3 (i18n end-user) explicitamente citando a Constitution. Gap: a linha "Naming (pacotes, arquivos)" não declara "em inglês" explicitamente, deixando o eixo 2 para identificadores implícito em vez de explícito na única tabela dedicada a convenções.
3. **§9 — regra confirmada como suficiente; gap de diagrama.** O texto de AD-7 cobre corretamente Zero Trust e até fecha o caso de "confused deputy". Gap: o diagrama mermaid do Structural Seed só anota verificação de token na aresta Gateway→AuthSvc, sem repetir a anotação nas arestas Gateway→DomainA/DomainB/Directory nem nas chamadas síncronas entre domínios — pode ser lido isoladamente como validação centralizada, contradizendo a leitura pretendida de AD-7.
4. **§1 — confirmado, sem gap.** Nenhuma menção a Aether na spine, dentro ou fora do lugar sancionado.
