---
title: UML — Tecton
status: draft
created: '2026-08-31'
updated: '2026-09-02'
companion_of: 'ARCHITECTURE-SPINE.md'
---

# UML — Tecton

Diagramas complementares à [ARCHITECTURE-SPINE.md](ARCHITECTURE-SPINE.md). A spine fixa os invariantes (ADs); este documento mostra a forma — componentes, fluxos críticos e o modelo de dados do Core de Diretório. Renderiza nativamente em qualquer visualizador Markdown com suporte a Mermaid (GitHub incluso).

## 1. Componentes

### 1.1 Pacotes do framework (repositório `tecton`)

```mermaid
graph TD
    manifest["@tecton/manifest<br/>schema/parser/validador do tecton.yaml"]
    core["@tecton/core<br/>geração de rota Fastify, conector<br/>CloudEvents/Valkey Streams, RFC 9457+i18n"]
    providers["@tecton/providers<br/>interfaces de Provider (portas) +<br/>implementações de referência"]
    directory["@tecton/directory<br/>Directory Service pronto<br/>(Tenant + Usuário/Grupo + Custodiante)<br/>+ SPA admin em /admin"]
    serviceClient["@tecton/service-client<br/>gerador do ServiceClient"]
    ui["@tecton/ui<br/>runtime de frontend: binding<br/>@rjsf/core, tema, i18nKey"]
    cli["@tecton/cli<br/>binário tecton-admin"]

    core --> manifest
    providers --> manifest
    directory --> manifest
    directory --> providers
    ui --> manifest
    directory --> ui
    serviceClient --> manifest
    cli --> core
    cli --> providers
    cli --> directory
    cli --> serviceClient
    cli --> ui
    cli --> manifest
```

*Regra de dependência (AD-3): `manifest` nunca depende de nada interno; `core`/`providers`/`service-client`/`ui` podem depender de `manifest`; `directory` pode depender de `manifest` e de `ui` (única dependência entre pacotes-irmãos, pela SPA admin embutida — AD-10); `cli` depende de todos; nunca o inverso.*

### 1.2 Sistema em runtime (app gerada por `tecton-admin new`)

```mermaid
graph TB
    Client["Cliente"] --> Gateway["Gateway<br/>(FR-19, fino — AD-8)"]
    Gateway -.->|roteia /admin, sem importar<br/>@tecton/directory nem @tecton/ui — AD-10| Directory
    Gateway -->|valida token (1ª linha,<br/>não a única — FR-13)| AuthSvc["Serviço de Auth<br/>(AuthProvider)"]
    Gateway -->|credencial verificável,<br/>Directory verifica ele mesmo — AD-7| Directory["Directory Service<br/>@tecton/directory<br/>(Tenant + Usuário/Grupo + Custodiante)<br/>+ SPA admin (@tecton/ui) em /admin"]
    Gateway -->|credencial verificável,<br/>A verifica ele mesmo — AD-7| DomainA["Domínio de negócio A<br/>(gerado, hexagonal)"]
    Gateway -->|credencial verificável,<br/>B verifica ele mesmo — AD-7| DomainB["Domínio de negócio B<br/>(gerado, hexagonal)"]

    DomainA -->|ServiceClient, sync,<br/>exceção, credencial verificável — AD-7/AD-9| DomainB
    DomainA -->|events.publishes| Valkey["Valkey Streams<br/>(CloudEvents, at-least-once)"]
    DomainB -->|events.consumes,<br/>modelo de leitura local| Valkey
    Directory -->|events.publishes| Valkey

    Directory --> DirDB[("Banco do Directory Service<br/>Closure Table + JSONB de atributos")]
    DomainA --> DBA[("Banco de A<br/>Prisma")]
    DomainB --> DBB[("Banco de B<br/>Prisma")]

    Gateway -.->|rate limit,<br/>fail-open| Valkey
    AuthSvc -.->|revogação,<br/>fail-closed| Valkey
```

*Cada serviço (Gateway, Directory, A, B) verifica a assinatura do token por conta própria — nenhum confia na verificação de outro (AD-7). Nenhum domínio lê o banco de outro domínio ou do Directory Service diretamente (AD-9); a única exceção de persistência-por-serviço é o próprio Directory Service hospedar três domínios embutidos juntos (AD-2).*

### 1.3 Hexagonal — anatomia de um serviço de domínio

```mermaid
graph LR
    subgraph "Serviço de domínio"
        Core["Núcleo de domínio<br/>(actions, regras de negócio)"]
        subgraph "Portas (interfaces)"
            P1["AuthProvider"]
            P2["ConfigProvider"]
            P3["ServiceDiscoveryProvider"]
            P4["TokenRevocationStore"]
            P5["KeyCustodyProvider"]
            P6["WorkflowEngineProvider"]
        end
        subgraph "Adaptadores (implementações)"
            A1["Argon2id"]
            A2["env vars tipadas"]
            A3["env var estática → DNS k8s (roadmap)"]
            A4["Valkey"]
            A5["interface only → OpenBAO (roadmap)"]
            A6["interface only → Temporal (roadmap)"]
        end
    end
    Core --> P1 & P2 & P3 & P4 & P5 & P6
    P1 -.-> A1
    P2 -.-> A2
    P3 -.-> A3
    P4 -.-> A4
    P5 -.-> A5
    P6 -.-> A6
```

### 1.4 `@tecton/ui` — runtime de frontend (AD-10)

```mermaid
graph LR
    subgraph "@tecton/ui"
        Core["Núcleo de render<br/>(binding schema→formulário,<br/>resolução i18nKey, chamada ServiceClient)"]
        subgraph "Porta"
            P1["UiThemeProvider<br/>(registro de slots)"]
        end
        subgraph "Camada 0 — default"
            Tokens["CSS custom properties<br/>(paleta, tipografia, espaçamento, radius)"]
            D1["ObjectTreeView (default)"]
            D2["AttributeForm (default,<br/>@rjsf/core)"]
            D3["ScreenLayout (default)"]
        end
        subgraph "Camada 1 — override do dev"
            O1["ObjectTreeView customizado"]
            O2["AttributeForm customizado"]
            O3["ScreenLayout customizado"]
        end
    end
    Core --> P1
    P1 -.->|default, sem override| D1 & D2 & D3
    P1 -.->|slot substituído pelo dev| O1 & O2 & O3
    D1 & D2 & D3 -.-> Tokens
```

*Mesmo padrão Hexagonal da seção 1.3 aplicado ao lado React: o núcleo de render nunca depende de uma implementação visual concreta, só da porta `UiThemeProvider`. Um slot não substituído cai no default da Camada 0, que já consome os tokens CSS — trocar identidade visual é só sobrescrever tokens, nunca exige componente.*

## 2. Diagramas de sequência — fluxos críticos

### 2.1 Action `sensitive.quorum` / `approval` (FR-3, FR-11, FR-25)

```mermaid
sequenceDiagram
    actor Client
    participant GW as Gateway
    participant Dom as Domain Service
    participant KCP as KeyCustodyProvider
    participant Poll as pollUrl

    Client->>GW: POST /actions/exportTenantData
    GW->>GW: valida token (AD-7)
    GW->>Dom: encaminha (credencial verificável)
    Dom->>Dom: verifica assinatura ele mesmo (AD-7)

    alt sensitive.quorum COM provider configurado
        Dom->>KCP: solicita aprovação x/n
        Dom-->>Client: 202 Accepted<br/>{status: pending_approval, requestId, pollUrl}
        Note over Client,Poll: cliente faz polling
        Client->>Poll: GET pollUrl
        alt ainda pendente
            Poll-->>Client: 202 (mesmo corpo)
        else aprovado
            Poll-->>Client: 200 + output (FR-23)
        else rejeitado
            Poll-->>Client: RFC 9457 (type=approval-rejected)
        else expirado / requestId desconhecido
            Poll-->>Client: 404 RFC 9457
        end
    else sensitive.quorum SEM provider configurado (FR-11 tem precedência)
        Dom->>Dom: loga aviso explícito (não silencioso)
        Dom-->>Client: 200 + output — executa normalmente
    else approval (aprovação de negócio, independente de provider)
        Dom->>Dom: resolve aprovador via ACL/árvore
        Dom-->>Client: 202 Accepted (mesmo fluxo de polling)
    end
```

### 2.2 `tecton-admin extract` — migração assistida (Strangler Fig, FR-16)

```mermaid
sequenceDiagram
    actor Dev
    participant CLI as tecton-admin
    participant GW as Gateway
    participant Mono as Monólito (domínio antigo)
    participant New as Serviço novo (domínio extraído)
    participant DB as Bancos (origem/destino)

    Dev->>CLI: tecton-admin extract <domínio>
    CLI->>New: gera scaffold do domínio
    CLI->>GW: gera fachada de roteamento (rota/percentual/flag)
    CLI->>DB: gera script de export/import único

    Note over GW,New: fase de validação em estágio<br/>(canário — nunca 100% de produção)
    Dev->>GW: ajusta % de tráfego de LEITURA pro serviço novo
    GW->>Mono: maioria do tráfego (ainda fonte da verdade)
    GW->>New: fatia de canário (validação)

    Note over Dev,DB: janela de manutenção — corte único
    Dev->>Mono: drena requisições em voo, para de aceitar novas
    Dev->>DB: roda export/import único (Mono → New)
    Dev->>GW: roteamento vai a 100% pro serviço novo

    Note over GW,Mono: migração só é viável em produção a 100%<br/>(sem sync contínuo/CDC no MVP)
    Dev->>Mono: decomissiona fachada e código legado (manual, pós-validação)
```

### 2.3 Evento entre domínios (CloudEvents sobre Valkey Streams, FR-4/FR-21)

```mermaid
sequenceDiagram
    participant A as Domínio A (publisher)
    participant VK as Valkey Streams
    participant B as Domínio B (consumer)
    participant DLQ as Dead-letter stream

    A->>A: aplica efeito local (commit)
    A->>VK: publica evento (CloudEvents, stream único por domínio)

    B->>VK: consome (consumer group)
    B->>B: verifica credencial do publisher (AD-7)
    alt credencial inválida
        B->>VK: ACK (remove do stream) + loga erro de segurança
    else credencial válida
        B->>B: checa chave de dedup (idempotência)
        alt já processado
            B->>B: no-op (efeito não duplicado)
        else não processado
            B->>B: aplica efeito
            B->>B: registra chave de dedup (só APÓS sucesso)
        end
        alt falha repetida (N tentativas)
            B->>DLQ: move pra dead-letter (não bloqueia stream)
        end
    end
```

## 3. Modelo de dados — Core de Diretório

```mermaid
erDiagram
    DIRECTORY_OBJECT ||--o{ CLOSURE_EDGE : "ancestor_id"
    DIRECTORY_OBJECT ||--o{ CLOSURE_EDGE : "descendant_id"
    DIRECTORY_OBJECT ||--o{ ACL_GRANT : "container_id"
    TENANT ||--o{ DIRECTORY_OBJECT : "pertence a (direta ou indiretamente)"

    DIRECTORY_OBJECT {
        string id PK "UUID v7 (AD-5)"
        string objectClass "Tenant | User | Group | Custodian"
        json attributes "bag JSON/JSONB, validado por JSON Schema do manifest"
        string tenantId FK
        string status "active | suspended | archived (só Tenant)"
    }

    CLOSURE_EDGE {
        string ancestorId FK
        string descendantId FK
        int depth "0 = self-referência"
    }

    ACL_GRANT {
        string id PK
        string containerId FK "objeto onde a permissão foi setada"
        string subjectId FK "usuário ou grupo"
        string role
    }

    TENANT {
        string id PK
    }
```

*Nota: `DIRECTORY_OBJECT` é a tabela única que hospeda Tenant, Usuário, Grupo e Custodiante juntos (AD-2) — `objectClass` distingue o tipo, `attributes` carrega os campos customizáveis via manifest sem exigir migração de schema. `CLOSURE_EDGE` implementa a Closure Table (FR-6): mover um nó é uma operação localizada nas linhas do nó movido; um `INSERT` que criaria um ciclo (ancestor descendente de si mesmo) é rejeitado antes de aplicar. ACL por herança aditiva simples (FR-7): a permissão setada em `ACL_GRANT.containerId` flui pros descendentes via `CLOSURE_EDGE`, sem bloqueio/override por nó no MVP.*
