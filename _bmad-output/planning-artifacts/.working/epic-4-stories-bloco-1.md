# Epic 4: Core de Diretório e Domínios Embutidos (rascunho do bloco 1, Stories 4.1 a 4.5, backend)

> Rascunho para revisão. Depois de aprovado, entra no `epics.md` na seção do Epic 4. Base: FR-6 a FR-10, AD-2, AD-9 e a decisão de 2026-10-02 sobre `perms` (o Auth consulta o Directory no login e no refresh).

### Story 4.1: Serviço `@tecton/directory` com Closure Table

Como **dev de um sistema construído com o Tecton**,
quero um Directory Service pronto que guarde objetos numa hierarquia com Closure Table,
para ter uma árvore de objetos com containment validado, portável entre os três bancos suportados.

**Critérios de Aceite:**

**Dado** um workspace novo
**Quando** eu rodo `tecton-admin new`
**Então** é gerado `apps/directory` como instância configurada de `@tecton/directory`, com dependência versionada (AD-2, AD-4)
**E** o Gateway passa a encaminhar o prefixo `/directory/` para ele

**Dado** o schema Prisma do Directory
**Quando** eu o inspeciono
**Então** existe uma tabela de objetos (ID em UUID v7, `objectClass`, nome em coluna própria para busca, atributos como bag JSON) e uma tabela de closure (ancestral, descendente, profundidade)
**E** a bag de atributos é JSONB no PostgreSQL, JSON no MySQL e texto no MS-SQL, porque o Prisma não suporta o tipo `Json` no SQL Server

**Dado** a criação de um objeto sob um pai
**Quando** a classe do pai não está em `allowedParents` do filho, ou a classe do filho não está em `allowedChildren` do pai
**Então** a criação é rejeitada e nada é gravado

**Dado** atributos de um objeto
**Quando** ele é criado ou alterado
**Então** os atributos são validados contra o JSON Schema compilado do `objectClass` (Story 1.5) antes de gravar (AD-2)
**E** atributos marcados com `x-tecton-unique` têm a unicidade verificada pela aplicação

**Dado** a action de mover um objeto (só no backend; a UI do MVP não move nada)
**Quando** ela é executada
**Então** só as linhas de closure da subárvore movida são alteradas, sem renumerar a árvore inteira (FR-6)
**E** mover um objeto para dentro de um descendente dele é rejeitado antes de qualquer alteração (FR-6)
**E** mover para um pai que viola `allowedParents` é rejeitado

**Dado** os testes de persistência do Directory
**Quando** rodam contra PostgreSQL, MySQL e MS-SQL
**Então** passam nos três sem mudança de schema nem de código de domínio (FR-6, NFR-4)

**Dado** os manifests dos `objectClass` embutidos
**Quando** o pacote `@tecton/directory` é instalado
**Então** eles ficam disponíveis para o `tecton-admin lint` resolver referências como `Root`, `User` e `Group` (Story 1.6)

### Story 4.2: Domínio Tenant

Como **operador de uma plataforma multi-tenant**,
quero criar Tenants e controlar o status de cada um,
para isolar os dados de cada cliente e suspender ou arquivar um cliente sem apagar nada (FR-9).

**Critérios de Aceite:**

**Dado** um usuário com `tenant:create`
**Quando** ele chama `createTenant`
**Então** é criado um Tenant como raiz de uma árvore própria, com status `active`

**Dado** qualquer objeto do Directory
**Quando** ele é criado
**Então** pertence, direta ou indiretamente, a um Tenant (FR-9)
**E** não existe caminho para criar objeto fora de um Tenant

**Dado** um usuário autenticado de um Tenant
**Quando** ele tenta ler ou alterar um objeto de outro Tenant
**Então** a resposta é 404, para não revelar que o objeto existe

**Dado** um Tenant `suspended`
**Quando** alguém executa uma action que altera dados num objeto descendente
**Então** a action é rejeitada com erro que indica o status do Tenant
**E** as leituras continuam disponíveis (FR-9)

**Dado** um Tenant `archived`
**Quando** alguém executa qualquer action num objeto descendente
**Então** a action é rejeitada, exceto leitura e `exportTenantData` (FR-9)

**Dado** `exportTenantData`, marcada `sensitive.quorum` no manifest do Tenant
**Quando** ela é executada sem `KeyCustodyProvider`
**Então** gera a exportação em JSON de todos os objetos do Tenant e registra o aviso da Story 2.8

### Story 4.3: Usuários, Grupos e vínculo com o Auth

Como **administrador de um Tenant**,
quero criar usuários e grupos, organizar a estrutura de equipes e associar usuários a grupos,
para representar a organização na árvore e dar a cada usuário uma credencial de acesso (FR-10).

**Critérios de Aceite:**

**Dado** os `objectClass` `User` e `Group`
**Quando** eu os uso
**Então** `Group` pode ficar dentro de um Tenant ou de outro `Group`, e `User` dentro de um Tenant ou de um `Group`, para representar departamento e equipe como containment (FR-10)

**Dado** um usuário e um grupo do mesmo Tenant
**Quando** eu chamo `addMember` ou `removeMember`
**Então** a associação usuário-grupo é gravada à parte do containment, permitindo que um usuário pertença a vários grupos

**Dado** um usuário e um papel
**Quando** eu atribuo o papel ao usuário ou a um grupo sobre um objeto
**Então** a atribuição fica gravada para o cálculo de ACL da Story 4.4

**Dado** `createUser` com uma senha inicial
**Quando** ele é executado
**Então** o Directory cria o objeto `User` e pede ao Auth, pelo `ServiceClient` com token de serviço, a criação da credencial com o mesmo ID de sujeito (FR-10)
**E** a senha inicial só trafega até o Auth e nunca é gravada nem registrada em log pelo Directory

**Dado** uma falha em qualquer etapa da criação (Auth inacessível, erro ao gravar no Directory)
**Quando** ela acontece
**Então** não sobra usuário sem credencial nem credencial sem usuário, com compensação explícita quando a credencial já tiver sido criada

**Dado** a criação de credencial no Auth
**Quando** ela é chamada por qualquer chamador que não seja `service:directory`
**Então** é recusada

**Dado** um usuário desativado
**Quando** a desativação é concluída
**Então** a credencial dele no Auth é desativada e os tokens dele são revogados (Story 2.5)

**Dado** `tecton-admin auth bootstrap` (Story 2.2)
**Quando** ele roda depois desta story
**Então** cria também o Tenant inicial e o usuário administrador correspondente no Directory

### Story 4.4: ACL por herança aditiva e `perms` do token

Como **administrador de um Tenant**,
quero dar permissão num container e vê-la valer para tudo que está dentro dele,
para gerenciar acesso por estrutura, sem configurar objeto por objeto (FR-7).

**Critérios de Aceite:**

**Dado** uma permissão concedida a um usuário ou grupo num objeto
**Quando** ela é gravada
**Então** é guardada como relação no formato sujeito, relação e objeto, compatível com um motor externo como o OpenFGA, sem precisar migrar dados para adotá-lo (FR-7)

**Dado** um objeto
**Quando** eu consulto as permissões efetivas de um usuário sobre ele
**Então** o resultado é a soma das concessões no próprio objeto e em todos os ancestrais, diretas ou pelos grupos do usuário
**E** a consulta nunca procura bloqueio ou exceção, porque o schema não tem como representar isso (FR-7)

**Dado** a listagem de objetos da árvore
**Quando** um usuário a consulta
**Então** só voltam os objetos em que ele tem permissão de leitura; os outros não aparecem de forma alguma (UX-DR6)
**E** um objeto legível cujo pai não é legível aparece como nó de topo da árvore desse usuário

**Dado** a alteração de atributos de um objeto
**Quando** o usuário não tem permissão de escrita nele (direta ou herdada)
**Então** a alteração é rejeitada

**Dado** um login ou refresh no Auth
**Quando** o access token é emitido
**Então** o Auth consulta o Directory pelo `ServiceClient` e preenche `perms` com as permissões que o usuário tem sobre a raiz do Tenant (decisão de 2026-10-02)
**E** as permissões sobre objetos específicos continuam sendo verificadas pelo Directory a cada action

**Dado** um Directory inacessível durante o login ou o refresh
**Quando** o Auth tenta consultar
**Então** o login ou o refresh falha (fail-closed), nunca emite token com `perms` vazio ou antigo

**Dado** a remoção de uma permissão
**Quando** ela é gravada
**Então** os tokens dos usuários afetados são revogados (Story 2.5), para que a perda de acesso valha imediatamente
**E** a concessão de uma permissão nova vale a partir do próximo login ou refresh

### Story 4.5: Eventos publicados pelo Directory

Como **dev de um domínio de negócio que precisa de dados do Directory**,
quero consumir eventos publicados pelo Directory,
para manter um modelo de leitura local sem nunca acessar o banco dele (AD-2, AD-9).

**Critérios de Aceite:**

**Dado** o manifest do Directory
**Quando** eu o inspeciono
**Então** ele declara em `events.publishes` pelo menos `TenantCreated`, `TenantStatusChanged`, `UserCreated`, `UserDeactivated`, `GroupCreated` e `MembershipChanged`

**Dado** uma action do Directory que gera um desses eventos
**Quando** ela é executada
**Então** o evento é gravado no outbox na mesma transação da mudança (Story 3.10)

**Dado** o payload de qualquer evento do Directory
**Quando** eu o inspeciono
**Então** ele nunca contém senha, hash ou dado de credencial

**Dado** um domínio de teste que declara `consumes` de `directory.UserCreated`
**Quando** um usuário é criado
**Então** o handler do domínio recebe o evento pela Story 3.12 e grava o próprio modelo de leitura, sem nenhum acesso ao banco do Directory

**Dado** o build do Directory
**Quando** o AsyncAPI é gerado (Story 1.8)
**Então** ele documenta todos os eventos publicados pelo Directory
