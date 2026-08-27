# Reconciliação: CONSTITUTION.md × PRD (prd-Tecton-2026-08-14)

Data: 2026-08-27
Input verificado: `CONSTITUTION.md` (10 princípios não negociáveis)
Alvo: `_bmad-output/planning-artifacts/prds/prd-Tecton-2026-08-14/prd.md`

Metodologia: cada princípio checado contra (a) contradição direta em alguma FR, e (b) presença explícita em algum lugar do PRD (Vision, Non-Goals, Success Metrics, FR). Atenção especial pedida a §5, §6 e §9.

## Resultado por princípio

### §1 Identidade (Tecton ≠ Aether) — CONFORME
Refletido explicitamente na Vision (framing próprio, sem menção ao Aether fora do ponteiro) e em Non-Goals §5 ("Tecton não é o Aether"). Nenhuma FR contradiz. Único ponto de atenção fora do escopo desta checagem: FR-8 e §6.2 citam "herdado da implementação do Aether" e "vocabulário compartilhado com o aether-admin" (FR-15/4.5) — são referências operacionais de reaproveitamento de código, não de identidade/framing, e o `CLAUDE.md` já trata isso como aceitável (subsistemas convergentes documentados em `docs/aether-tecton-compatibility.md`). Não é uma violação de §1, mas vale confirmar no doc de compatibilidade se essas duas menções (Aether-admin, drag-and-drop herdado) já estão listadas lá — não abri esse arquivo nesta checagem.

### §2 Monólito primeiro, sempre — CONFORME
Explícito em Non-Users v1 (2.2) e Non-Goals §5, ambos citando a própria Constitution §2. Nenhuma JTBD ou FR assume domínio greenfield.

### §3 Dois objetivos — CONFORME
Vision e JTBD (2.1) cobrem portfólio + redução de tempo de migração/AI-friendliness. Success Metrics (§7) operacionalizam ambos (SM-1/SM-2 para produtividade de migração, SM-3 para portfólio).

### §4 Nenhuma aplicação de demonstração fictícia — CONFORME
Explícito em Non-Goals §5, com justificativa (domínios embutidos como prova de conceito). Nenhuma FR introduz domínio de demonstração fictício.

### §5 Contrato declarativo em primeiro lugar — CONFORME, sem gap
FR-1 a FR-5 implementam o manifest como fonte única de verdade. FR-4 é explícito: "Nenhum código de integração de broker é escrito manualmente pelo dev" — linguagem quase idêntica à Constitution ("não se escreve plumbing de integração manual"). A cláusula "contrato que um agente de IA deve conseguir ler antes de alterar qualquer serviço" está na Vision e reforçada em UJ-3. Não encontrei nenhuma FR que introduza plumbing manual de integração por fora do manifest.

### §6 Desenhar o encaixe agora, adiar a dor depois — GAP PARCIAL
Bem coberto nos casos mais sensíveis:
- FR-11 (Custodiante): interface `KeyCustodyProvider` + conceito `sensitive.quorum` agora, implementação real (OpenBAO etc.) no roadmap — aplicação direta e explícita do princípio.
- `WorkflowEngineProvider`: interface prevista no MVP, motor real (Temporal) no roadmap (§6.2).
- MCP por domínio (§6.2): "o manifest já contém tudo que a geração futura vai precisar, sem preparação extra necessária agora" — confirma que o encaixe já existe.
- Dockerfile por domínio é chamado explicitamente de "seam" (§6.2) para o roadmap de CI/CD por serviço.

Onde o PRD fica silencioso sobre o "encaixe":
- **Service Discovery (FR-20)**: MVP é 100% estático via variável de ambiente. O Glossário (§3) e a §8 (API Contracts) tratam `ServiceDiscoveryProvider` como uma interface de Provider pública e estável — mas a própria FR-20 não menciona essa interface nem declara que a troca futura para descoberta dinâmica não exigirá retrabalho de núcleo. Fica implícito por analogia aos outros Providers, mas não está testável/explícito como consequência da FR-20 (diferente de FR-11, que é explícita sobre isso).
- **Circuit breaker/bulkhead (§6.2, Notes de 4.8)**: adiado para roadmap, mas a FR-26 (`ServiceClient`) não declara que seu desenho já acomoda a adição futura de circuit breaker sem exigir reescrita do `ServiceClient` ou dos call sites gerados. Comparar com FR-11, que é textual sobre "não impede o restante do framework de funcionar" — FR-26 não tem uma consequência equivalente sobre extensibilidade futura.

Recomendação: não é uma contradição, é uma lacuna de explicitação. Vale adicionar uma consequência testável em FR-20 e/ou FR-26 (ou uma nota) afirmando que a interface atual foi desenhada para acomodar a evolução futura (dynamic discovery / circuit breaker) sem quebra de contrato do Provider — replicando o padrão já usado em FR-11.

### §7 Segurança: nunca reimplementar, sempre integrar — CONFORME
FR-11 e Non-Goals §5 são explícitos e usam quase a mesma linguagem da Constitution (vault/HSM auditado, interface agnóstica de fornecedor, nunca reimplementar primitivo). FR-11 também é rigoroso quanto a "nenhuma alegação de segurança sem consequência técnica": loga aviso explícito quando roda sem proteção real, em vez de fingir segurança.

### §8 Idioma — NÃO APLICÁVEL COMO GAP
A Constitution trata idioma como convenção de processo (conversa/documentação em PT-BR, código em inglês), não como um comportamento de produto. O próprio PRD é redigido em PT-BR, em conformidade. Não é o tipo de princípio que se espera materializado como FR, Non-Goal ou Success Metric — já está fixado em `CLAUDE.md`/`_bmad/config.toml`. Não considero isso uma lacuna do PRD.

### §9 Zero Trust na comunicação interna — GAP DE CONSISTÊNCIA (o mais relevante encontrado)
FR-12/FR-13/FR-14 (Feature 4.4) cobrem bem o núcleo: verificação própria de assinatura por serviço, nunca aceitar header pré-decodificado, refresh token confinado ao Auth, revogação real via Redis. A NFR de feature em 4.4 generaliza: "Toda comunicação leste-oeste (serviço-a-serviço) segue Constitution §9 — verificação própria obrigatória, sem exceção por 'ambiente de confiança'."

Porém essa garantia vive **apenas** nessa NFR de uma única feature (4.4), e não é referenciada onde o PRD de fato especifica o mecanismo concreto de chamada serviço-a-serviço:
- **FR-26 (`ServiceClient`, Feature 4.8 Resiliência)** é a FR que descreve como uma chamada síncrona direta entre domínios (`dependencies`) é executada. Suas consequências testáveis tratam só de retry/timeout/Idempotency-Key — nenhuma menção a propagar uma credencial verificável ou a exigir que o serviço-alvo verifique a assinatura antes de processar a chamada gerada pelo `ServiceClient`. Um leitor de FR-26 isoladamente não saberia que Zero Trust se aplica ali.
- **FR-21 (eventos via CloudEvents/Redis Streams, Feature 4.6)** também é comunicação interna entre domínios (embora assíncrona) e não menciona nenhum mecanismo de autenticação/autorização do publisher perante o consumer, nem verificação de origem do evento. Zero Trust, como formulado na Constitution §9, fala de "chamada" (mais naturalmente síncrona), então isso é mais defensável como fora de escopo — mas vale uma decisão explícita registrada (mesmo que seja "eventos confiam no broker, não se aplica Zero Trust de token aqui") em vez de silêncio.
- **FR-19 (Gateway)** menciona "valida token" (entrada externa→gateway), mas não cruza explicitamente com FR-13 para deixar claro que o gateway→serviço também precisa da mesma verificação own-service (a Constitution é explícita: "gateway ou outro serviço de domínio" — ambos os remetentes precisam ser verificados pelo destinatário).

Recomendação: mover ou duplicar a garantia de §9 como uma consequência testável explícita em FR-26 (ex.: "Toda chamada emitida pelo ServiceClient carrega uma credencial verificável, e o serviço-alvo a verifica antes de processar, independentemente de vir de outro serviço ou do gateway"), e decidir/registrar a postura sobre FR-21 (eventos) em relação a Zero Trust, mesmo que a resposta seja "não se aplica, ver Open Questions". Do jeito que está, §9 é forte na feature que fala de autenticação, mas silencioso nas duas FRs que efetivamente implementam comunicação leste-oeste (síncrona e assíncrona) fora dessa feature — exatamente o padrão de risco apontado na tarefa.

### §10 Open source, sem pressa — CONFORME
Non-Goals §5 e Success Metrics §7 (SM-C1, counter-metric) são explícitos e citam a Constitution §10 diretamente. Nenhuma FR condiciona escopo a adoção externa ou prazo.

## Resumo executivo

| § | Princípio | Status |
|---|---|---|
| 1 | Identidade Tecton≠Aether | Conforme |
| 2 | Monólito primeiro | Conforme |
| 3 | Dois objetivos | Conforme |
| 4 | Sem app fictícia | Conforme |
| 5 | Contrato declarativo primeiro | Conforme |
| 6 | Desenhar o encaixe agora | Gap parcial (Service Discovery, ServiceClient/circuit breaker sem consequência testável de "encaixe futuro") |
| 7 | Nunca reimplementar segurança | Conforme |
| 8 | Idioma | N/A (convenção de processo, não de produto) |
| 9 | Zero Trust interno | Gap de consistência (garantia isolada na Feature 4.4; FR-26 e FR-21, que implementam as chamadas reais leste-oeste, não a referenciam) |
| 10 | Open source sem pressa | Conforme |

Dois gaps reais encontrados (§6 e §9); ambos são lacunas de explicitação/cross-referência, não contradições de conteúdo — o comportamento correto provavelmente já é a intenção do autor, mas não está escrito como consequência testável nas FRs que efetivamente implementam o mecanismo.
