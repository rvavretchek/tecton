# Laboratório Integrit — Documentação de Referência e Reconstrução

**Formato:** Markdown + Mermaid  
**Versão da documentação:** 1.0  
**Data:** 26/08/2026  
**Baseline:** `ubt-host01` operacional; `ubt-host02` ainda não preparado.

---

## 0. Como utilizar este documento

Este documento tem dois objetivos simultâneos:

1. **Leitura humana:** permitir que um administrador recrie o laboratório manualmente, compreendendo a arquitetura e as decisões antes de executar comandos.
2. **Leitura por IA generativa/agente:** fornecer contexto suficiente para que um assistente consiga reconstruir, validar, diagnosticar e posteriormente expandir o laboratório sem depender da memória da conversa original.

A regra principal é:

> **O hostname é a interface lógica; o IP, o container e a porta são detalhes de implementação.**

Ao reconstruir o laboratório, preserve primeiro os nomes, os papéis e os fluxos. Só depois ajuste IPs ou tecnologias auxiliares.

---

# 1. Visão geral

O laboratório `infra-lab` é uma infraestrutura Dockerizada destinada a experimentação integrada de:

- DNS interno;
- proxy reverso;
- roteamento HTTP por hostname;
- IAM com Keycloak;
- secrets/PAM com OpenBao;
- PostgreSQL;
- MariaDB;
- Nginx;
- comunicação entre serviços Docker;
- futura operação em dois hosts.

A arquitetura atual é deliberadamente simples:

```mermaid
flowchart TB
    USER["Cliente / Browser"]
    DNS["CoreDNS<br/>:53"]
    HA["HAProxy<br/>:80"]
    KC["Keycloak<br/>:8080"]
    BAO["OpenBao<br/>:8200"]
    NGINX["Nginx Proxy<br/>:80"]
    PG["PostgreSQL<br/>:5432"]
    MY["MariaDB<br/>:3306"]

    USER --> DNS
    USER --> HA

    DNS -->|"integrit.internal<br/>arandu.internal<br/>tupa.internal"| DNS
    HA -->|"idm01.*"| KC
    HA -->|"hsm01.integrit.internal"| BAO
    HA -->|"default"| NGINX

    KC --> PG
    KC -.-> BAO
    NGINX -.-> PG
    NGINX -.-> MY
```

O Host 01 concentra atualmente todos os serviços.

---

# 2. Estado da infraestrutura

| Componente | Estado |
|---|---|
| `ubt-host01` | **Operacional** |
| IP Host 01 | `192.168.50.71` |
| Rede | `192.168.50.0/24` |
| Gateway | `192.168.50.1` |
| CoreDNS | **Operacional** |
| HAProxy | **Operacional** |
| Keycloak | **Operacional** |
| OpenBao | **Operacional** |
| PostgreSQL | **Acessível** |
| MariaDB | **Acessível** |
| Nginx Proxy | **Operacional** |
| Docker `lab-network` | **Operacional** |
| DNS Windows → CoreDNS | **Validado** |
| Host 02 | **Pendente** |
| HA entre hosts | **Pendente** |
| Failover | **Pendente** |
| Replicação de estado | **Pendente** |

---

# 3. Topologia física atual

```mermaid
flowchart LR
    LAN["LAN<br/>192.168.50.0/24"]

    WIN["Windows / Cliente<br/>192.168.50.112"]
    H1["ubt-host01<br/>192.168.50.71"]
    GW["Gateway<br/>192.168.50.1"]

    LAN --- WIN
    LAN --- H1
    LAN --- GW
```

O Host 02 deverá entrar na mesma rede lógica, mas **seu IP ainda não está definido neste baseline**.

Não reservar artificialmente um IP até que a configuração física/virtual do segundo host seja conhecida.

---

# 4. Topologia lógica atual

```mermaid
flowchart TB
    C["Cliente"]

    subgraph HOST1["ubt-host01 — 192.168.50.71"]
        DNS["CoreDNS :53"]

        subgraph DOCKER["Docker / infra-lab_lab-network"]
            HA["HAProxy :80"]
            KC["Keycloak :8080"]
            BAO["OpenBao :8200"]
            NG["Nginx Proxy :80"]
            PG["PostgreSQL :5432"]
            MY["MariaDB :3306"]
        end
    end

    C -->|"DNS"| DNS
    C -->|"HTTP"| HA

    HA -->|"idm01.*"| KC
    HA -->|"hsm01.integrit.internal"| BAO
    HA -->|"default"| NG

    KC --> PG
```

---

# 5. Convenções de nomes

Os nomes abaixo são parte da interface do laboratório e devem ser preservados.

## 5.1 Hostnames de infraestrutura

| Nome | Função | IP atual |
|---|---|---|
| `ns01.integrit.internal` | DNS/CoreDNS | `192.168.50.71` |
| `idm01.integrit.internal` | Keycloak | `192.168.50.71` |
| `hsm01.integrit.internal` | OpenBao | `192.168.50.71` |
| `db01.integrit.internal` | PostgreSQL | `192.168.50.71` |
| `db02.integrit.internal` | MariaDB | `192.168.50.71` |
| `proxy01.integrit.internal` | Nginx Proxy | `192.168.50.71` |
| `web01.integrit.internal` | Serviço web reservado | `192.168.50.71` |

## 5.2 Domínios de aplicação

| FQDN | IP atual |
|---|---|
| `arandu.internal` | `192.168.50.71` |
| `www.arandu.internal` | `192.168.50.71` |
| `idm01.arandu.internal` | `192.168.50.71` |
| `tupa.internal` | `192.168.50.71` |
| `www.tupa.internal` | `192.168.50.71` |

`idm01.arandu.internal` foi adicionado durante o troubleshooting porque era um hostname aceito pelo HAProxy.

O hostname principal do Keycloak permanece:

```text
idm01.integrit.internal
```

---

# 6. Princípios arquiteturais

## 6.1 DNS interno separado do DNS público

CoreDNS é autoritativo para as zonas internas e encaminha consultas externas para:

```text
1.1.1.1
8.8.8.8
```

## 6.2 HAProxy como entrada HTTP

O cliente não precisa conhecer:

```text
Keycloak :8080
OpenBao :8200
Nginx :80
```

Ele usa FQDNs.

## 6.3 Serviços Docker comunicam-se por nome

Dentro da rede Docker:

```text
keycloak:8080
openbao:8200
nginx-proxy:80
```

são preferíveis a IPs de container.

## 6.4 Persistência fora da camada do container

Estado persistente deve permanecer em volumes/diretórios do laboratório.

## 6.5 Expansão sem alteração da interface

A entrada do Host 02 deve modificar a implementação, não os FQDNs utilizados pelos clientes.

---

# 7. Estrutura de diretórios

A estrutura conhecida do laboratório é:

```text
/opt/infra-lab/
├── docker-compose.yml
├── coredns/
│   └── Corefile
├── haproxy/
│   └── haproxy.cfg
└── openbao/
    ├── config/
    │   └── config.hcl
    └── data/
```

Ao evoluir a documentação, recomenda-se acrescentar:

```text
/opt/infra-lab/
├── docker-compose.yml
├── .env
├── README.md
├── docs/
│   ├── architecture.md
│   ├── operations.md
│   ├── troubleshooting.md
│   └── host-expansion.md
├── coredns/
│   └── Corefile
├── haproxy/
│   └── haproxy.cfg
└── openbao/
    ├── config/
    │   └── config.hcl
    └── data/
```

Segredos reais não devem ser colocados na documentação.

---

# 8. Docker Compose

O laboratório é orquestrado pelo:

```text
/opt/infra-lab/docker-compose.yml
```

Serviços conhecidos:

```text
nginx-proxy
keycloak
openbao
coredns
postgres
mariadb
haproxy
```

A rede Docker utilizada é:

```text
infra-lab_lab-network
```

Os containers devem permanecer nessa rede quando precisarem comunicar-se entre si.

---

# 9. CoreDNS

## 9.1 Arquivo

```text
/opt/infra-lab/coredns/Corefile
```

## 9.2 Baseline

```coredns
. {
    forward . 1.1.1.1 8.8.8.8
    log
    errors
}

integrit.internal:53 {
    hosts {
        192.168.50.71 ns01.integrit.internal
        192.168.50.71 idm01.integrit.internal
        192.168.50.71 hsm01.integrit.internal
        192.168.50.71 db01.integrit.internal
        192.168.50.71 db02.integrit.internal
        192.168.50.71 proxy01.integrit.internal
        192.168.50.71 web01.integrit.internal
        fallthrough
    }
    log
    errors
}

arandu.internal:53 {
    hosts {
        192.168.50.71 arandu.internal
        192.168.50.71 www.arandu.internal
        192.168.50.71 idm01.arandu.internal
        fallthrough
    }
    log
    errors
}

tupa.internal:53 {
    hosts {
        192.168.50.71 tupa.internal
        192.168.50.71 www.tupa.internal
        fallthrough
    }
    log
    errors
}
```

## 9.3 Funcionamento

```mermaid
flowchart TD
    Q["Consulta DNS"]

    Q --> C["CoreDNS"]

    C --> I{"Zona interna?"}

    I -->|"integrit.internal"| IH["hosts"]
    I -->|"arandu.internal"| AH["hosts"]
    I -->|"tupa.internal"| TH["hosts"]
    I -->|"não"| F["Forward"]

    F --> D1["1.1.1.1"]
    F --> D2["8.8.8.8"]
```

## 9.4 Regra de troubleshooting

Se:

```text
dig @192.168.50.71 nome.zona
```

retornar corretamente, mas o Windows falhar, investigar:

1. DNS configurado no Windows;
2. `systemd-resolved` somente se o cliente for Linux;
3. cache DNS;
4. consulta com FQDN completo;
5. existência do registro na zona.

Não alterar HAProxy para corrigir problema de DNS.

---

# 10. DNS no Host 01

`/etc/resolv.conf` é um symlink para:

```text
/run/systemd/resolve/resolv.conf
```

O arquivo mostra:

```text
nameserver 192.168.50.1
nameserver 8.8.8.8
nameserver 1.1.1.1
search .
```

O `nsswitch.conf` utiliza:

```text
hosts: files resolve [!UNAVAIL=return] dns
```

O ponto importante é que o CoreDNS está sendo usado diretamente pelos clientes da LAN.

---

# 11. HAProxy

## 11.1 Arquivo

```text
/opt/infra-lab/haproxy/haproxy.cfg
```

## 11.2 Baseline relevante

```haproxy
frontend http_in
    bind *:80

    acl host_keycloak hdr(host) -i idm01.integrit.internal idm01.arandu.internal idm01.tupa.internal
    acl host_openbao hdr(host) -i hsm01.integrit.internal

    use_backend openbao if host_openbao
    use_backend keycloak if host_keycloak

    default_backend nginx_proxy

backend nginx_proxy
    balance roundrobin
    option httpchk
    http-check send meth GET uri / ver HTTP/1.1 hdr Host proxy01.arandu.internal
    server nginx-proxy-01 nginx-proxy:80 check

backend keycloak
    option httpchk
    http-check send meth GET uri / ver HTTP/1.1 hdr Host idm01.arandu.internal
    server keycloak-01 keycloak:8080 check

backend openbao
    option httpchk
    http-check send meth GET uri /ui/ ver HTTP/1.1 hdr Host hsm01.integrit.internal
    server openbao-01 openbao:8200 check

frontend stats
    bind *:8404
    stats enable
    stats uri /stats
    stats refresh 10s
```

## 11.3 Fluxo de roteamento

```mermaid
flowchart LR
    R["HTTP request<br/>192.168.50.71:80"]
    H["HAProxy"]

    R --> H

    H -->|"Host: idm01.integrit.internal"| K["Keycloak :8080"]
    H -->|"Host: idm01.arandu.internal"| K
    H -->|"Host: idm01.tupa.internal"| K
    H -->|"Host: hsm01.integrit.internal"| B["OpenBao :8200"]
    H -->|"qualquer outro hostname"| N["Nginx Proxy :80"]
```

---

# 12. Keycloak

## Papel

IAM / identidade do laboratório.

## Endpoint lógico

```text
http://idm01.integrit.internal/
```

## Backend

```text
keycloak:8080
```

## Fluxo

```mermaid
sequenceDiagram
    participant Browser
    participant DNS as CoreDNS
    participant HA as HAProxy
    participant KC as Keycloak

    Browser->>DNS: idm01.integrit.internal
    DNS-->>Browser: 192.168.50.71

    Browser->>HA: GET /<br/>Host: idm01.integrit.internal
    HA->>KC: GET /
    KC-->>HA: 302 /admin/
    HA-->>Browser: 302 /admin/
```

## Validação conhecida

```text
HTTP/1.1 302 Found
location: http://idm01.integrit.internal/admin/
```

Isso confirma:

- DNS;
- acesso ao Host 01;
- HAProxy;
- ACL;
- backend Keycloak;
- resposta do Keycloak.

---

# 13. OpenBao

## Container

```yaml
openbao:
  image: openbao/openbao:latest
  container_name: openbao
  hostname: hsm01
  restart: unless-stopped
  ports:
    - "8200:8200"
  cap_add:
    - IPC_LOCK
  volumes:
    - ./openbao/config:/bao/config
    - ./openbao/data:/bao/data
  command: bao server -config=/bao/config/config.hcl
  networks:
    - lab-network
```

## Configuração

Arquivo:

```text
/opt/infra-lab/openbao/config/config.hcl
```

```hcl
storage "raft" {
  path    = "/bao/data"
  node_id = "openbao-node-1"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = "true"
}

api_addr     = "http://192.168.50.71:8200"
cluster_addr = "http://127.0.0.1:8201"
ui           = true
```

## Acesso

Direto:

```text
http://hsm01.integrit.internal:8200/ui/
```

Via HAProxy:

```text
http://hsm01.integrit.internal/
```

Resposta validada:

```text
HTTP/1.1 307 Temporary Redirect
location: /ui/
```

## Observação importante

O health check inicialmente utilizado com:

```text
/v1/sys/health
```

retornou `503`, fazendo o HAProxy marcar OpenBao como DOWN.

A verificação pela UI:

```text
/ui/
```

permitiu ao HAProxy identificar o backend como saudável para o objetivo HTTP do laboratório.

---

# 14. OpenBao e o Host 02

A configuração atual contém identidade de nó:

```text
openbao-node-1
```

e:

```hcl
cluster_addr = "http://127.0.0.1:8201"
```

Isso não deve ser replicado cegamente.

Ao adicionar o Host 02:

```mermaid
flowchart LR
    B1["openbao-node-1<br/>Host 01"]
    B2["openbao-node-2<br/>Host 02"]

    B1 <-->|"Raft / cluster"| B2
```

Será necessário definir:

- endereço de cluster;
- endereço de API;
- identidade do segundo nó;
- conectividade entre os nós;
- inicialização/join;
- quorum;
- persistência;
- backup;
- recuperação.

Para maior tolerância a falhas, a topologia definitiva deverá considerar quorum de três nós ou equivalente, dependendo do objetivo do laboratório.

---

# 15. Bancos

## PostgreSQL

```text
db01.integrit.internal
TCP 5432
```

Validação realizada:

```text
nc -zv db01.integrit.internal 5432
```

Resultado:

```text
succeeded
```

## MariaDB

```text
db02.integrit.internal
TCP 3306
```

Validação realizada:

```text
nc -zv db02.integrit.internal 3306
```

Resultado:

```text
succeeded
```

## Regra

Os bancos não devem ser considerados HA somente porque existe um segundo host.

É necessário decidir explicitamente:

- replicação;
- primário/secundário;
- failover;
- backup;
- RPO;
- RTO;
- persistência;
- mecanismo de quorum, quando aplicável.

---

# 16. Nginx

O Nginx atua como backend default do HAProxy.

Backend:

```haproxy
server nginx-proxy-01 nginx-proxy:80 check
```

O hostname lógico associado é:

```text
proxy01.integrit.internal
```

---

# 17. Fluxo completo de uma requisição HTTP

```mermaid
sequenceDiagram
    participant U as Browser
    participant D as CoreDNS
    participant H as HAProxy
    participant S as Serviço

    U->>D: Resolve FQDN
    D-->>U: 192.168.50.71

    U->>H: HTTP :80 + Host
    H->>H: Avalia ACL

    alt Keycloak
        H->>S: keycloak:8080
    else OpenBao
        H->>S: openbao:8200
    else Aplicação padrão
        H->>S: nginx-proxy:80
    end

    S-->>H: HTTP response
    H-->>U: HTTP response
```

---

# 18. Fluxo completo de DNS

```mermaid
sequenceDiagram
    participant C as Cliente
    participant DNS as CoreDNS
    participant EXT as DNS externo

    C->>DNS: A idm01.integrit.internal
    DNS-->>C: 192.168.50.71

    C->>DNS: A google.com
    DNS->>EXT: Forward
    EXT-->>DNS: resposta
    DNS-->>C: resposta
```

---

# 19. Testes de referência

## 19.1 DNS

Linux:

```bash
dig +short @192.168.50.71 idm01.integrit.internal
```

Esperado:

```text
192.168.50.71
```

Windows:

```powershell
Resolve-DnsName idm01.integrit.internal
```

Esperado:

```text
IPAddress : 192.168.50.71
```

## 19.2 Keycloak

```bash
curl -I http://idm01.integrit.internal/
```

Esperado:

```text
HTTP/1.1 302 Found
```

## 19.3 OpenBao

```bash
curl -I http://hsm01.integrit.internal/
```

Esperado:

```text
HTTP/1.1 307 Temporary Redirect
```

## 19.4 PostgreSQL

```bash
nc -zv db01.integrit.internal 5432
```

Esperado:

```text
succeeded
```

## 19.5 MariaDB

```bash
nc -zv db02.integrit.internal 3306
```

Esperado:

```text
succeeded
```

---

# 20. Diagnóstico sistemático

Quando um serviço não estiver acessível, seguir esta ordem:

```mermaid
flowchart TD
    A["Problema de acesso"] --> B{"DNS resolve?"}

    B -->|"Não"| C["Corrigir CoreDNS / cliente DNS"]
    B -->|"Sim"| D{"IP : porta responde?"}

    D -->|"Não"| E["Verificar serviço / firewall / Docker"]
    D -->|"Sim"| F{"HAProxy roteia?"}

    F -->|"Não"| G["Verificar ACL/backend"]
    F -->|"Sim"| H{"Backend está UP?"}

    H -->|"Não"| I["Verificar health check"]
    H -->|"Sim"| J{"Aplicação responde corretamente?"}

    J -->|"Não"| K["Diagnosticar aplicação"]
    J -->|"Sim"| L["Concluído"]
```

---

# 21. Comandos operacionais

## Containers

```bash
cd /opt/infra-lab
sudo docker compose ps
```

```bash
sudo docker ps
```

## Reiniciar CoreDNS

```bash
sudo docker compose restart coredns
```

## Reiniciar HAProxy

```bash
sudo docker compose restart haproxy
```

## Logs CoreDNS

```bash
sudo docker logs --tail 100 coredns
```

## Logs HAProxy

```bash
sudo docker logs --tail 100 haproxy
```

## Rede Docker do HAProxy

```bash
sudo docker inspect haproxy --format '{{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{end}}'
```

Esperado:

```text
infra-lab_lab-network
```

## Resolver OpenBao dentro do HAProxy

```bash
sudo docker exec haproxy getent hosts openbao
```

Esperado: um IP Docker da rede interna.

---

# 22. Incidentes já resolvidos

## 22.1 `idm01.arandu.internal` retornava SERVFAIL

O CoreDNS registrava:

```text
plugin/hosts: no next plugin found
```

Causa:

```text
idm01.arandu.internal
```

não estava declarado na zona:

```text
arandu.internal
```

Correção:

```coredns
192.168.50.71 idm01.arandu.internal
```

Depois:

```bash
sudo docker compose restart coredns
```

e:

```bash
dig +short @192.168.50.71 idm01.arandu.internal
```

retornou:

```text
192.168.50.71
```

---

## 22.2 Keycloak em `idm01.integrit.internal` retornava 404

O HAProxy inicialmente aceitava:

```text
idm01.arandu.internal
idm01.tupa.internal
```

mas não:

```text
idm01.integrit.internal
```

A ACL foi corrigida para:

```haproxy
acl host_keycloak hdr(host) -i idm01.integrit.internal idm01.arandu.internal idm01.tupa.internal
```

Após reiniciar o HAProxy:

```text
curl -I http://idm01.integrit.internal/
```

retornou:

```text
HTTP/1.1 302 Found
```

---

## 22.3 OpenBao retornava 503 pelo HAProxy

O HAProxy informava:

```text
Server openbao/openbao-01 is DOWN
reason: Layer7 wrong status, code: 503
```

A causa era o health check.

Depois da alteração do health check para uma URL que retorna resposta adequada ao objetivo do proxy:

```text
/ui/
```

o acesso:

```text
curl -I http://hsm01.integrit.internal/
```

passou a retornar:

```text
HTTP/1.1 307 Temporary Redirect
```

---

# 23. O que NÃO fazer

## Não

- colocar IP de container no CoreDNS;
- usar IP de container no HAProxy;
- copiar `node_id` do OpenBao para outro nó;
- atribuir o mesmo IP ao Host 02;
- alterar DNS para corrigir um erro de aplicação;
- alterar Keycloak para corrigir um erro de HAProxy;
- interpretar `302`, `307` ou `3xx` esperados como indisponibilidade;
- considerar dois hosts automaticamente como alta disponibilidade;
- copiar diretórios de dados de bancos sem estratégia de replicação;
- colocar secrets reais neste documento.

---

# 24. Preparação para o Host 02

A expansão deverá ocorrer em fases.

```mermaid
flowchart TD
    A["Host 02 físico/VM"] --> B["Sistema operacional"]
    B --> C["Rede"]
    C --> D["Hostname"]
    D --> E["DNS"]
    E --> F["Docker"]
    F --> G["Conectividade Docker"]
    G --> H["Serviços stateless"]
    H --> I["OpenBao / estado"]
    I --> J["Bancos"]
    J --> K["HAProxy"]
    K --> L["Failover"]
    L --> M["Teste completo"]
```

## Fase 1 — Sistema

- instalar SO compatível;
- atualizar;
- configurar hostname;
- configurar IP;
- configurar gateway;
- configurar DNS;
- habilitar SSH;
- sincronizar horário.

## Fase 2 — Docker

- instalar mesma família/versão compatível;
- validar Docker Engine;
- validar Compose;
- criar rede necessária;
- validar comunicação entre hosts.

## Fase 3 — Serviços sem estado

Primeiro migrar/duplicar serviços que não exigem sincronização complexa.

## Fase 4 — Estado

Depois tratar:

- OpenBao;
- PostgreSQL;
- MariaDB;
- volumes;
- backups.

## Fase 5 — Entrada

Finalmente tratar:

- HAProxy;
- DNS;
- VIP ou mecanismo equivalente;
- failover.

---

# 25. Arquitetura alvo de dois hosts

A arquitetura conceitual é:

```mermaid
flowchart TB
    CLIENT["Clientes"]

    ENTRY["Entrada lógica<br/>VIP / DNS / mecanismo HA"]

    H1["ubt-host01"]
    H2["ubt-host02"]

    CLIENT --> ENTRY

    ENTRY --> H1
    ENTRY --> H2

    subgraph HOST1["Host 01"]
        HA1["HAProxy"]
        DNS1["CoreDNS"]
        KC1["Keycloak"]
        BAO1["OpenBao"]
    end

    subgraph HOST2["Host 02"]
        HA2["HAProxy"]
        DNS2["CoreDNS"]
        KC2["Keycloak"]
        BAO2["OpenBao"]
    end

    H1 --> HOST1
    H2 --> HOST2

    BAO1 <-->|"Raft"| BAO2
```

Essa é uma **arquitetura-alvo conceitual**, não uma configuração final.

A implementação do HA deverá ser escolhida após conhecer:

- hardware do Host 02;
- virtualização;
- disponibilidade de IP;
- armazenamento;
- conectividade;
- necessidade de tolerância a falha;
- objetivo real do laboratório.

---

# 26. CoreDNS em dois hosts

Situação atual:

```text
Cliente
   |
   v
CoreDNS 01
```

Possível evolução:

```mermaid
flowchart LR
    C["Cliente"]

    D1["CoreDNS 01"]
    D2["CoreDNS 02"]

    C --> D1
    C --> D2

    D1 <-->|"mesmas zonas"| D2
```

A sincronização da configuração pode posteriormente ser feita por:

- Git;
- SaltStack;
- mecanismo de configuração central;
- outro mecanismo escolhido para o laboratório.

A fonte de verdade deve ser única.

---

# 27. HAProxy em dois hosts

```mermaid
flowchart LR
    C["Cliente"]

    V["IP lógico / VIP"]

    H1["HAProxy 01"]
    H2["HAProxy 02"]

    C --> V
    V --> H1
    V --> H2

    H1 --> S["Serviços"]
    H2 --> S
```

A documentação não fixa ainda uma solução de VIP. Isso será definido quando o Host 02 estiver instalado.

---

# 28. OpenBao em dois hosts

Situação atual:

```text
openbao-node-1
```

Situação futura mínima:

```text
openbao-node-1
openbao-node-2
```

Topologia desejável para maior resiliência:

```mermaid
flowchart LR
    N1["OpenBao 01"]
    N2["OpenBao 02"]
    N3["OpenBao 03<br/>futuro"]

    N1 <-->|"Raft"| N2
    N2 <-->|"Raft"| N3
    N3 <-->|"Raft"| N1
```

A decisão de três nós deve considerar o objetivo do laboratório e os recursos disponíveis.

---

# 29. Bancos em dois hosts

Não assumir que:

```text
db01 → Host 01
db01 → Host 02
```

seja suficiente.

O desenho futuro deve explicitar:

```mermaid
flowchart LR
    APP["Aplicação"]

    DB1["PostgreSQL Primário"]
    DB2["PostgreSQL Réplica"]

    APP --> DB1
    DB1 -->|"replicação"| DB2
```

O mesmo raciocínio vale para MariaDB.

---

# 30. Separação entre configuração e estado

Esta distinção é fundamental para uma reconstrução por IA.

## Configuração

Pode ser reconstruída:

```text
docker-compose.yml
Corefile
haproxy.cfg
config.hcl
.env.template
```

## Estado

Não deve ser simplesmente recriado:

```text
openbao/data
database data
credentials
tokens
certificados privados
segredos
```

Um agente deve perguntar ou detectar se o objetivo é:

- **reconstrução limpa**, ou
- **recuperação de laboratório existente**.

---

# 31. Regras para uma IA reconstruir o laboratório

Um assistente/agente deve executar as seguintes etapas.

```mermaid
flowchart TD
    A["Ler documentação"] --> B["Descobrir ambiente"]
    B --> C["Comparar estado atual com baseline"]
    C --> D["Não modificar ainda"]
    D --> E["Identificar divergências"]
    E --> F["Planejar correções"]
    F --> G["Aplicar uma mudança por vez"]
    G --> H["Validar"]
    H --> I{"OK?"}
    I -->|"não"| J["Diagnosticar"]
    J --> F
    I -->|"sim"| K["Registrar estado"]
```

## Regras para agentes

1. Nunca presumir IP.
2. Nunca presumir nome de interface de rede.
3. Nunca apagar dados persistentes sem confirmação explícita.
4. Fazer backup antes de mudanças destrutivas.
5. Validar sintaxe antes de reiniciar serviço.
6. Após cada alteração, executar teste correspondente.
7. Separar problema de DNS, rede, proxy e aplicação.
8. Preservar FQDNs.
9. Não duplicar identidade de cluster.
10. Registrar qualquer divergência da baseline.
11. Não considerar um serviço saudável apenas porque a porta está aberta.
12. Usar HTTP status esperado como parte da validação.

---

# 32. Matriz de dependências

| Serviço | Depende de | É acessado por |
|---|---|---|
| CoreDNS | rede | clientes/hosts |
| HAProxy | Docker network | clientes |
| Keycloak | banco/rede | HAProxy |
| OpenBao | storage/rede | HAProxy/aplicações |
| PostgreSQL | storage/rede | aplicações |
| MariaDB | storage/rede | aplicações |
| Nginx | rede | HAProxy |

---

# 33. Matriz de portas

| Serviço | Porta | Exposição |
|---|---:|---|
| DNS | 53 UDP/TCP | LAN |
| HAProxy HTTP | 80/TCP | LAN |
| HAProxy Stats | 8404/TCP | administração |
| Keycloak | 8080/TCP | Docker |
| OpenBao | 8200/TCP | Docker + Host |
| OpenBao cluster | 8201/TCP | futuro cluster |
| PostgreSQL | 5432/TCP | rede do laboratório |
| MariaDB | 3306/TCP | rede do laboratório |
| Nginx | 80/TCP | Docker |

A exposição efetiva depende do `docker-compose.yml` e do firewall do host.

---

# 34. Critérios de aceite do Host 01

O baseline é considerado funcional quando:

- [x] CoreDNS responde;
- [x] zonas internas resolvem;
- [x] cliente Windows resolve os FQDNs;
- [x] HAProxy está ativo;
- [x] Keycloak responde pelo FQDN;
- [x] OpenBao responde pelo FQDN;
- [x] PostgreSQL aceita conexão TCP;
- [x] MariaDB aceita conexão TCP;
- [x] HAProxy encontra os backends;
- [x] containers compartilham `lab-network`.

---

# 35. Critérios de aceite do Host 02

Quando o segundo host estiver instalado, o trabalho não estará concluído apenas porque o SO responde.

Deverá ser possível demonstrar:

- [ ] Host 02 resolve os nomes internos;
- [ ] Host 01 resolve Host 02;
- [ ] Docker funciona;
- [ ] comunicação entre hosts funciona;
- [ ] serviços previstos estão ativos;
- [ ] dados persistentes estão protegidos;
- [ ] OpenBao possui estratégia de cluster definida;
- [ ] bancos possuem estratégia de replicação definida;
- [ ] HAProxy possui mecanismo de failover;
- [ ] DNS possui redundância;
- [ ] perda do Host 01 foi testada;
- [ ] retorno do Host 01 foi testado.

---

# 36. Checklist de reconstrução limpa

```text
[ ] Preparar Ubuntu/OS
[ ] Configurar hostname
[ ] Configurar IP
[ ] Configurar gateway
[ ] Configurar DNS
[ ] Instalar Docker
[ ] Criar /opt/infra-lab
[ ] Criar docker-compose.yml
[ ] Criar Corefile
[ ] Criar haproxy.cfg
[ ] Criar OpenBao config.hcl
[ ] Criar diretórios persistentes
[ ] Subir containers
[ ] Validar rede Docker
[ ] Validar DNS
[ ] Validar HAProxy
[ ] Validar Keycloak
[ ] Validar OpenBao
[ ] Validar PostgreSQL
[ ] Validar MariaDB
[ ] Validar Nginx
[ ] Registrar baseline
```

---

# 37. Checklist de reconstrução por agente

Um agente deve tratar a reconstrução como uma máquina de estados:

```mermaid
stateDiagram-v2
    [*] --> Discovery
    Discovery --> Network
    Network --> Docker
    Docker --> DNS
    DNS --> Proxy
    Proxy --> Identity
    Identity --> Secrets
    Secrets --> Databases
    Databases --> Validation
    Validation --> Baseline
    Validation --> Troubleshooting
    Troubleshooting --> Validation
    Baseline --> [*]
```

Cada estado deve ter:

- pré-condições;
- ações;
- comandos;
- resultado esperado;
- rollback;
- evidência de sucesso.

---

# 38. Política de alterações

Toda alteração estrutural deve registrar:

```text
Data:
Responsável:
Motivo:
Arquivo:
Alteração:
Estado anterior:
Estado posterior:
Teste executado:
Resultado:
Rollback:
```

Isso permite que uma IA posteriormente reconstrua não somente o estado, mas também o racional histórico.

---

# 39. Segurança

A documentação deliberadamente **não contém**:

- senhas;
- tokens;
- secrets;
- chaves privadas;
- credenciais de banco;
- tokens do OpenBao;
- credenciais administrativas do Keycloak.

Esses valores devem existir somente em mecanismos apropriados.

Em uma reconstrução limpa, a IA deve gerar novos secrets, nunca inventar que conhece os antigos.

---

# 40. Backup

Antes de alterações de infraestrutura:

```text
docker-compose.yml
Corefile
haproxy.cfg
openbao/config/
```

devem estar versionados ou copiados.

Dados:

```text
openbao/data/
PostgreSQL
MariaDB
```

devem possuir estratégia própria de backup.

Configuração e estado são objetos diferentes.

---

# 41. Git recomendado

A configuração deveria futuramente ser mantida em Git:

```mermaid
flowchart LR
    G["Git<br/>Fonte de verdade"]

    G --> C["CoreDNS"]
    G --> H["HAProxy"]
    G --> D["Docker Compose"]
    G --> O["OpenBao config"]

    C --> H1["Host 01"]
    C --> H2["Host 02"]

    H --> H1
    H --> H2

    D --> H1
    D --> H2
```

Segredos devem ficar fora do repositório ou ser protegidos por mecanismo apropriado.

---

# 42. Estratégia recomendada para a próxima etapa

A ordem recomendada é:

1. preparar fisicamente/virtualmente o Host 02;
2. definir seu IP;
3. instalar o mesmo SO/base;
4. instalar Docker;
5. validar rede;
6. validar DNS;
7. documentar diferenças entre Host 01 e Host 02;
8. só então desenhar a expansão dos serviços;
9. tratar OpenBao;
10. tratar bancos;
11. tratar DNS redundante;
12. tratar HAProxy;
13. testar falha real.

Não iniciar a expansão de OpenBao ou dos bancos antes de validar a rede entre os hosts.

---

# 43. Baseline operacional consolidado

```text
LABORATÓRIO
└── Rede 192.168.50.0/24
    ├── Gateway 192.168.50.1
    ├── Host 01 192.168.50.71
    │
    └── Docker
        └── infra-lab_lab-network
            ├── CoreDNS
            │   ├── integrit.internal
            │   ├── arandu.internal
            │   └── tupa.internal
            │
            ├── HAProxy :80
            │   ├── idm01.* -> Keycloak :8080
            │   ├── hsm01.* -> OpenBao :8200
            │   └── default -> Nginx :80
            │
            ├── Keycloak
            ├── OpenBao
            ├── Nginx
            ├── PostgreSQL
            └── MariaDB
```

---

# 44. Regra de ouro para expansão

A evolução deve seguir:

```text
                    INTERFACE LÓGICA
                           │
                           ▼
                 FQDNs permanecem iguais
                           │
                           ▼
                 HA / distribuição
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
          Host 01                   Host 02
              │                         │
              └────────────┬────────────┘
                           ▼
                    Serviços / estado
```

O objetivo não é simplesmente duplicar o Host 01.

O objetivo é transformar a infraestrutura de:

```text
single-host
```

em:

```text
multi-host
```

preservando:

```text
DNS
FQDNs
interfaces
dependências
dados
segurança
observabilidade
```

---

# 45. Pendências oficiais

## P0 — Próxima etapa

- [ ] Preparar `ubt-host02`.

## P1 — Após Host 02

- [ ] Definir endereçamento;
- [ ] validar conectividade;
- [ ] definir estratégia de HA;
- [ ] definir estratégia de persistência;
- [ ] definir estratégia de OpenBao;
- [ ] definir estratégia de banco;
- [ ] definir redundância DNS;
- [ ] definir redundância HAProxy.

## P2 — Evolução

- [ ] Failover automatizado;
- [ ] monitoramento;
- [ ] backups automatizados;
- [ ] GitOps/configuração versionada;
- [ ] documentação de recuperação;
- [ ] teste de desastre.

---

# 46. Estado final desta versão

**Concluído no Host 01:**

```text
DNS
  ✓ CoreDNS
  ✓ zonas internas
  ✓ resolução Windows

Proxy
  ✓ HAProxy
  ✓ Keycloak
  ✓ OpenBao
  ✓ Nginx

Dados
  ✓ PostgreSQL acessível
  ✓ MariaDB acessível

Containerização
  ✓ Docker
  ✓ lab-network

Documentação
  ✓ arquitetura
  ✓ configurações conhecidas
  ✓ troubleshooting
  ✓ fluxos
  ✓ Mermaid
  ✓ preparação para Host 02
```

**Fora do baseline atual:**

```text
Host 02
HA
Failover
Replicação
Cluster OpenBao
Replicação dos bancos
DNS redundante
HAProxy redundante
```

---

# 46b. Acesso SSH por chave (adicionado 2026-08-31)

O host `ubt-host01` (`192.168.50.71`) é acessível por SSH com o usuário `operador01`. Autenticação por senha estava disponível; foi complementada por um par de chaves dedicado para uso por agentes/automação, sem reutilizar a chave do laboratório Arandu (`~/.ssh/arandu_lab_ed25519`).

## Chave

- Chave privada (na máquina que acessa o lab): `~/.ssh/tupa_lab_ed25519`
- Instalada em `~/.ssh/authorized_keys` de `operador01@192.168.50.71`
- Alias configurado em `~/.ssh/config`:

```text
Host tupa-lab ubt-host01
    HostName 192.168.50.71
    User operador01
    IdentityFile ~/.ssh/tupa_lab_ed25519
    IdentitiesOnly yes
```

Uso: `ssh tupa-lab` (ou `ssh ubt-host01`).

## Sudo

`operador01` está no grupo `sudo`, mas exige senha interativa (`sudo -S` com a senha via stdin). Comandos `docker`/`docker compose` **não** exigem sudo (usuário no grupo `docker`).

---

# 46c. Correção do admin do Keycloak (2026-08-31)

```text
Data: 2026-08-31
Responsável: agente (Claude Code), a pedido de Ricardo
Motivo: login no Keycloak via web UI falhava para operador01/[senha do lab]
Arquivo: /opt/infra-lab/docker-compose.yml, /opt/infra-lab/haproxy/haproxy.cfg
```

## Causa raiz

O `docker-compose.yml` definia `KC_BOOTSTRAP_ADMIN_USERNAME`/`KC_BOOTSTRAP_ADMIN_PASSWORD` -- a convenção da imagem **oficial** do Keycloak (`quay.io/keycloak/keycloak`). A imagem em uso é `bitnamilegacy/keycloak`, que **ignora essas variáveis** e usa as suas próprias: `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` (ou `KEYCLOAK_ADMIN_USER`). Sem elas, a imagem Bitnami cai no padrão inseguro `user` / `bitnami`. O admin nunca teve as credenciais que se pretendia configurar.

## O que foi tentado e revertido

Como tentativa de correção mais ampla, o serviço `keycloak` foi temporariamente trocado para a imagem oficial `quay.io/keycloak/keycloak:26.7`. **Isso quebrou o boot**: a CPU do host (`Intel Core2 Quad Q8200`) não suporta o baseline `x86-64-v2` que a base RHEL/UBI9 dessa imagem exige (`Fatal glibc error: CPU does not support x86-64-v2`). **Qualquer imagem baseada em UBI9/RHEL9 vai falhar da mesma forma neste host** -- não é específico de uma versão do Keycloak. Revertido para `bitnamilegacy/keycloak:24.0.5-debian-12-r1` (Debian, compatível com esta CPU).

## Estado final

- Imagem: `bitnamilegacy/keycloak:24.0.5-debian-12-r1` (mantida)
- Flag de proxy corrigida: `--proxy=edge` (depreciada) → `--proxy-headers=xforwarded`
- Variáveis de admin corrigidas no compose: `KEYCLOAK_ADMIN=user`, `KEYCLOAK_ADMIN_PASSWORD=<definida>`
- Admin do realm `master`: usuário **`user`** (não foi possível renomear via Admin API -- retornou 400; não investigado a fundo por não ser bloqueante), senha atualizada via Admin REST API
- Banco `defaultdb` (schema do Keycloak) foi dropado e recriado para bootstrap limpo antes da correção
- HAProxy (`frontend http_in`): adicionado `option forwardfor` + `X-Forwarded-Proto/Host/Port` explícitos -- o Keycloak com `--proxy-headers` depende deles para escopar corretamente o cookie de sessão de autenticação; sem eles, login via browser podia falhar com `error="cookie_not_found"` (observado nos logs antes da correção, não reproduzido depois)

## Teste executado

- Token grant direto (`grant_type=password`) contra `/realms/master/protocol/openid-connect/token`: `200 OK`
- Simulação de fluxo OIDC via curl com cookie jar através do HAProxy: sem `cookie_not_found` nos logs
- **Não testado em navegador real** -- validação final por Ricardo pendente

## Backup

Config anterior (compose + haproxy + coredns) em `/opt/infra-lab/backups/20260831-134417/` (dono `root`, requer sudo para ler).

## Rollback

Restaurar os arquivos do backup acima e `docker compose up -d --force-recreate keycloak haproxy`. **Atenção:** isso reverte para as credenciais quebradas (`user`/`bitnami` implícito) -- só fazer rollback se a correção causar um problema novo, não para "desfazer" a correção em si.

---

# 46d. Deploy da aplicação Tupã (2026-08-31, corrigido em 2026-09-01)

Stack de containers do Tupã em `/opt/tupa-app/` (compose próprio, ver `deploy/lab/README.md` no repositório do Tupã). **Reaproveita a infraestrutura compartilhada do `infra-lab`** (Postgres, nginx-proxy) -- só os containers específicos da aplicação (`tupa-api`, `tupa-web`) são novos, ambos na rede compartilhada `infra-lab_lab-network`.

Uma primeira versão deste deploy (2026-08-31) criou por engano um Postgres e um nginx dedicados (`tupa-postgres`, `tupa-nginx`), duplicando infraestrutura que já existia. Corrigido em 2026-09-01 a pedido de Ricardo: ambos os containers extras foram removidos, e a aplicação passou a reaproveitar o `postgres` e o `nginx-proxy` já existentes. O texto abaixo descreve o estado final (corrigido).

## Novas entradas de DNS (zona `tupa.internal`)

```text
192.168.50.71 idm01.tupa.internal
192.168.50.71 api.tupa.internal
```

(`tupa.internal`/`www.tupa.internal` já existiam.)

## Banco de dados

Reaproveita o container `postgres` compartilhado (o mesmo que serve o schema do Keycloak em `defaultdb`). Um database dedicado `tupa` foi criado no mesmo servidor (`CREATE DATABASE tupa OWNER operador01;`), usando as mesmas credenciais (`operador01`/senha do lab) -- não um usuário/servidor separado.

## Roteamento: HAProxy → nginx-proxy → tupa-web

`tupa.internal`/`www.tupa.internal` **não** têm ACL própria no HAProxy -- caem no `default_backend nginx_proxy` já existente, que já roteava por `server_name`. Um novo `server` block foi adicionado a `/opt/infra-lab/nginx/proxy/conf.d/default.conf` (mesmo container `nginx-proxy`, sem criar um novo):

```nginx
server {
    listen 80;
    server_name tupa.internal www.tupa.internal;

    location / {
        proxy_pass http://tupa-web:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`api.tupa.internal` continua com ACL própria no HAProxy, indo direto para `tupa-api` (não passa pelo nginx-proxy -- é a API, não front-end):

```haproxy
acl host_tupa_api hdr(host) -i api.tupa.internal
use_backend tupa_api if host_tupa_api

backend tupa_api
    server tupa-api-01 tupa-api:3001 check
```

## Realm Keycloak

Realm `tupa` criado (ver seção 46c para a correção do admin que precedeu isso). Clients:
- `tupa-web` -- público, standard flow + PKCE, redirect URIs para `tupa.internal`/`www.tupa.internal`/`localhost:3000`.
- `tupa-admin-service` -- confidencial, service account com role `view-users` em `realm-management` (usado pela API para resolver contato→usuário).

## Containers

| Container | Papel | Novo ou reaproveitado |
|---|---|---|
| `tupa-api` | NestJS, porta 3001 | novo |
| `tupa-web` | Node/SSR (TanStack Start), porta 3000 | novo |
| `postgres` | Postgres compartilhado, database `tupa` dedicado dentro dele | **reaproveitado** |
| `nginx-proxy` | Roteamento por `server_name`, novo `server` block para `tupa.internal` | **reaproveitado** |

## Armadilha encontrada (na versão descartada com Postgres dedicado): Postgres 18 muda o path do volume

Não se aplica mais desde que passou a reaproveitar o `postgres` compartilhado, mas fica registrado: a imagem `postgres:18-alpine` espera o volume montado em `/var/lib/postgresql` (sem `/data` no final) -- diferente das imagens pré-18. Montar em `/var/lib/postgresql/data` faz o container entrar em crash loop com um erro explícito sobre isso.

## Validação

```bash
curl http://tupa.internal/          # 200
curl http://www.tupa.internal/      # 200
curl http://api.tupa.internal/dashboard -H 'Authorization: Bearer x'  # 401 (esperado, token inválido -- confirma que a rota chega na API)
```

Testado também a partir de uma máquina Windows fora do host (resolução DNS via CoreDNS já configurado, sem override) -- `tupa.internal` resolve e responde 200 ponta a ponta. Confirmado que `idm01.integrit.internal` (Keycloak) continuou respondendo normalmente após as mudanças no nginx-proxy/HAProxy.

---

# 46e. Deploy da aplicação Aether — validação real de Story 2.1 (2026-09-01/02)

Contexto: a Story 2.1 do Aether (`Login com AuthProvider — JWT + Refresh + Argon2id`) precisava validar o fluxo `login`→`refresh` de ponta a ponta contra um Postgres real -- impossível na máquina de desenvolvimento (sem Docker, sem credenciais do Postgres nativo local). Resolução: reaproveitar este laboratório compartilhado, no mesmo padrão já estabelecido pelo Tupã (seção 46d) -- sem criar infraestrutura dedicada nova.

## Estrutura no host

```text
/opt/aether-app/
├── apps/aether-demo/        # projeto gerado por `aether-admin new`
└── deploy/lab/
    ├── docker-compose.yml
    └── .env                  # segredos reais, nunca commitado
```

## Banco de dados

Reaproveita o container `postgres` compartilhado (o mesmo que serve Keycloak e o database `tupa`). Database dedicado `aether` criado no mesmo servidor (`CREATE DATABASE aether OWNER operador01;`), mesmas credenciais de superusuário do lab -- não um servidor/usuário separado.

## Container

Só `aether-api` é novo, na rede compartilhada `infra-lab_lab-network` (sem container de app web nesta story, ainda não existe frontend):

```yaml
services:
  aether-api:
    build:
      context: ../../apps/aether-demo
      dockerfile: Dockerfile.lab
    container_name: aether-api
    restart: unless-stopped
    environment:
      API_PORT: 3001
      HOST: 0.0.0.0
      NODE_ENV: development
      DATABASE_URL: postgres://operador01:${LAB_DB_PASSWORD}@postgres:5432/aether
      ARGON2_PEPPER: ${AETHER_ARGON2_PEPPER}
      JWT_SIGNING_KEY: ${AETHER_JWT_SIGNING_KEY}
    networks:
      - lab-network

networks:
  lab-network:
    name: infra-lab_lab-network
    external: true
```

Sem `ports:` publicado -- `aether-api` só é alcançável de dentro de `infra-lab_lab-network` (ex.: outro container na mesma rede), não pelo host/LAN diretamente. Suficiente para o objetivo desta validação (curl a partir de dentro da rede Docker).

## Incidente durante a validação: `auth.refresh` falhava (415, depois 401)

```text
Data: 2026-09-01
Responsável: agente (Claude Code) + Ricardo, sessão de validação da Story 2.1 do Aether
Motivo: primeira tentativa de curl em auth.refresh falhava
```

**Causa raiz (1ª tentativa -- `415 UNSUPPORTED_MEDIA_TYPE`):** requisição POST ao tRPC sem `Content-Type: application/json` explícito -- o adapter Fastify do tRPC rejeita o body sem esse header, mesmo em rota que não exige input.

**Causa raiz (2ª tentativa, após corrigir o header -- `401 UNAUTHORIZED`):** o curl não estava reaproveitando o cookie `refresh_token` setado pela resposta de `auth.login` (sem `-c`/`-b` de cookie jar entre as duas chamadas) -- `auth.refresh` corretamente rejeitou por falta de cookie válido, não é um bug da API.

**Correção:** repetir `auth.login` com `-c cookie.txt`, depois `auth.refresh` com `-b cookie.txt` e `-H 'Content-Type: application/json'` explícito nas duas chamadas.

**Teste executado (evidência via `docker logs aether-api`):**

```text
POST /trpc/auth.login    -> 200
POST /trpc/auth.refresh  -> 200
```

Fluxo feliz completo (`login` com credenciais corretas → access token + cookie `refresh_token` → `refresh` troca o refresh token válido por novo access token) validado contra o Postgres real do laboratório. Isso fecha a Task 7.1 da Story 2.1 (`_bmad-output/implementation-artifacts/2-1-login-jwt-refresh.md`), que não tinha sido possível validar na máquina de desenvolvimento.

## Lição para os 3 outros projetos (Tecton/Tupã/Arandu)

`415 UNSUPPORTED_MEDIA_TYPE`/cookie não reaproveitado em teste manual de curl contra endpoint tRPC+cookie não é specific do Aether -- qualquer projeto que valide manualmente um fluxo de auth baseado em cookie httpOnly via curl deve, desde o início, usar cookie jar (`-c`/`-b`) e `Content-Type: application/json` explícito, para não confundir esse erro de teste com um bug real da aplicação.

---

# 47. Política de colaboração entre os 4 projetos (Aether, Tecton, Tupã, Arandu)

Este laboratório é **infraestrutura compartilhada** entre os quatro projetos do mesmo autor. Cada projeto mantém sua própria cópia deste documento (`docs/Laboratório/laboratorio-integrit-documentacao.md`), mas todas as cópias devem convergir para o mesmo conteúdo -- este é o mais atualizado; ao encontrar uma cópia desatualizada em outro projeto, sincronize-a a partir desta.

**Regra obrigatória para qualquer agente (em qualquer um dos 4 projetos) que mexer no laboratório:**

1. Antes de alterar qualquer coisa no lab, leia este documento inteiro -- não presuma estado a partir de memória de conversa.
2. Ao encontrar e corrigir um problema real de infraestrutura (DNS, proxy, banco, IAM, containers, etc.), **documente a correção aqui** -- causa raiz, correção aplicada, teste executado, seguindo o formato das seções "Incidentes já resolvidos" (22) e da Política de alterações (38).
3. **Propague a atualização para as cópias dos outros 3 projetos** (e para a cópia canônica em `Projetos/__Laboratório/`) -- um problema resolvido num projeto não deve ser redescoberto do zero por outro. Se houver uma sessão ativa de outro projeto, avise-a diretamente da correção; caso contrário, a atualização do documento é o mecanismo de propagação.
4. Nunca resolva um problema de infraestrutura compartilhada duplicando-a (ver seção 46d -- Tupã inicialmente criou um Postgres/nginx próprios por engano; foi corrigido para reaproveitar o que já existia). Antes de criar um novo container/serviço, verifique se o `infra-lab` já oferece o equivalente.
5. Segredos reais nunca vão neste documento (seção 39) -- eles vivem em `.env` no host, um por projeto/deploy, nunca commitado.

---

# 48. Instrução para futuro agente

Ao receber este documento, o agente deve assumir:

> Este documento descreve o baseline conhecido do Laboratório Integrit. Antes de modificar qualquer coisa, faça discovery do ambiente real e compare-o com este documento. Não presuma que um arquivo, IP, container ou versão permaneceu igual. Preserve os FQDNs e as interfaces lógicas. Diferencie configuração de estado persistente. Faça mudanças incrementais, valide cada mudança e registre divergências. Quando o segundo host estiver disponível, trate-o como uma extensão arquitetural do laboratório e não como uma simples cópia do primeiro host.

---
