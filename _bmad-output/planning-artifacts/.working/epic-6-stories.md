# Epic 6: CLI Completo e Developer Experience (rascunho, Stories 6.1 a 6.11)

> Rascunho para revisão. Depois de aprovado, entra no `epics.md` na seção do Epic 6. Decisões de 2026-10-05 já registradas na spine (AD-8): `extract` com adaptador legado no domínio (X1) e porta `LegacyAuthBridge` com adaptadores prontos (L1). A ponte de autenticação virou story própria (6.8), por isso o épico tem 11 stories em vez das 10 da quebra inicial.

### Story 6.1: Dev Services

Como **dev começando num workspace Tecton**,
quero a infraestrutura de desenvolvimento pronta num único arquivo,
para subir banco e Valkey sem configurar nada à mão (FR-30).

**Critérios de Aceite:**

**Dado** `tecton-admin new <projeto> --db postgres|mysql|mssql` (padrão: `postgres`)
**Quando** ele roda
**Então** gera `docker-compose.dev.yml` com Valkey 9.1 e o banco escolhido (FR-30)
**E** cada serviço (Auth, Directory e cada domínio) tem seu banco lógico próprio, criado na primeira subida
**E** o arquivo de exemplo de ambiente já aponta para esses bancos e para o Valkey

**Dado** `tecton-admin generate domain <nome>`
**Quando** ele roda depois desta story
**Então** o banco lógico do domínio novo é acrescentado ao Dev Services

**Dado** o `docker-compose.dev.yml` em execução
**Quando** eu rodo `tecton-admin dev`
**Então** o ambiente sobe sem nenhum passo adicional de infraestrutura (FR-30)

**Dado** o arquivo gerado
**Quando** eu o leio
**Então** um comentário em inglês avisa que ele é só para desenvolvimento, não para produção

### Story 6.2: `tecton-admin migrate`

Como **dev que alterou o schema de um serviço**,
quero aplicar as migrations de todos os serviços com um comando,
para manter cada banco em dia sem entrar serviço por serviço (FR-15).

**Critérios de Aceite:**

**Dado** um workspace com Auth, Directory e domínios
**Quando** eu rodo `tecton-admin migrate`
**Então** as migrations Prisma pendentes de cada serviço são aplicadas no banco próprio dele
**E** `--domain <nome>` limita a execução a um serviço

**Dado** uma mudança no schema Prisma de um domínio
**Quando** eu rodo `tecton-admin migrate create <domínio> <nome>`
**Então** é criada a migration correspondente no domínio

**Dado** uma falha na migration de um serviço
**Quando** ela acontece
**Então** o comando para, indica o serviço e o erro e lista o que já foi aplicado nos outros

**Dado** uma URL de banco ausente ou inválida
**Quando** o comando roda
**Então** ele falha com a mensagem do `ConfigProvider` (Story 3.1)

**Dado** os três bancos suportados
**Quando** os testes desta story rodam
**Então** o comando funciona nos três

### Story 6.3: `tecton-admin dev`

Como **dev no dia a dia**,
quero subir o sistema inteiro com um comando e ver minhas mudanças sem reiniciar nada à mão,
para desenvolver com ciclo curto de feedback (FR-15).

**Critérios de Aceite:**

**Dado** o Dev Services parado
**Quando** eu rodo `tecton-admin dev`
**Então** ele sobe o `docker-compose.dev.yml` e espera banco e Valkey ficarem prontos (FR-15, FR-30)

**Dado** migrations pendentes
**Quando** o `dev` inicia
**Então** elas são aplicadas e registradas na saída

**Dado** o workspace
**Quando** o `dev` termina de subir
**Então** Gateway, Auth, Directory (com a SPA `/admin`) e todos os domínios estão rodando via `turbo run dev`, com `tsx watch`
**E** a saída mostra, em inglês, os endereços do Gateway e do `/admin`

**Dado** uma alteração num arquivo de um domínio
**Quando** eu salvo
**Então** só aquele serviço reinicia

**Dado** um serviço que falha ao subir (ex.: configuração inválida)
**Quando** isso acontece
**Então** a saída indica o serviço e o erro, e os outros continuam rodando

**Dado** um workspace sem nenhuma credencial
**Quando** o `dev` sobe
**Então** a saída sugere rodar `tecton-admin auth bootstrap`

**Dado** `Ctrl+C`
**Quando** eu interrompo
**Então** todos os serviços param de forma limpa e o Dev Services continua rodando

### Story 6.4: `tecton-admin lint:gateway` e template de CI

Como **mantenedor de um sistema construído com o Tecton**,
quero que o build falhe se o Gateway ganhar dependências proibidas,
para que ele nunca acumule circuit breaker, cache ou lógica de domínio sem decisão explícita (FR-17, AD-8).

**Critérios de Aceite:**

**Dado** o `apps/gateway`
**Quando** eu rodo `tecton-admin lint:gateway`
**Então** as dependências do `package.json` e os imports do código são comparados com a allowlist versionada junto com o framework
**E** qualquer pacote de circuit breaker, de cache de resposta, de domínio, `@tecton/directory` ou `@tecton/ui` faz o comando falhar, indicando a dependência e a regra (FR-19, AD-8)

**Dado** o resultado
**Quando** o comando termina
**Então** sai com código 0 sem violação e diferente de 0 com violação, funcionando em qualquer plataforma de CI (FR-17)
**E** aceita `--format json`

**Dado** `tecton-admin lint`
**Quando** ele roda depois desta story
**Então** executa toda a família (manifests e Gateway); os subcomandos continuam disponíveis separadamente

**Dado** um workspace novo
**Quando** eu rodo `tecton-admin new`
**Então** é gerado um workflow do GitHub Actions que roda `lint`, `test:contracts` e os testes, e falha o build numa violação do Gateway (FR-17)

### Story 6.5: Aviso de `sensitive.quorum` sem `KeyCustodyProvider`

Como **dev que marcou actions como `sensitive.quorum`**,
quero ser avisado no build quando o domínio não tem provider de custódia configurado,
para nunca ir para produção achando que existe proteção de quórum quando não existe (FR-17, FR-11).

**Critérios de Aceite:**

**Dado** um domínio com action `sensitive.quorum` e sem `KeyCustodyProvider` na configuração dele
**Quando** eu rodo `tecton-admin lint`
**Então** aparece um aviso (em inglês) por action, com domínio e nome da action (FR-11)
**E** o código de saída não muda por causa do aviso

**Dado** a opção `--strict`
**Quando** o lint encontra esse caso
**Então** o comando falha

**Dado** um domínio com o provider configurado
**Quando** o lint roda
**Então** não há aviso

### Story 6.6: Testcontainers e verificação de contrato pelo provedor

Como **mantenedor que roda testes no CI**,
quero que os testes usem containers descartáveis e que os contratos sejam verificados contra o provedor rodando de verdade,
para ter isolamento real e saber que a resposta real bate com o que os consumidores esperam (FR-31).

**Critérios de Aceite:**

**Dado** os testes de integração do framework e os do workspace gerado
**Quando** rodam no CI
**Então** usam Testcontainers para banco e Valkey, descartados ao final de cada execução (FR-31)
**E** não dependem de nenhuma infraestrutura externa persistente (FR-31)

**Dado** `tecton-admin test:contracts --verify-providers`
**Quando** ele roda
**Então** cada provedor sobe contra containers descartáveis, recebe requisições montadas a partir dos snapshots dos consumidores (Story 5.7) e tem as respostas reais conferidas contra o que esses consumidores esperam
**E** uma diferença faz o comando falhar, indicando provedor, action, consumidor e campo

**Dado** duas execuções seguidas de `test:contracts`
**Quando** a segunda roda
**Então** não compartilha nenhum dado com a primeira (FR-31)

**Dado** uma máquina sem Docker disponível
**Quando** um comando que usa Testcontainers roda
**Então** falha com mensagem clara dizendo que precisa de Docker

### Story 6.7: `extract`, parte 1: domínio novo e adaptador legado

Como **dev migrando um domínio de um monólito maduro**,
quero gerar o domínio novo e um adaptador que entenda a API antiga,
para que os clientes do monólito continuem chamando os mesmos endereços enquanto o domínio novo assume (FR-16, decisão X1).

**Critérios de Aceite:**

**Dado** um manifest do domínio escrito pelo dev ou por agente de IA
**Quando** eu rodo `tecton-admin extract <domínio> --manifest <arquivo>`
**Então** o domínio é gerado como na Story 3.4, usando esse manifest
**E** o comando não tenta descobrir limites de domínio sozinho (PRD §5)

**Dado** um arquivo de rotas legadas (método, caminho e action de destino)
**Quando** eu o passo com `--legacy-routes <arquivo>`
**Então** é gerado um adaptador de entrada legado em `src/adapters/legacy`, com um tradutor por rota: requisição legada para `input` da action, `output` para resposta legada, e erro para o formato de erro legado
**E** os tradutores nascem como stubs que o dev completa

**Dado** uma requisição recebida pelo adaptador legado
**Quando** ela é traduzida
**Então** a action é executada pelo mesmo caminho de qualquer chamada, com validação, verificação de identidade (Story 6.8) e ACL, nunca por atalho

**Dado** a tradução entre os formatos
**Quando** eu verifico onde ela acontece
**Então** acontece só no adaptador do domínio, nunca no Gateway (FR-19, AD-8)

### Story 6.8: `LegacyAuthBridge` com adaptadores prontos

Como **dev migrando um domínio cujos clientes autenticam no monólito**,
quero que o domínio novo aceite a credencial do monólito sem eu escrever código de autenticação,
para que o desvio funcione sem mudar os clientes e sem abrir mão do Zero Trust (FR-16, AD-7, decisão L1).

**Critérios de Aceite:**

**Dado** a porta `LegacyAuthBridge` em `@tecton/providers`
**Quando** o adaptador legado recebe uma requisição
**Então** a credencial do monólito é verificada pelo próprio domínio através da ponte, antes de chamar a action (AD-7)
**E** credencial ausente ou inválida resulta em 401 no formato de erro legado

**Dado** os adaptadores prontos entregues pelo framework
**Quando** eu configuro a ponte por arquivo
**Então** posso escolher entre: (1) endpoint de sessão do monólito, que recebe o cookie ou header repassado e devolve o identificador do usuário; (2) JWT do monólito, verificado por JWKS ou chave pública, com o claim do identificador configurável; (3) introspecção OAuth2 (RFC 7662)
**E** só preciso escrever classe própria se o monólito usar outro mecanismo

**Dado** um JWT do monólito assinado com segredo compartilhado (HS256)
**Quando** a ponte é configurada para ele
**Então** funciona, mas o startup registra um aviso de que o segredo dá ao domínio o poder de emitir tokens do monólito

**Dado** o identificador do usuário no monólito
**Quando** a ponte o obtém
**Então** ele é convertido no sujeito do Tecton consultando o Directory pelo `ServiceClient`, por um atributo de identificador legado configurável no `User`
**E** um usuário sem correspondência no Directory resulta em 401

**Dado** o adaptador de endpoint de sessão
**Quando** ele valida a mesma credencial várias vezes
**Então** o resultado fica em cache por tempo configurável (padrão de 30 segundos)
**E** esse tempo é o atraso máximo para um logout no monólito valer no domínio novo, e isso está escrito na documentação da ponte

**Dado** o monólito inacessível
**Quando** a ponte precisa verificar uma credencial fora do cache
**Então** a requisição é rejeitada (fail-closed)

### Story 6.9: `extract`, parte 2: fachada no Gateway e janela de manutenção

Como **dev migrando um domínio**,
quero desviar as rotas legadas para o domínio novo de forma gradual e controlada,
para validar o domínio novo antes de assumir 100% do tráfego (FR-16).

**Critérios de Aceite:**

**Dado** o `extract`
**Quando** ele termina
**Então** o Gateway ganha uma regra de fachada para as rotas legadas do domínio, inicialmente 100% para o monólito

**Dado** a regra de fachada
**Quando** eu a configuro
**Então** posso desviar por rota, por percentual ou por flag (FR-16)
**E** o Gateway só desvia o caminho, sem alterar corpo nem headers (FR-19)

**Dado** um desvio por percentual
**Quando** ele é configurado
**Então** a saída do comando e a documentação avisam que percentual serve só para validação em estágio, nunca como estado estável de produção (FR-16)

**Dado** `tecton-admin extract <domínio> --maintenance start`
**Quando** a janela de manutenção começa
**Então** o Gateway para de aceitar requisições novas para as rotas do domínio, respondendo 503 com `Retry-After`
**E** espera as requisições em andamento para o monólito terminarem antes de liberar o corte (FR-16)

**Dado** `--maintenance end` com a rota em 100% para o domínio novo
**Quando** a janela termina
**Então** o tráfego volta a ser aceito, já atendido pelo domínio novo

**Dado** a migração validada em 100%
**Quando** eu quero remover a fachada, o adaptador legado e a ponte
**Então** é um passo manual, descrito na documentação, que o `extract` não automatiza (FR-16)

### Story 6.10: `extract`, parte 3: exportação e importação única de dados

Como **dev migrando um domínio**,
quero mover os dados das tabelas do monólito para o banco do domínio novo uma única vez, durante a janela de manutenção,
para fazer o corte sem escrever script de migração do zero (FR-16).

**Critérios de Aceite:**

**Dado** a lista de tabelas do monólito indicadas pelo dev e um arquivo de mapeamento para o schema do domínio novo
**Quando** eu rodo `tecton-admin extract <domínio> --data-script`
**Então** é gerado um script de exportação e importação via Prisma, lendo o banco do monólito por introspecção
**E** as transformações de campo nascem como stubs que o dev completa

**Dado** o script
**Quando** ele roda
**Então** ao final compara a contagem de registros de cada tabela de origem com o destino e falha se houver diferença

**Dado** uma falha no meio da importação
**Quando** ela acontece
**Então** a importação daquela tabela é desfeita e o script indica onde parou, para ser rodado de novo sem duplicar dados

**Dado** o banco do monólito em qualquer um dos três bancos suportados
**Quando** o script roda
**Então** funciona sem mudança

**Dado** o fluxo do corte
**Quando** eu leio a documentação
**Então** ela deixa claro que o script roda uma única vez, dentro da janela de manutenção, sem sincronização contínua (FR-16)

### Story 6.11: Ajuda completa do `tecton-admin`

Como **dev ou agente de IA conhecendo o CLI**,
quero que o `--help` mostre todos os comandos, inclusive os que ainda são roadmap,
para entender a visão completa da ferramenta desde o primeiro dia (nota do FR-18).

**Critérios de Aceite:**

**Dado** `tecton-admin --help`
**Quando** eu o rodo
**Então** aparecem todos os comandos: `new`, `generate`, `dev`, `migrate`, `lint`, `lint:gateway`, `test:contracts`, `extract`, `auth` e `mcp:serve`
**E** `mcp:serve` aparece marcado como roadmap

**Dado** `tecton-admin mcp:serve`
**Quando** eu o rodo
**Então** ele informa que o comando é roadmap e sai com código diferente de 0, sem efeito colateral

**Dado** `--help` de qualquer subcomando
**Quando** eu o rodo
**Então** mostra opções e um exemplo de uso, todo em inglês (Constitution §8, eixo 2)
