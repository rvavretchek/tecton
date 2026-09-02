#!/usr/bin/env python3
"""
Laboratório Integrit - reconstrução limpa do infra-lab.

Pré-requisitos assumidos:
  - Ubuntu/Linux já instalado e configurado;
  - hostname, IP, gateway e DNS do host já configurados;
  - Docker Engine e Docker Compose Plugin instalados;
  - Python 3 instalado;
  - usuário que executa o script possui sudo.

O script começa no ponto "Criar /opt/infra-lab" do checklist de reconstrução
da documentação do Laboratório Integrit.

Objetivos:
  1. coletar configuração interativamente;
  2. criar a estrutura do laboratório;
  3. gerar docker-compose.yml, Corefile, haproxy.cfg e OpenBao config.hcl;
  4. subir os serviços;
  5. executar testes DNS, TCP, HTTP e Docker;
  6. apresentar um relatório final em terminal;
  7. gravar o relatório e um manifesto da instalação em /opt/infra-lab.

Observação:
  - o script NÃO configura a rede do Linux;
  - o script NÃO cria/alterara usuários do SO;
  - o script NÃO inicializa o OpenBao nem cria um root token;
  - o script NÃO modifica DNS do Windows;
  - segredos são gravados apenas no .env com permissão 0600.
"""

from __future__ import annotations

import getpass
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional


DEFAULT_HOSTNAME = "ubt-host02"
DEFAULT_INSTALL = "/opt/infra-lab"
DEFAULT_DOMAIN = "integrit.internal"
DEFAULT_OTHER_DOMAINS = "arandu.internal, tupa.internal"
DEFAULT_ADMIN_USER = "operador01"

POSTGRES_DB = "keycloak"
POSTGRES_USER = "keycloak"
POSTGRES_PASSWORD_ENV = "LAB_DB_PASSWORD"

COMPOSE_PROJECT = "infra-lab"


@dataclass
class Config:
    hostname: str
    install_dir: Path
    primary_domain: str
    other_domains: list[str]
    admin_user: str
    admin_password: str
    host_ip: str
    gateway: str
    dns_upstream_1: str = "1.1.1.1"
    dns_upstream_2: str = "8.8.8.8"

    @property
    def fqdn(self) -> str:
        return f"{self.hostname}.{self.primary_domain}"

    @property
    def keycloak_fqdn(self) -> str:
        return f"idm01.{self.primary_domain}"

    @property
    def openbao_fqdn(self) -> str:
        return f"hsm01.{self.primary_domain}"

    @property
    def postgres_fqdn(self) -> str:
        return f"db01.{self.primary_domain}"

    @property
    def mariadb_fqdn(self) -> str:
        return f"db02.{self.primary_domain}"

    @property
    def proxy_fqdn(self) -> str:
        return f"proxy01.{self.primary_domain}"

    @property
    def dns_fqdn(self) -> str:
        return f"ns01.{self.primary_domain}"


@dataclass
class Check:
    name: str
    ok: bool
    detail: str
    expected: str = ""
    severity: str = "FAIL"


CHECKS: list[Check] = []


def log(msg: str) -> None:
    print(f"[+] {msg}")


def warn(msg: str) -> None:
    print(f"[!] {msg}")


def fail(msg: str) -> None:
    print(f"[X] {msg}")


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return value or default


def ask_password() -> str:
    while True:
        p1 = getpass.getpass("Senha do administrador: ")
        p2 = getpass.getpass("Confirme a senha: ")
        if not p1:
            warn("A senha não pode ser vazia.")
            continue
        if p1 != p2:
            warn("As senhas não conferem. Tente novamente.")
            continue
        return p1


def detect_primary_ip() -> str:
    # Não envia dados; apenas consulta a rota local para descobrir o endereço
    # usado para alcançar um destino externo.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(1)
        s.connect(("1.1.1.1", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return ""


def detect_gateway() -> str:
    try:
        proc = subprocess.run(
            ["ip", "route", "show", "default"],
            capture_output=True,
            text=True,
            check=False,
        )
        m = re.search(r"default via ([0-9.]+)", proc.stdout)
        return m.group(1) if m else ""
    except FileNotFoundError:
        return ""


def run(
    cmd: list[str],
    *,
    sudo: bool = False,
    cwd: Optional[Path] = None,
    check: bool = False,
    capture: bool = True,
    timeout: int = 120,
) -> subprocess.CompletedProcess[str]:
    command = (["sudo"] + cmd) if sudo and os.geteuid() != 0 else cmd
    return subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        capture_output=capture,
        text=True,
        check=check,
        timeout=timeout,
    )


def sudo_write(path: Path, content: str, mode: int = 0o644) -> None:
    # Escreve arquivo em diretório temporário e instala com sudo.
    tmp = Path("/tmp") / f".integrit-lab-{os.getpid()}-{path.name}"
    tmp.write_text(content, encoding="utf-8")
    try:
        run(["install", "-D", "-m", oct(mode)[2:], str(tmp), str(path)], sudo=True, check=True)
    finally:
        tmp.unlink(missing_ok=True)


def sudo_mkdir(path: Path, mode: int = 0o755) -> None:
    run(["mkdir", "-p", str(path)], sudo=True, check=True)
    run(["chmod", oct(mode)[2:], str(path)], sudo=True, check=True)


def validate_domain(value: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", value))


def validate_ip(value: str) -> bool:
    try:
        socket.inet_aton(value)
        return value.count(".") == 3
    except OSError:
        return False


def collect_config() -> Config:
    print("\n" + "=" * 72)
    print("LABORATÓRIO INTEGRIT — RECONSTRUÇÃO LIMPA")
    print("=" * 72)
    print("O host e a rede são considerados pré-configurados.")
    print("O script começará pela criação de /opt/infra-lab.\n")

    detected_ip = detect_primary_ip()
    detected_gw = detect_gateway()
    current_hostname = socket.gethostname()

    hostname = ask("Nome do host", DEFAULT_HOSTNAME)
    install_dir = Path(ask("Local de instalação", DEFAULT_INSTALL)).expanduser()
    primary_domain = ask("Domínio", DEFAULT_DOMAIN).lower().rstrip(".")
    others = ask("Outros domínios (separados por vírgula)", DEFAULT_OTHER_DOMAINS)
    admin_user = ask("Username de administração", DEFAULT_ADMIN_USER)

    host_ip = ask("IP do host (detectado; não será alterado)", detected_ip)
    gateway = ask("Gateway (detectado; não será alterado)", detected_gw)

    if not validate_domain(primary_domain):
        raise ValueError(f"Domínio inválido: {primary_domain}")

    other_domains = []
    for item in others.split(","):
        d = item.strip().lower().rstrip(".")
        if d:
            if not validate_domain(d):
                raise ValueError(f"Domínio inválido: {d}")
            other_domains.append(d)

    if not validate_ip(host_ip):
        raise ValueError(f"IP inválido: {host_ip}")

    print("\nConfiguração do host:")
    print(f"  hostname atual : {current_hostname}")
    print(f"  hostname alvo  : {hostname}")
    print(f"  IP             : {host_ip}")
    print(f"  gateway        : {gateway or '(não detectado)'}")
    print(f"  instalação     : {install_dir}")
    print(f"  domínio        : {primary_domain}")
    print(f"  outros domínios: {', '.join(other_domains) or '(nenhum)'}")
    print(f"  admin          : {admin_user}")

    if current_hostname != hostname:
        warn(
            f"O hostname atual é '{current_hostname}', mas foi informado '{hostname}'. "
            "O script NÃO irá alterar o hostname do SO."
        )

    admin_password = ask_password()

    confirm = ask("\nContinuar com esta configuração? (s/n)", "s").lower()
    if confirm not in ("s", "sim", "y", "yes"):
        raise SystemExit("Operação cancelada.")

    return Config(
        hostname=hostname,
        install_dir=install_dir,
        primary_domain=primary_domain,
        other_domains=other_domains,
        admin_user=admin_user,
        admin_password=admin_password,
        host_ip=host_ip,
        gateway=gateway,
    )


def generate_coredns(cfg: Config) -> str:
    # Mantém a mesma convenção do baseline atual: os serviços lógicos do host
    # resolvem para o IP do host, enquanto a comunicação entre containers usa
    # nomes Docker.
    lines = [
        ". {",
        f"    forward . {cfg.dns_upstream_1} {cfg.dns_upstream_2}",
        "    log",
        "    errors",
        "}",
        "",
        f"{cfg.primary_domain}:53 {{",
        "    hosts {",
        f"        {cfg.host_ip} ns01.{cfg.primary_domain}",
        f"        {cfg.host_ip} idm01.{cfg.primary_domain}",
        f"        {cfg.host_ip} hsm01.{cfg.primary_domain}",
        f"        {cfg.host_ip} db01.{cfg.primary_domain}",
        f"        {cfg.host_ip} db02.{cfg.primary_domain}",
        f"        {cfg.host_ip} proxy01.{cfg.primary_domain}",
        f"        {cfg.host_ip} web01.{cfg.primary_domain}",
    ]

    lines += ["        fallthrough", "    }", "    log", "    errors", "}"]

    # Arandu/Tupã e quaisquer outros domínios informados recebem a convenção
    # arandu.internal/www + idm01, e tupa.internal/www.
    for domain in cfg.other_domains:
        records = [domain, f"www.{domain}"]
        if domain == "arandu.internal":
            records.append(f"idm01.{domain}")
        lines += [
            "",
            f"{domain}:53 {{",
            "    hosts {",
            *[f"        {cfg.host_ip} {r}" for r in records],
            "        fallthrough",
            "    }",
            "    log",
            "    errors",
            "}",
        ]

    return "\n".join(lines) + "\n"


def generate_haproxy(cfg: Config) -> str:
    keycloak_hosts = [
        f"idm01.{cfg.primary_domain}",
        *[f"idm01.{d}" for d in cfg.other_domains],
    ]
    keycloak_acl = " ".join(keycloak_hosts)

    return f"""global
    log stdout format raw local0
    maxconn 2048

defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s
    option httplog

frontend http_in
    bind *:80

    acl host_keycloak hdr(host) -i {keycloak_acl}
    acl host_openbao hdr(host) -i hsm01.{cfg.primary_domain}

    use_backend openbao if host_openbao
    use_backend keycloak if host_keycloak

    default_backend nginx_proxy

backend nginx_proxy
    balance roundrobin
    option httpchk
    http-check send meth GET uri / ver HTTP/1.1 hdr Host proxy01.{cfg.primary_domain}
    server nginx-proxy-01 nginx-proxy:80 check

backend keycloak
    option httpchk
    http-check send meth GET uri / ver HTTP/1.1 hdr Host idm01.{cfg.primary_domain}
    server keycloak-01 keycloak:8080 check

backend openbao
    option httpchk
    http-check send meth GET uri /ui/ ver HTTP/1.1 hdr Host hsm01.{cfg.primary_domain}
    server openbao-01 openbao:8200 check

frontend stats
    bind *:8404
    stats enable
    stats uri /stats
    stats refresh 10s
"""


def generate_openbao(cfg: Config) -> str:
    return f"""storage "raft" {{
  path    = "/bao/data"
  node_id = "{cfg.hostname}-openbao-node-1"
}}

listener "tcp" {{
  address     = "0.0.0.0:8200"
  tls_disable = "true"
}}

api_addr     = "http://{cfg.host_ip}:8200"
cluster_addr = "http://{cfg.host_ip}:8201"
ui           = true
"""


def generate_compose(cfg: Config) -> str:
    # Imagens fixadas por família principal, evitando que uma reconstrução
    # mude de comportamento por causa de um "latest" inesperado.
    # Podem ser alteradas pelo administrador depois do primeiro baseline.
    return f"""name: {COMPOSE_PROJECT}

services:
  postgres:
    image: postgres:18
    container_name: postgres
    hostname: db01
    restart: unless-stopped
    environment:
      POSTGRES_DB: {POSTGRES_DB}
      POSTGRES_USER: {POSTGRES_USER}
      POSTGRES_PASSWORD: ${{LAB_DB_PASSWORD}}
    volumes:
      - ./postgres/data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U {POSTGRES_USER} -d {POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 10
    networks:
      - lab-network

  mariadb:
    image: mariadb:11
    container_name: mariadb
    hostname: db02
    restart: unless-stopped
    environment:
      MARIADB_ROOT_PASSWORD: ${{LAB_DB_PASSWORD}}
      MARIADB_DATABASE: lab
      MARIADB_USER: lab
      MARIADB_PASSWORD: ${{LAB_DB_PASSWORD}}
    volumes:
      - ./mariadb/data:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mariadb-admin ping -h 127.0.0.1 -uroot -p$${{MARIADB_ROOT_PASSWORD}} --silent"]
      interval: 10s
      timeout: 5s
      retries: 10
    networks:
      - lab-network

  keycloak:
    image: quay.io/keycloak/keycloak:latest
    container_name: keycloak
    hostname: idm01
    restart: unless-stopped
    command:
      - start-dev
      - --http-port=8080
      - --http-enabled=true
      - --hostname-strict=false
      - --proxy-headers=xforwarded
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: ${{LAB_ADMIN_USER}}
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${{LAB_ADMIN_PASSWORD}}
      KC_DB: postgres
      KC_DB_URL: jdbc:postgresql://postgres:5432/{POSTGRES_DB}
      KC_DB_USERNAME: {POSTGRES_USER}
      KC_DB_PASSWORD: ${{LAB_DB_PASSWORD}}
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - lab-network

  openbao:
    image: openbao/openbao:latest
    container_name: openbao
    hostname: hsm01
    restart: unless-stopped
    ports:
      - "8200:8200"
      - "8201:8201"
    cap_add:
      - IPC_LOCK
    volumes:
      - ./openbao/config:/bao/config
      - ./openbao/data:/bao/data
    command: bao server -config=/bao/config/config.hcl
    networks:
      - lab-network

  nginx-proxy:
    image: nginx:latest
    container_name: nginx-proxy
    hostname: proxy01
    restart: unless-stopped
    volumes:
      - ./nginx/html:/usr/share/nginx/html:ro
    networks:
      - lab-network

  coredns:
    image: coredns/coredns:latest
    container_name: coredns
    hostname: ns01
    restart: unless-stopped
    ports:
      - "53:53/udp"
      - "53:53/tcp"
    volumes:
      - ./coredns/Corefile:/Corefile:ro
    command: -conf /Corefile
    networks:
      - lab-network

  haproxy:
    image: haproxy:3.2
    container_name: haproxy
    hostname: proxy-entry
    restart: unless-stopped
    ports:
      - "80:80"
      - "8404:8404"
    volumes:
      - ./haproxy/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    depends_on:
      - nginx-proxy
      - keycloak
      - openbao
    networks:
      - lab-network

networks:
  lab-network:
    name: {COMPOSE_PROJECT}_lab-network
    driver: bridge
"""


def generate_env(cfg: Config) -> str:
    return (
        f"LAB_ADMIN_USER={cfg.admin_user}\n"
        f"LAB_ADMIN_PASSWORD={cfg.admin_password}\n"
        f"LAB_DB_PASSWORD={cfg.admin_password}\n"
        f"LAB_HOSTNAME={cfg.hostname}\n"
        f"LAB_HOST_IP={cfg.host_ip}\n"
        f"LAB_DOMAIN={cfg.primary_domain}\n"
    )


def write_baseline(cfg: Config) -> None:
    base = cfg.install_dir
    dirs = [
        base,
        base / "coredns",
        base / "haproxy",
        base / "openbao/config",
        base / "openbao/data",
        base / "postgres/data",
        base / "mariadb/data",
        base / "nginx/html",
        base / "reports",
    ]

    log(f"Criando estrutura em {base}")
    for d in dirs:
        sudo_mkdir(d)

    sudo_write(base / "docker-compose.yml", generate_compose(cfg))
    sudo_write(base / "coredns/Corefile", generate_coredns(cfg))
    sudo_write(base / "haproxy/haproxy.cfg", generate_haproxy(cfg))
    sudo_write(base / "openbao/config/config.hcl", generate_openbao(cfg))
    sudo_write(
        base / "nginx/html/index.html",
        f"""<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>Laboratório Integrit</title></head>
<body>
<h1>Laboratório Integrit</h1>
<p>Backend nginx-proxy em {cfg.hostname}.</p>
</body>
</html>
""",
    )

    # .env contém o segredo administrativo e deve ser protegido.
    sudo_write(base / ".env", generate_env(cfg), mode=0o600)

    # Manifesto sem senha.
    manifest = {
        "hostname": cfg.hostname,
        "install_dir": str(cfg.install_dir),
        "primary_domain": cfg.primary_domain,
        "other_domains": cfg.other_domains,
        "host_ip": cfg.host_ip,
        "gateway": cfg.gateway,
        "keycloak_fqdn": cfg.keycloak_fqdn,
        "openbao_fqdn": cfg.openbao_fqdn,
        "postgres_fqdn": cfg.postgres_fqdn,
        "mariadb_fqdn": cfg.mariadb_fqdn,
        "proxy_fqdn": cfg.proxy_fqdn,
        "docker_network": f"{COMPOSE_PROJECT}_lab-network",
        "created_by": "reconstruir_lab_integrit.py",
    }
    sudo_write(
        base / "lab-manifest.json",
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
    )

    # Pequeno README operacional para o próprio diretório.
    readme = f"""# Laboratório Integrit — {cfg.hostname}

Reconstruído automaticamente a partir do baseline do Laboratório Integrit.

## Comandos

```bash
cd {cfg.install_dir}
sudo docker compose ps
sudo docker compose logs --tail 100
sudo docker compose restart haproxy
```

## Endpoints

- Keycloak: http://{cfg.keycloak_fqdn}/
- OpenBao: http://{cfg.openbao_fqdn}/
- OpenBao direto: http://{cfg.host_ip}:8200/ui/
- HAProxy Stats: http://{cfg.host_ip}:8404/stats
- Nginx default: http://{cfg.proxy_fqdn}/

## Observação

O OpenBao foi apenas instalado/iniciado. Inicialização, unseal e política de
cluster devem ser executados como uma etapa explícita e segura.
"""
    sudo_write(base / "README.md", readme)


def compose(cfg: Config, args: list[str], timeout: int = 180) -> subprocess.CompletedProcess[str]:
    return run(
        ["docker", "compose", *args],
        sudo=True,
        cwd=cfg.install_dir,
        timeout=timeout,
    )


def add_check(name: str, ok: bool, detail: str, expected: str = "") -> None:
    CHECKS.append(
        Check(
            name=name,
            ok=ok,
            detail=detail.replace("\n", " ")[:500],
            expected=expected,
            severity="OK" if ok else "FAIL",
        )
    )


def test_compose(cfg: Config) -> None:
    p = compose(cfg, ["config"], timeout=60)
    add_check(
        "Docker Compose config",
        p.returncode == 0,
        p.stderr or p.stdout,
        "configuração válida",
    )


def start_services(cfg: Config) -> None:
    log("Baixando imagens e iniciando serviços...")
    p = compose(cfg, ["up", "-d"], timeout=600)
    if p.returncode != 0:
        fail(p.stderr or p.stdout)
        raise RuntimeError("docker compose up -d falhou.")
    log("Serviços iniciados.")


def wait_for_containers(cfg: Config, seconds: int = 60) -> None:
    log("Aguardando os containers estabilizarem...")
    deadline = time.time() + seconds
    while time.time() < deadline:
        p = compose(cfg, ["ps", "--format", "json"], timeout=30)
        if p.returncode == 0 and p.stdout.strip():
            # Não exige todos os serviços como "healthy", porque alguns
            # serviços do baseline não possuem healthcheck.
            if "Up" in p.stdout or '"State":"running"' in p.stdout:
                time.sleep(3)
                return
        time.sleep(2)


def test_docker(cfg: Config) -> None:
    p = compose(cfg, ["ps"], timeout=60)
    add_check(
        "Docker Compose / containers",
        p.returncode == 0,
        p.stdout or p.stderr,
        "containers em execução",
    )

    p = run(
        ["docker", "inspect", "haproxy", "--format",
         "{{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{end}}"],
        sudo=True,
        timeout=30,
    )
    expected = f"{COMPOSE_PROJECT}_lab-network"
    add_check(
        "Rede Docker do HAProxy",
        p.returncode == 0 and expected in p.stdout,
        p.stdout or p.stderr,
        expected,
    )

    p = run(["docker", "exec", "haproxy", "getent", "hosts", "openbao"],
            sudo=True, timeout=30)
    add_check(
        "DNS Docker: HAProxy → OpenBao",
        p.returncode == 0 and bool(p.stdout.strip()),
        p.stdout or p.stderr,
        "resolução de openbao",
    )


def dns_query(name: str, server: str, qtype: int = 1, timeout: float = 2.0) -> list[str]:
    """
    Consulta DNS A usando apenas a biblioteca padrão.
    qtype 1 = A.
    """
    import random
    import struct

    tid = random.randint(0, 65535)
    header = struct.pack("!HHHHHH", tid, 0x0100, 1, 0, 0, 0)
    question = b"".join(
        bytes([len(part)]) + part.encode("ascii")
        for part in name.rstrip(".").split(".")
    ) + b"\x00" + struct.pack("!HH", qtype, 1)

    packet = header + question
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        s.sendto(packet, (server, 53))
        data, _ = s.recvfrom(4096)
    finally:
        s.close()

    if len(data) < 12:
        raise RuntimeError("resposta DNS inválida")

    _, flags, qdcount, ancount, _, _ = struct.unpack("!HHHHHH", data[:12])
    if flags & 0x000F:
        raise RuntimeError(f"DNS rcode={flags & 0x000F}")

    offset = 12

    def skip_name(pos: int) -> int:
        while True:
            length = data[pos]
            if length == 0:
                return pos + 1
            if length & 0xC0 == 0xC0:
                return pos + 2
            pos += 1 + length

    for _ in range(qdcount):
        offset = skip_name(offset) + 4

    answers = []
    for _ in range(ancount):
        offset = skip_name(offset)
        if offset + 10 > len(data):
            break
        rtype, rclass, ttl, rdlength = struct.unpack(
            "!HHIH", data[offset:offset + 10]
        )
        offset += 10
        rdata = data[offset:offset + rdlength]
        offset += rdlength
        if rtype == 1 and rdlength == 4:
            answers.append(socket.inet_ntoa(rdata))
    return answers


def test_dns(cfg: Config) -> None:
    names = [
        cfg.keycloak_fqdn,
        cfg.openbao_fqdn,
        cfg.postgres_fqdn,
        cfg.mariadb_fqdn,
        cfg.proxy_fqdn,
    ]
    if "arandu.internal" in cfg.other_domains:
        names.append("idm01.arandu.internal")
    if "tupa.internal" in cfg.other_domains:
        names.append("www.tupa.internal")

    for name in names:
        try:
            answers = dns_query(name, cfg.host_ip)
            ok = cfg.host_ip in answers
            add_check(
                f"DNS A {name}",
                ok,
                ", ".join(answers) or "sem resposta A",
                cfg.host_ip,
            )
        except Exception as exc:
            add_check(f"DNS A {name}", False, str(exc), cfg.host_ip)


def tcp_test(host: str, port: int, timeout: float = 3.0) -> tuple[bool, str]:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, "conexão TCP estabelecida"
    except OSError as exc:
        return False, str(exc)


def test_tcp(cfg: Config) -> None:
    for label, port in [
        ("PostgreSQL", 5432),
        ("MariaDB", 3306),
        ("OpenBao direto", 8200),
        ("HAProxy HTTP", 80),
        ("HAProxy Stats", 8404),
        ("DNS UDP", 53),
    ]:
        if port == 53:
            # TCP é usado aqui como teste adicional; DNS real é validado acima.
            ok, detail = tcp_test(cfg.host_ip, 53)
        else:
            ok, detail = tcp_test(cfg.host_ip, port)
        add_check(f"TCP {label}:{port}", ok, detail, "porta acessível")


def http_request(url: str, host_header: Optional[str] = None, timeout: int = 8):
    req = urllib.request.Request(url, method="GET")
    if host_header:
        req.add_header("Host", host_header)
    opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
    try:
        with opener.open(req, timeout=timeout) as resp:
            return resp.status, resp.geturl(), resp.headers
    except urllib.error.HTTPError as exc:
        return exc.code, exc.geturl(), exc.headers


def test_http(cfg: Config) -> None:
    tests = [
        (
            "HAProxy → Keycloak",
            f"http://{cfg.host_ip}/",
            cfg.keycloak_fqdn,
            {200, 301, 302, 303, 307, 308},
        ),
        (
            "HAProxy → OpenBao",
            f"http://{cfg.host_ip}/",
            cfg.openbao_fqdn,
            {200, 301, 302, 303, 307, 308},
        ),
        (
            "HAProxy → Nginx",
            f"http://{cfg.host_ip}/",
            cfg.proxy_fqdn,
            {200, 301, 302, 303, 307, 308},
        ),
    ]

    for label, url, host, accepted in tests:
        try:
            status, final_url, _ = http_request(url, host)
            ok = status in accepted
            add_check(
                label,
                ok,
                f"HTTP {status}; URL final={final_url}",
                "resposta HTTP válida",
            )
        except Exception as exc:
            add_check(label, False, str(exc), "resposta HTTP válida")

    try:
        status, final_url, _ = http_request(
            f"http://{cfg.host_ip}:8200/ui/",
            None,
        )
        add_check(
            "OpenBao direto :8200",
            status in {200, 301, 302, 303, 307, 308},
            f"HTTP {status}; URL final={final_url}",
            "HTTP 200 ou redirecionamento",
        )
    except Exception as exc:
        add_check("OpenBao direto :8200", False, str(exc), "HTTP acessível")


def test_service_logs(cfg: Config) -> None:
    for container in ["coredns", "haproxy", "keycloak", "openbao", "postgres", "mariadb", "nginx-proxy"]:
        p = run(
            ["docker", "inspect", "-f", "{{.State.Running}}", container],
            sudo=True,
            timeout=30,
        )
        add_check(
            f"Container {container}",
            p.returncode == 0 and p.stdout.strip() == "true",
            p.stdout or p.stderr,
            "running=true",
        )


def write_report(cfg: Config) -> Path:
    report_dir = cfg.install_dir / "reports"
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    report_path = report_dir / f"baseline-{timestamp}.md"

    passed = sum(1 for c in CHECKS if c.ok)
    failed = len(CHECKS) - passed

    lines = [
        f"# Relatório de validação — Laboratório Integrit",
        "",
        f"- Data: `{time.strftime('%Y-%m-%d %H:%M:%S %z')}`",
        f"- Hostname alvo: `{cfg.hostname}`",
        f"- IP: `{cfg.host_ip}`",
        f"- Instalação: `{cfg.install_dir}`",
        f"- Domínio principal: `{cfg.primary_domain}`",
        f"- Resultado: **{passed} OK / {failed} falhas**",
        "",
        "## Checklist",
        "",
        "| Status | Teste | Detalhe | Esperado |",
        "|---|---|---|---|",
    ]

    for c in CHECKS:
        status = "PASS" if c.ok else "FAIL"
        lines.append(
            f"| {status} | {c.name} | {c.detail.replace('|', '/')} | "
            f"{c.expected.replace('|', '/')} |"
        )

    lines += [
        "",
        "## Endpoints",
        "",
        f"- Keycloak: `http://{cfg.keycloak_fqdn}/`",
        f"- OpenBao: `http://{cfg.openbao_fqdn}/`",
        f"- OpenBao direto: `http://{cfg.host_ip}:8200/ui/`",
        f"- HAProxy Stats: `http://{cfg.host_ip}:8404/stats`",
        f"- Nginx: `http://{cfg.proxy_fqdn}/`",
        "",
        "## Próximas etapas",
        "",
        "- Inicializar/unseal o OpenBao de forma controlada.",
        "- Validar criação dos realms/clientes do Keycloak conforme o laboratório.",
        "- Registrar o baseline no repositório de infraestrutura.",
        "- Ao disponibilizar o Host 02, tratar DNS, HAProxy, OpenBao e bancos como "
          "componentes de alta disponibilidade explicitamente; não duplicar estado cegamente.",
    ]

    sudo_write(report_path, "\n".join(lines) + "\n")
    return report_path


def print_report(cfg: Config, report_path: Path) -> int:
    passed = sum(1 for c in CHECKS if c.ok)
    failed = len(CHECKS) - passed

    print("\n" + "=" * 90)
    print("RELATÓRIO FINAL — LABORATÓRIO INTEGRIT")
    print("=" * 90)
    print(f"Host       : {cfg.hostname}")
    print(f"IP         : {cfg.host_ip}")
    print(f"Instalação : {cfg.install_dir}")
    print(f"Domínio    : {cfg.primary_domain}")
    print("-" * 90)

    for c in CHECKS:
        symbol = "✓" if c.ok else "✗"
        print(f"{symbol} {c.name}: {c.detail}")

    print("-" * 90)
    print(f"TOTAL: {passed} OK / {failed} FALHAS")
    print(f"Relatório: {report_path}")
    print("=" * 90)

    if failed:
        print("\nHá falhas de validação. Não considerar o host como baseline aprovado.")
        return 1

    print("\nBaseline técnico aprovado pelos testes automatizados.")
    print("Atenção: OpenBao ainda requer inicialização/unseal/políticas se for uma instalação nova.")
    return 0


def main() -> int:
    if os.name != "posix":
        fail("Este script foi projetado para Linux/Ubuntu.")
        return 2

    if shutil.which("docker") is None:
        fail("Docker não encontrado no PATH.")
        return 2

    if shutil.which("sudo") is None and os.geteuid() != 0:
        fail("sudo não encontrado e o script não está sendo executado como root.")
        return 2

    try:
        cfg = collect_config()

        write_baseline(cfg)

        # Validação estática antes de iniciar qualquer serviço.
        test_compose(cfg)

        if CHECKS and not CHECKS[-1].ok:
            warn("docker compose config apresentou erro; corrigir antes de subir o laboratório.")
            return print_report(cfg, write_report(cfg))

        start_services(cfg)
        wait_for_containers(cfg)

        test_docker(cfg)
        test_dns(cfg)
        test_tcp(cfg)
        test_http(cfg)
        test_service_logs(cfg)

        report_path = write_report(cfg)
        return print_report(cfg, report_path)

    except KeyboardInterrupt:
        print("\nOperação interrompida pelo usuário.")
        return 130
    except Exception as exc:
        fail(f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
