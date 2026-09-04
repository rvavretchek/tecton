---
name: 'sprint-change-proposal-2026-09-02'
type: sprint-change-proposal
target_artifacts:
  - '_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/ARCHITECTURE-SPINE.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-Tecton-2026-08-28/UML.md'
created: '2026-09-02'
status: approved
scope_classification: major
---

# Sprint Change Proposal — Tecton (2026-09-02)

## 1. Issue Summary

**Problema:** a Architecture Spine do Tecton (`status: final`, finalizada em 2026-08-28/31) não contém nenhuma Architectural Decision, fronteira de pacote ou diagrama cobrindo o lado React/frontend do produto, apesar do Brief e do PRD definirem o Tecton como framework full-stack **React.js + Node.js** desde a origem (2026-08-10).

**Como foi descoberto:** durante uma revisão de estado do projeto (2026-09-02), o assistente resumiu o passo de UX como dispensável "já que Tecton é framework backend" — uma inferência incorreta contestada pelo autor do projeto, que apontou a contradição com a definição de produto já fixada no `CLAUDE.md`.

**Evidência coletada:**
- Na spine, "React" aparece exatamente 2 vezes: como pin de versão de stack (`React 19.x`) e como item em "Deferred" (verificar patch exato) — nenhuma menção em uma Architectural Decision.
- A cadeia de dependência de pacotes (AD-3) lista só `@tecton/manifest, core, providers, directory, service-client, cli` — seis pacotes, todos backend/tooling. Nenhum pacote de frontend existe na spine.
- O `UML.md` companion tem 3 diagramas (pacotes do framework, sistema em runtime, anatomia hexagonal) — nenhum cobre frontend.
- O achado **H5** da revisão adversarial (`reviews/review-adversarial.md`) identificou ambiguidade de namespace de `i18nKey` afetando "a UI final montada pelo... `react-jsonschema-form` de FR-8", mas tratou isso como problema de i18n, sem nomear a ausência de arquitetura de frontend como causa raiz.
- O PRD (FR-8, §4.10, §6.1) está correto e completo: já especifica a geração de UI React via `react-jsonschema-form` a partir de `objectClass.attributes`, amarrada ao eixo i18n (FR-8/FR-24). O gap é exclusivo da Architecture Spine e do UML.md.

## 2. Impact Analysis

**Epic Impact:** nenhum epic existe ainda — este é o gap encontrado exatamente antes de rodar `bmad-create-epics-and-stories`. Impacto é preventivo: sem a correção, todo epic/story futuro relativo a FR-8 (geração de UI) ou às telas do Directory Service nasceria sem nenhuma AD pra se ancorar, ao contrário de toda story de backend (que amarra em AD-1 a AD-9).

**Artifact Conflicts:**
- **PRD** — sem conflito. FR-8 já correto; MVP não muda; nenhuma edição necessária.
- **Architecture Spine** — conflito real. Falta AD de fronteira de pacote de frontend, definição do escopo de scaffold de `generate domain` para frontend, e definição de onde vivem/como são hospedadas as telas do Directory Service.
- **UML.md** — falta diagrama de componente de frontend, paralelo às 3 visões de backend já existentes.
- **UX** — não executado até agora; decisão tomada nesta sessão de incluí-lo, com escopo restrito (ver Seção 4).
- **Outros artefatos** (CI/deploy/testes, `docs/aether-tecton-compatibility.md`) — sem impacto; projeto ainda pré-código.

**Technical Impact:** nenhum — nada foi implementado ainda, custo de correção agora é o menor possível (sem rollback de código ou stories).

## 3. Recommended Approach

**Selecionado: Opção 1 — Ajuste Direto**, aplicado à Architecture Spine (reabertura em modo update, escopo restrito à lacuna identificada) e complementado com um passo de `bmad-ux` que não estava planejado.

**Rationale:** o PRD já está correto e o MVP não muda (Opção 3 — Revisão de MVP — descartada como desnecessária). Não há código ou stories para reverter (Opção 2 — Rollback — não se aplica). A spine ainda não foi consumida por nenhum epic, story ou linha de código: este é o ponto mais barato possível do projeto para fechar o gap, antes que ele se propague para Epics & Stories.

**Effort:** Médio (decisões reais de design de frontend ainda por tomar — estrutura de pacote, escopo do scaffold, hospedagem das telas do Directory Service).
**Risk:** Baixo (nenhum rollback necessário; a correção é aditiva sobre uma spine ainda não implementada).
**Timeline impact:** adiciona uma iteração de arquitetura (Reviewer Gate escopado) + uma execução de `bmad-ux` antes de Epics & Stories — atraso estimado de duas sessões guiadas, evitando retrabalho maior em fases posteriores.

## 4. Detailed Change Proposals

### Architecture Spine (`ARCHITECTURE-SPINE.md`)

**Proposta A — Nova AD-10: Fronteira de pacote de frontend** — ✅ Aprovada

| | |
|---|---|
| Seção afetada | Invariants & Rules (nova AD após AD-9) + `Deferred` |
| ANTES | AD-3 amarra dependência só entre pacotes backend; "Deferred" só cita "versão de patch do React". Nenhuma regra sobre onde vive código React, como `generate domain` escafolda frontend, ou onde moram as telas do Directory Service. |
| DEPOIS | Nova AD-10 definindo: um pacote `@tecton/ui` (runtime compartilhado do renderer `react-jsonschema-form` + binding de i18n); se/como `tecton-admin generate domain` escafolda uma fatia de frontend por domínio; onde as telas do Directory Service são hospedadas. Fecha o H5 (namespace de `i18nKey`, ex. `{domain}.{key}`) como parte desta AD ou extensão da AD-6. |
| Justificativa | Sem isso, toda story de FR-8 fica sem AD para se ancorar. |

**Proposta C — Reabertura escopada do status e do Reviewer Gate** — ✅ Aprovada

| | |
|---|---|
| Seção afetada | Metadado `status` da spine + `reviews/` |
| ANTES | `status: final`; Reviewer Gate já rodado contra as 9 ADs originais. |
| DEPOIS | `status` volta a `draft` durante a adição da AD-10; ao final, novo passe do Reviewer Gate **escopado só na AD-10** (rubric walker + adversarial focado no par "domínio + frontend runtime compartilhado", mesmo método do achado H6 aplicado a componentes de UI); depois, `status` volta a `final`. Os 9 achados já resolvidos não são re-litigados. |
| Justificativa | Mantém o rigor do processo original sem retrabalho no que já foi decidido e revisado no lado backend. |

### UML.md

**Proposta B — Diagrama de componente de frontend** — ✅ Aprovada

| | |
|---|---|
| Seção afetada | Nova seção "Componentes — Frontend" |
| ANTES | 3 diagramas Mermaid, 100% backend (pacotes do framework, sistema em runtime, anatomia hexagonal). |
| DEPOIS | Novo diagrama Mermaid mostrando `@tecton/ui`, a fatia de frontend gerada por domínio (conforme decidido na AD-10), e as telas do Directory Service consumindo esse runtime. |
| Justificativa | Consistência com o restante do UML — cada AD relevante já tem representação visual. |

### UX (novo passo de plano, não uma edição de artefato existente)

**Proposta D — `bmad-ux` escopado ao Directory Service** — ✅ Aprovada

| | |
|---|---|
| ANTES | UX marcado como "não executado / dispensável". |
| DEPOIS | `bmad-ux` roda com escopo restrito: navegação em árvore de objetos (somente leitura, sem drag-and-drop — FR-8) e edição de atributos via formulário gerado. Não cobre design de marca, tema visual arbitrário ou telas de domínios de terceiros (geradas automaticamente, sem UX bespoke). |
| Sequência | Depois da correção de arquitetura (Propostas A/B/C — UX precisa da fronteira de pacote como restrição), antes de Epics & Stories. |
| Justificativa | Corrige a lacuna sem inflar escopo — UX proporcional ao que é realmente desenhado à mão vs. gerado. |

## 5. Implementation Handoff

**Classificação de escopo: Major** — a correção exige trabalho real de design arquitetural (nova AD, fronteira de pacote) e uma nova sessão de UX, não apenas reorganização de backlog (não há backlog ainda) ou implementação direta (não há código ainda).

**Roteamento:**
1. **Architect (`bmad-agent-architect` / Winston)** — reabrir `bmad-architecture` em modo update: redigir AD-10, atualizar `Deferred`, gerar o diagrama de frontend no UML.md, rodar o Reviewer Gate escopado, e restaurar `status: final`.
2. **UX Designer (`bmad-agent-ux-designer` / Sally)** — rodar `bmad-ux` com o escopo restrito definido na Proposta D, usando a AD-10 (já aprovada pelo Architect) como restrição de entrada.
3. **Depois de ambos:** retomar o fluxo original — `bmad-create-epics-and-stories` → `bmad-check-implementation-readiness` → `bmad-sprint-planning`.

**Critério de sucesso:** a Architecture Spine, ao voltar para `status: final`, deve ter pelo menos uma AD e um diagrama de componente cobrindo o lado React do framework, com a mesma cobertura de rigor (Reviewer Gate) já aplicada ao lado backend.

**Não há `sprint-status.yaml` a atualizar** (item 6.4 da checklist — N/A, projeto ainda não chegou à fase de implementação).
