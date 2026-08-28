---
title: Review — Edge Case Hunter — PRD Tecton
status: draft
created: 2026-08-27
---

# Review Edge-Case-Hunter — PRD Tecton (2026-08-14) + Addendum

Metodologia: caminhamento exaustivo de toda ramificação e condição de fronteira presente nas "Consequences (testable)" das 31 FRs e nas interações declaradas entre FRs. Reporta apenas ramos **não tratados** — nenhum item abaixo já está coberto por Non-Goals (§5), Out of Scope (§6.2) ou Open Questions (§9) do PRD.

Cada item: **FR(s) envolvidas** — condição/ramo não tratado — por que importa.

---

## 1. Ação sensível/aprovação (FR-3, FR-11, FR-25)

**1.1 — FR-11 × FR-25: contradição entre "executa normalmente" e "sempre pendente"**
FR-11 declara que, sem `KeyCustodyProvider` configurado, uma action `sensitive.quorum` **executa normalmente** (retorno imediato, com aviso de log). FR-25 declara que uma action `sensitive.quorum`/`approval` pendente **sempre** retorna `202 Accepted` com `pending_approval`. Nenhuma FR resolve qual dos dois comportamentos prevalece quando `sensitive.quorum` é invocada sem provider: o cliente recebe o payload de sucesso direto (FR-11) ou um 202 que nunca vai resolver porque não há provider para aprovar o quórum (FR-25)? São dois comportamentos mutuamente exclusivos descritos como testáveis, sem árbitro.

**1.2 — FR-3: `sensitive.quorum` e `approval` combinados na mesma action**
FR-3 descreve as duas flags como alternativas ("pode marcar `sensitive.quorum`... ou `approval`"), mas nenhuma consequence valida que uma action não pode ter as duas simultaneamente, nem define a semântica caso tenha (quórum e aprovação de negócio na mesma invocação — que ordem, um único estado pendente ou dois?). Ramo implícito do enum de flags não coberto.

**1.3 — FR-3/FR-25: resolução de uma aprovação NEGADA**
As consequences cobrem apenas a transição "chamada → estado pendente" (FR-3) e a distinção sintática entre "falhou" e "está pendente" no momento da chamada inicial (FR-25). Nenhuma consequence descreve o que acontece quando a aprovação/quórum pendente é **rejeitada** posteriormente — é reportado como erro RFC 9457 (FR-24) ao consultar o `pollUrl`, silenciosamente descartado, ou outro estado? Falha o próprio caso de uso principal de um fluxo de aprovação (aprovar OU rejeitar).

**1.4 — FR-25: ausência de TTL/expiração do estado pendente**
Nenhuma consequence define expiração, timeout ou garbage collection de um `requestId`/`pollUrl` pendente. Um pedido de aprovação sem aprovador disponível (ACL vazia) ou nunca respondido fica pendente indefinidamente, sem sinalização de erro nem de expiração — comportamento não testável como está escrito.

**1.5 — FR-25 × FR-24: schema de resposta do `pollUrl` ao longo do ciclo de vida**
FR-25 só especifica o corpo da resposta **inicial** (`202` com `status: "pending_approval"`). Nada define o formato de resposta ao consultar o `pollUrl` (a) enquanto ainda pendente, (b) quando resolvido com sucesso, (c) quando resolvido com falha/rejeição, nem (d) o código/formato quando o `requestId` é desconhecido ou expirado (404? RFC 9457?). Sem isso, "distinguir programaticamente pendente de falhou" (a consequence declarada) só vale para a resposta inicial, não para o polling em si.

---

## 2. Migração assistida — `extract` (FR-16)

**2.1 — Roteamento percentual vs. corte único de dados**
FR-16 oferece roteamento por "rota/percentual/flag" no gateway, mas também declara que o corte de dados é **uma operação única** sob janela de manutenção, sem sincronização contínua. Roteamento por **percentual** pressupõe coexistência prolongada dos dois sistemas recebendo tráfego real simultaneamente — o que diverge os dados dos dois lados, já que não há sync contínuo. Nenhuma consequence resolve essa incompatibilidade: roteamento percentual só é seguro para tráfego de leitura, nunca para o mesmo domínio com estado mutável dividido, mas isso não está dito em lugar nenhum.

**2.2 — Drenagem de requisições em voo no instante do corte**
Nenhuma consequence descreve como requisições já em andamento contra o domínio antigo, no exato momento em que a janela de manutenção começa, são tratadas (aguardadas, abortadas, ou aceitas com risco de dado perdido no corte). É o modo de falha central de qualquer corte único de dados e não tem tratamento declarado.

**2.3 — Decomissionamento da fachada e do domínio antigo**
O padrão Strangler Fig (citado no Glossário) pressupõe que a fachada e o código legado são eventualmente removidos após a migração completar. Nenhuma FR (nem FR-16, nem FR-17/lint) declara um critério ou processo para decomissionar a rota antiga/fachada — o MVP só cobre a criação da coexistência, nunca sua finalização.

---

## 3. Eventos assíncronos (FR-4, FR-21)

**3.1 — Ordem entre a chave de dedup e o efeito do handler**
FR-21 declara handler "idempotente por design (chave de dedup)", mas não define **quando** a chave é registrada em relação ao processamento. Se registrada antes do efeito colateral e o handler falha no meio, a mensagem é considerada processada e nunca reprocessada (perda de efeito). Se registrada depois e o handler falha após aplicar o efeito mas antes de persistir a chave, o reprocessamento duplica o efeito. Esse é o modo de falha central de idempotência via chave de dedup e não está coberto por nenhuma consequence.

**3.2 — Mensagem "poison" / falha repetida de processamento**
Com at-least-once + ordem garantida por stream, uma mensagem que falha repetidamente no processamento bloqueia a entrega de toda mensagem subsequente daquele stream (comportamento típico de consumer groups). Nenhuma consequence descreve dead-letter, reentrega com backoff, ou qualquer mecanismo de "destravar" o stream.

**3.3 — Destino de evento rejeitado por credencial inválida**
FR-21 declara que "um evento consumido sem credencial verificável do publisher é rejeitado pelo consumidor" — mas não define se isso conta como ACK (mensagem removida do stream, perdida) ou NACK (broker reentrega indefinidamente, quebrando o fluxo com a mesma mensagem sempre rejeitada).

**3.4 — Agrupamento de tipos de evento no mesmo stream**
FR-21 garante ordem "dentro de um stream (por domínio)". FR-4 permite múltiplos `events.publishes` distintos por domínio. Não fica definido se eventos de tipos diferentes do MESMO domínio (ex.: `UserCreated` e `UserRoleAssigned`) compartilham um único stream (preservando ordem causal entre eles) ou vão para streams separados por tipo de evento (quebrando a ordem causal apesar de serem do mesmo domínio) — a redação "por domínio" sugere a primeira leitura, mas nenhuma consequence testa isso.

---

## 4. Evolução de contrato (FR-18, FR-29)

**4.1 — Mudança de tipo de campo existente não é enumerada**
A consequence de FR-29 enumera "remover ou renomear um campo existente" como o sinal de quebra que `test:contracts`/lint deve capturar. Uma terceira forma clássica de quebra — **mudar o tipo** de um campo existente sem removê-lo ou renomeá-lo (ex.: `string` → `number`) — não está na lista, e não há consequence confirmando que `test:contracts` (FR-18) de fato captura esse caso.

**4.2 — Vida útil da action antiga após criar uma nova versão explícita**
FR-29 resolve mudança incompatível criando uma nova action explícita (`createTenantV2`). Nenhuma FR define o que acontece com a action antiga: se ela precisa continuar functional indefinidamente (dado que não há política de depreciação formal antes do v1.0, per §8), e `test:contracts` não testa se as duas versões permanecem mutuamente consistentes ou se a antiga foi de fato descontinuada — abrindo espaço para drift silencioso entre `createTenant` e `createTenantV2`.

---

## 5. Core de Diretório e domínios embutidos (FR-6, FR-7, FR-9)

**5.1 — Prevenção de ciclo ao mover um objeto na árvore**
FR-6 declara que mover um objeto é "uma operação localizada (linhas do nó movido)". Nenhuma consequence cobre o caso de mover um nó para dentro de um dos seus próprios descendentes (criando um ciclo na Closure Table) — cenário clássico de fronteira de estruturas hierárquicas mutáveis, sem validação declarada.

**5.2 — Efeito do status do Tenant sobre ACL/acesso**
FR-9 introduz três estados de Tenant (`active`/`suspended`/`archived`) como um conjunto fixo, mas nenhuma FR (nem FR-7, que define resolução de ACL) declara o efeito de enforcement de `suspended` ou `archived` sobre o acesso aos objetos descendentes daquele tenant — os dois estados não-`active` são ramos implícitos do enum sem comportamento definido em nenhuma consequence testável.

---

## 6. Autenticação, gateway e resiliência (FR-14, FR-19, FR-22, FR-26)

**6.1 — Indisponibilidade do `TokenRevocationStore` (Redis fora do ar)**
FR-14 testa apenas o caminho feliz (token revogado torna-se inválido dentro do tempo de propagação do Redis). Não há consequence para o Redis do `TokenRevocationStore` estar inacessível no momento da checagem — decisão crítica de postura Zero Trust (falhar aberto, tratando como "não revogado", ou falhar fechado, rejeitando toda requisição) fica indefinida.

**6.2 — Indisponibilidade do Redis de rate limiting no gateway**
FR-19 lista rate limiting via Redis como responsabilidade do gateway. Nenhuma consequence cobre o comportamento do gateway (que é a porta de entrada de todo tráfego) quando esse Redis está inacessível — permitir tudo sem limite ou rejeitar tudo é uma decisão de disponibilidade vs. proteção não declarada em um componente descrito como "fino" e crítico.

**6.3 — Config presente porém inválida (não apenas ausente)**
FR-22 declara falha rápida para configuração "incompleta/inválida", mas a única consequence testável cobre a variável **faltando**. O ramo "variável presente com valor de formato/tipo incorreto" (ex.: uma URL malformada, um número não numérico) — explicitamente citado no texto da própria FR como "inválida" — não tem consequence equivalente.

**6.4 — Classificação de action como "idempotente por natureza" não existe em nenhum manifest**
FR-26 permite retry automático para "ação idempotente por natureza" além de mutação com `Idempotency-Key` explícito. Nenhuma FR do Manifest Declarativo (FR-1 a FR-5) define um campo ou convenção para declarar que uma action é idempotente por natureza — o `ServiceClient` depende de uma classificação que não tem onde ser expressa no `tecton.yaml`.

---

## 7. Manifesto multi-domínio (FR-1, FR-2)

**7.1 — Validação cross-manifesto de `containment.allowedParents`**
FR-2 valida que um domínio com `objectClass` precisa de `containment.allowedParents`, mas cada domínio tem seu próprio `tecton.yaml` e pode viver em repositório/serviço distinto. Nenhuma consequence cobre a validação de `lint` quando `allowedParents` referencia um `objectClass` declarado em **outro** domínio cujo manifesto não está disponível/acessível no momento do lint local — checagem referencial cross-domínio fica em aberto.

---

## 8. Formato de erro (FR-24)

**8.1 — Cobertura de erros não relacionados a validação de input**
FR-24 declara que "toda resposta de erro" segue RFC 9457, mas a única consequence testável cobre a extensão `invalid-params` para erro de validação de `input`. Não há consequence confirmando que erros de outra natureza (autorização negada, recurso não encontrado, erro interno) também produzem o formato base RFC 9457 (`type`/`title`/`status`/`detail`/`instance`) sem o campo `invalid-params` — o principal modo de falha de um formato de erro "universal" (cobrir os erros que não são de validação) não é exercitado por nenhuma consequence.

---

**Total: 16 itens (24 sub-casos numerados) distribuídos em 8 áreas.**
