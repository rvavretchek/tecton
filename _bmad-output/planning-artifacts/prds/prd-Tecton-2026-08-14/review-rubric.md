# PRD Quality Review — PRD: Tecton (prd-Tecton-2026-08-14)

## Overall verdict

This PRD is strong for its shape: a capability-spec for a pre-code, solo-author developer framework, calibrated correctly to "Launch" stakes. All 31 FRs carry testable consequences, trade-offs are stated with what was given up (not smoothed), and Non-Goals/Out-of-Scope are exhaustively itemized with reasons — this is a PRD an architect could source-extract from cleanly. The two things that would actually degrade its usefulness are: the primary Success Metrics (SM-1/SM-2) depend on the readiness of two sibling projects with no contingency named, and three passages (§4.2, §6.2) discuss the Aether framework's implementation beyond the single sanctioned pointer CLAUDE.md requires — a governance drift worth fixing before it compounds into the architecture doc.

## Decision-readiness — strong

Trade-offs are named with real cost, not balanced away. FR-11's consequence that a `sensitive.quorum` action **executes unprotected** when no `KeyCustodyProvider` is configured is stated as "decisão explícita: não travar velocidade de desenvolvimento no MVP" — a genuine security/velocity trade-off, not hedged. §8's versioning policy ("esses contratos podem quebrar livremente entre commits/releases") is stated as the author's explicit choice, with the cost (no deprecation policy, no transition period) named directly. §7 states outright that internal migration success outweighs public proof, and backs it with a counter-metric (SM-C1) that names what will *not* be optimized and why.

Open Questions in §9 are genuinely open — e.g., OQ4 ("decisão de motor está formalmente em aberto") and OQ5 (competitive claim not yet substantiated) have no answer smuggled into the next sentence. The two `[NOTE FOR PM]` callouts (§4.1 on manifest-version migration policy, §10 on the Custodiante roadmap item being "o item roadmap mais emocionalmente carregado") sit at real tensions, not safe checkpoints.

### Findings
- **medium** SM dependency risk not surfaced as a decision (§7, SM-1/SM-2) — Both primary Success Metrics require migrating a real domain out of **Arandu** and **Tupã**, two sibling projects outside this PRD's control. No readiness criteria, timeline, or fallback is stated for what happens if either project isn't in a migratable state when Tecton reaches feature-complete. This is exactly the kind of dependency the rubric wants surfaced as a named trade-off or Open Question, not left implicit. *Fix:* Add an Open Question or `[NOTE FOR PM]` acknowledging the external dependency and what the fallback validation path is (e.g., a synthetic/internal domain) if Arandu/Tupã aren't ready in time.

## Substance over theater — strong

No persona theater — §2.1 uses three JTBD-style bullets, not named personas, appropriate for a single-operator tool. No innovation theater — §9 OQ5 and the addendum's "Pesquisa competitiva" section actively *undercut* the differentiation claim ("por busca web, não uma auditoria exaustiva... comparativo formal continua pendente"), which is the opposite of overclaiming. NFRs are specific, not boilerplate: §4.4's feature-specific NFR names Constitution §9 verification-per-service explicitly rather than saying "must be secure." The Vision (§1) names concrete, non-swappable mechanisms (manifest, NDS/NetWare-inspired directory core, the three embedded domains) rather than generic aspirational language.

## Strategic coherence — strong

The thesis is explicit and consistent end to end: mature-monolith-with-real-scaling-pain, or well-understood-but-undocumented-legacy (§1, §2.1) → manifest + embedded domains + agent-readable contract (§1, §4.1) → validated by migrating real domains out of real monoliths (§7 SM-1/SM-2), not by activity metrics. The counter-metric (SM-C1, GitHub stars/forks) is named and explicitly rejected as a distraction from the thesis. MVP scope logic in §6.1/§6.2 traces every inclusion/exclusion back to Case 1/Case 2 or an explicit Constitution principle, not to "what's easy first."

## Done-ness clarity — strong

All 31 FRs have a "Consequences (testable)" block with concrete, verifiable conditions (e.g., FR-1: "Framework rejeita (erro de validação) qualquer domínio sem `manifestVersion`"; FR-29: "Remover ou renomear um campo existente sem criar uma nova action é o sinal de quebra que `test:contracts`/lint deve capturar"). No instances of "handles gracefully" or "user-friendly" language were found in the FR set.

### Findings
- **low** Unspecified default in FR-26 (§4.6) — "Timeout configurável por chamada, com valor padrão sensato se não especificado" gives no concrete default value or bound, unlike every other FR's consequence. This is defensible since §9 OQ1 explicitly defers performance budgets to Architecture, but the FR text itself doesn't make that deferral explicit, so a reader could mistake "sensato" for a PRD-level commitment. *Fix:* Either state the default here, or add a one-line pointer to OQ1 the way §8's versioning section points back to FR-1.
- **low** Unfalsifiable secondary metric (§7, SM-3) — "arquitetura que um revisor técnico reconheça como bem fundamentada" has no defined reviewer, rubric, or threshold. Low impact since it's explicitly Secondary and the two Primary metrics (SM-1/SM-2) are concrete. *Fix:* Either drop the qualitative clause or tie it to a concrete artifact (e.g., architecture doc review by a named external reviewer).

## Scope honesty — strong

§5 Non-Goals and §6.2 Out of Scope are unusually thorough for this stakes level: every deferred item carries a stated reason and, where relevant, traces back to a Constitution principle or a specific triage decision ("todos os itens... já passaram por triagem completa... com veredito 'roadmap' e razão registrada"). The Assumptions Index (§10) confirms zero inline `[ASSUMPTION]` tags survive in the PRD body — both candidates were resolved with the author and the roundtrip is clean. Open-item density (5 Open Questions, 0 live assumptions, 2 `[NOTE FOR PM]`) is proportionate to a pre-architecture, solo-author PRD — not inflated, not suspiciously empty.

## Downstream usability — strong

FR numbering (FR-1–FR-31) and UJ numbering (UJ-1–UJ-3) are contiguous with no gaps or duplicates. Cross-references resolve correctly in both directions: §8 explicitly closes the loop opened by FR-1's `[NOTE FOR PM]` ("Isso resolve a pendência aberta na FR-1 sobre política de migração..."), and FR-10, FR-17, FR-21, FR-26, FR-29 all reference earlier FRs (FR-7, FR-11, FR-13, FR-18, FR-19) that exist and say what's claimed. The Glossary (§3) is used consistently across features — "Custodiante," "Core de Diretório," "Manifest," "Quórum," etc. all appear with stable meaning in every section they're used. §8 correctly hands off Performance Budgets/Runtime Targets to `bmad-architecture` (§9 OQ1) rather than pretending to resolve them, which is exactly the boundary the next workflow needs respected.

## Shape fit — strong

Calibrated well to a single-operator capability spec: §2.3's three UJs are explicitly labeled "escala leve... uma frase por jornada" rather than forced into full journey maps, and Success Metrics are operational (a real migration executed) rather than user-facing engagement metrics. No over-formalization (no persona deck, no elaborate UX scenarios) and no under-formalization (the three UJs that do exist are load-bearing — UJ-3 is directly cited as the reason FR-1 through FR-5 exist). This matches the rubric's own guidance for "internal tool, single-operator role" almost exactly.

## Mechanical notes

- **medium — Aether references beyond the sanctioned pointer.** CLAUDE.md states `docs/aether-tecton-compatibility.md` is "o único lugar sancionado neste repositório para referenciar o Aether" and that other Tecton files should carry no more than a pointer to it. §5's Non-Goals entry is within bounds (it explains *why* Tecton isn't Aether and points to the compat doc for exceptions). But §4.2's FR-8 Out of Scope note ("roadmap, herdado da implementação do Aether") and §6.2's first bullet ("reaproveita implementação do Aether num release posterior, sem duplicar trabalho") assert a substantive technical fact about Aether's implementation (that it has a reusable drag-and-drop feature) rather than just pointing to the compat doc. *Fix:* Replace both with a bare pointer ("ver `docs/aether-tecton-compatibility.md`") and move the "reaproveita implementação" claim into that document if it needs to be recorded at all.
- Glossary drift: none found. Terms (Domínio, Manifest, ObjectClass, Action, Event, Quórum, Custodiante, Core de Diretório, Provider, Strangler Fig) are used consistently in case and form throughout §4–§9.
- ID continuity: FR-1–FR-31 contiguous and unique; UJ-1–UJ-3 and SM-1/SM-2/SM-3/SM-C1 contiguous; no dangling cross-references found.
- Assumptions Index roundtrip: clean — §10 lists two brief-origin assumptions, both marked resolved, and no inline `[ASSUMPTION]` tag remains in the PRD body.
- UJ protagonist naming: role-typed rather than individually named (e.g., "Dev com monólito maduro sofrendo custo de escala," "Um agente de IA"), which is appropriate given the lightweight UJ scale this PRD deliberately chose (§2.3 header).
- Required sections for a Launch-stakes capability spec are all present: Vision, Target User, Glossary, Features/FRs, Non-Goals, MVP Scope, Success Metrics, API Contracts/Versioning, Open Questions, Assumptions Index.
