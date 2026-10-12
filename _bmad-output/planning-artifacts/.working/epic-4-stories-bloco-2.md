# Epic 4: Core de Diretório e Domínios Embutidos (rascunho do bloco 2, Stories 4.6 a 4.12, interface)

> Rascunho para revisão. Depois de aprovado, entra no `epics.md` logo após a Story 4.5. Base: FR-8, AD-10 e o contrato de UX (`DESIGN.md` + `EXPERIENCE.md`, UX-DR1 a UX-DR12).
>
> **Sobre mensagens de erro:** o Epic 5 (RFC 9457 com `title`/`detail` traduzidos) vem depois deste. Até lá, a SPA traduz os erros pelo próprio catálogo de i18n a partir do status HTTP do formato provisório. O Epic 5 troca a fonte para `title`/`detail` sem mudar as telas.

### Story 4.6: `@tecton/ui`: tema padrão, porta `UiThemeProvider` e catálogo de i18n

Como **dev que vai construir telas sobre o Tecton**,
quero um runtime de UI com tema padrão substituível por tokens, slots de componente trocáveis e catálogo de i18n único,
para personalizar a identidade visual sem escrever componente e sem colisão de mensagens entre domínios (AD-10).

**Critérios de Aceite:**

**Dado** o `@tecton/ui`
**Quando** eu inspeciono o tema padrão (Camada 0)
**Então** paleta, tipografia, `rounded` e espaçamento do `DESIGN.md` existem como CSS custom properties com nomes públicos e estáveis (UX-DR1)
**E** os templates e widgets do `@rjsf/core` usam esses tokens, de modo que trocar a identidade visual exige só sobrescrever tokens

**Dado** a porta `UiThemeProvider`
**Quando** eu substituo um dos slots `ObjectTreeView`, `AttributeForm` ou `ScreenLayout`
**Então** só aquele slot muda e os outros continuam no padrão (UX-DR2)
**E** o `Core` resolve os três slots e os entrega já montados ao `ScreenLayout`; um `ScreenLayout` customizado só posiciona o que recebe e nunca resolve outro slot por conta própria

**Dado** uma aplicação que tenta criar um segundo `Core` do `@tecton/ui`
**Quando** isso acontece
**Então** é lançado um erro, porque o runtime é instância única (AD-10)

**Dado** o catálogo de i18n
**Quando** a aplicação inicia
**Então** PT-BR é o idioma padrão e EN o secundário, escolhido pelo idioma do navegador (AD-6)
**E** toda chave segue o formato `<domínio>.<chave>`; uma chave sem namespace ou uma chave repetida entre catálogos gera erro na consolidação (AD-10)

**Dado** os componentes padrão
**Quando** eu verifico o texto exibido ao usuário
**Então** todo texto vem do catálogo, nunca de string literal no componente (UX-DR12)

**Dado** o pacote `@tecton/ui`
**Quando** eu verifico as dependências
**Então** ele não importa `@tecton/directory` (AD-3, AD-10)

**Dado** os itens deixados em aberto pela spine (ferramenta de build da SPA e versão exata do React com o `@rjsf/core` 6.1.2)
**Quando** a story é concluída
**Então** a escolha e o motivo ficam registrados no README do pacote

### Story 4.7: Shell da SPA `/admin` e tela de login

Como **Marina, administradora de um Tenant**,
quero entrar no `/admin` com meu login e ver o console de dois painéis,
para começar a administrar a estrutura do meu Tenant.

**Critérios de Aceite:**

**Dado** o `@tecton/directory`
**Quando** ele sobe
**Então** serve os arquivos estáticos da SPA em `/admin`, e o Gateway encaminha `/admin` para ele (AD-10)
**E** toda chamada de API da SPA vai para o Gateway, nunca direto ao endereço interno do Directory

**Dado** a tela de login
**Quando** eu informo identificador e senha válidos
**Então** a SPA chama `/auth/login` pelo Gateway e me leva ao console
**E** o access token fica só em memória, nunca em `localStorage` nem `sessionStorage`

**Dado** credenciais inválidas
**Quando** eu tento entrar
**Então** vejo uma mensagem única do catálogo, sem dizer se o erro foi no login ou na senha
**E** com o login bloqueado (Story 2.6), vejo quanto tempo falta para tentar de novo

**Dado** um access token perto de expirar, ou uma resposta 401
**Quando** isso acontece durante o uso
**Então** a SPA chama `/auth/refresh` uma vez e repete a requisição
**E** se o refresh falhar, volto para o login com a mensagem de sessão expirada

**Dado** o console aberto
**Quando** eu o vejo pela primeira vez
**Então** o layout tem a árvore à esquerda e o painel de detalhe à direita, com o texto "Selecione um objeto na árvore à esquerda." (UX-DR3)
**E** só aparecem objetos do meu Tenant

**Dado** a ação de sair
**Quando** eu a uso
**Então** a SPA chama `/auth/logout`, descarta o token da memória e volta para o login

> **Nota:** subir a SPA junto com o ambiente local pelo `tecton-admin dev` é do Epic 6.

### Story 4.8: Árvore de objetos navegável e acessível

Como **Marina**,
quero navegar a árvore do meu Tenant com mouse ou só com o teclado,
para ver a estrutura de equipes e chegar ao objeto que preciso (UX-DR4).

**Critérios de Aceite:**

**Dado** a árvore carregada
**Quando** eu expando um nó pelo chevron ou com duplo clique
**Então** os filhos são carregados sob demanda e exibidos com indentação
**E** um clique simples seleciona o nó e carrega o painel de detalhe

**Dado** os nós exibidos
**Quando** eu os vejo
**Então** cada `objectClass` (Tenant, Grupo, Usuário) tem um ícone visualmente distinto

**Dado** o foco na árvore
**Quando** eu uso `↑`/`↓`, `→`/`←` e `Enter`
**Então** o foco se move entre os nós visíveis, os nós expandem e colapsam, e `Enter` seleciona (UX-DR4)
**E** a ordem de `Tab` é busca, árvore, painel de detalhe e ações

**Dado** um leitor de tela
**Quando** ele lê um nó
**Então** o nó tem papel `treeitem` dentro de um `tree`, com `aria-expanded`, `aria-level`, `aria-selected`, `aria-posinset` e `aria-setsize` corretos, de modo que o leitor anuncia a posição ("item 3 de 12") (UX-DR4)

**Dado** objetos sem permissão de leitura
**Quando** a árvore é exibida
**Então** eles não aparecem de forma alguma, nem como nó cinza ou bloqueado (UX-DR6)

**Dado** qualquer nó
**Quando** eu passo o mouse ou o seleciono
**Então** não há nenhum sinal de arrastar: nem cursor de arraste, nem área de soltar, nem atributo `draggable`

**Dado** qualquer elemento interativo da árvore
**Quando** ele recebe foco
**Então** exibe o anel de foco na cor `primary` (UX-DR11)

### Story 4.9: Busca na árvore

Como **Marina, com uma árvore de centenas de usuários importados**,
quero achar um objeto pelo nome sem abrir grupo por grupo,
para ver onde ele está na hierarquia sem esforço manual (UX-DR5).

**Critérios de Aceite:**

**Dado** o campo de busca no topo do painel da árvore
**Quando** eu digito
**Então** a busca é feita no servidor depois de cerca de 250 ms sem digitar, incluindo objetos que ainda não foram carregados na árvore

**Dado** resultados encontrados
**Quando** a busca termina
**Então** a árvore passa a mostrar só os objetos encontrados e os ancestrais deles, já expandidos
**E** o primeiro resultado recebe rolagem, destaque e foco
**E** o número de resultados é anunciado por uma região `aria-live`

**Dado** nenhum resultado
**Quando** a busca termina
**Então** aparece "Nenhum objeto encontrado para '{termo}'." (UX-DR5)

**Dado** a busca limpa
**Quando** o campo fica vazio
**Então** a árvore volta ao estado de antes da busca

**Dado** objetos sem permissão de leitura que combinam com o termo
**Quando** a busca roda
**Então** eles nunca aparecem nos resultados nem na contagem (UX-DR6)

### Story 4.10: Menu de contexto e painel de detalhe

Como **Marina**,
quero ver os atributos de um objeto e ter as ações dele a um clique direito,
para consultar e partir para a edição sem procurar botões (UX-DR7, UX-DR8).

**Critérios de Aceite:**

**Dado** um nó da árvore
**Quando** eu clico com o botão direito ou uso a tecla de menu de contexto (ou `Shift+F10`)
**Então** abre um menu só com "Ver detalhes" e "Editar atributos" (UX-DR7)
**E** sem permissão de escrita no objeto, "Editar atributos" não aparece, nem esmaecido
**E** nenhum item sugere mover ou arrastar

**Dado** o menu aberto
**Quando** ele aparece
**Então** o foco vai para o primeiro item, as setas navegam entre os itens e `Esc` fecha o menu e devolve o foco ao nó de origem (UX-DR11)

**Dado** um objeto selecionado
**Quando** o painel de detalhe carrega
**Então** mostra os atributos em pares rótulo e valor, somente leitura, com rótulos vindos do catálogo de i18n (UX-DR8)

**Dado** permissão de escrita no objeto, informada pelo backend de acordo com o ACL (Story 4.4)
**Quando** o painel é exibido
**Então** o botão "Editar atributos" aparece
**E** sem essa permissão, o botão não aparece, nem desabilitado com explicação (UX-DR10)

### Story 4.11: Formulário de edição de atributos gerado

Como **Marina**,
quero editar os atributos de um objeto num formulário que reflete o `objectClass`,
para corrigir dados sem que alguém precise escrever tela para cada atributo (FR-8, UX-DR9).

**Critérios de Aceite:**

**Dado** "Editar atributos"
**Quando** eu clico
**Então** o painel vira um formulário gerado pelo `@rjsf/core` a partir do JSON Schema do `objectClass` (Story 1.5), sem nenhum campo escrito à mão (FR-8)

**Dado** um atributo novo adicionado ao `objectClass` no manifest
**Quando** o Directory é atualizado
**Então** o campo aparece no formulário sem mudança de código de UI (FR-8)

**Dado** os rótulos e as mensagens de validação
**Quando** o formulário é exibido em PT-BR ou EN
**Então** todos vêm do catálogo de i18n (FR-8)

**Dado** um valor inválido
**Quando** eu tento salvar
**Então** o erro aparece abaixo do campo, o foco vai para o primeiro campo com erro e o erro é anunciado por `aria-live` (UX-DR9)
**E** cada campo tem `label` associado

**Dado** um salvamento bem-sucedido
**Quando** a resposta chega
**Então** o painel volta ao modo de visualização com o novo valor, sem recarregar a página, e aparece "Salvo."

**Dado** uma falha de servidor ou de rede ao salvar
**Quando** ela acontece
**Então** a mensagem aparece acima do formulário e tudo o que eu digitei é mantido (UX-DR10)

**Dado** "Cancelar" ou `Esc`
**Quando** eu uso
**Então** a edição é descartada sem pedido de confirmação e o painel volta ao modo de visualização

### Story 4.12: Estados da interface e acessibilidade da superfície

Como **Marina**,
quero que o console sempre explique o que está acontecendo, carregando, vazio ou com erro, e funcione por inteiro só com teclado,
para nunca ficar diante de uma tela em branco ou de um caminho sem saída (UX-DR10, UX-DR11, UX-DR12).

**Critérios de Aceite:**

**Dado** a primeira carga da árvore
**Quando** os dados ainda não chegaram
**Então** aparece um esqueleto de linhas no formato de árvore, não um spinner genérico
**E** ao trocar de objeto, o painel de detalhe mostra um esqueleto de 3 ou 4 linhas no formato rótulo e valor

**Dado** um Tenant sem objetos além da raiz
**Quando** a árvore carrega
**Então** aparece "Nenhum objeto neste Tenant ainda.", sem ação

**Dado** uma falha ao carregar a árvore ou o detalhe
**Quando** ela acontece
**Então** aparece a mensagem de erro traduzida e o botão "Tentar novamente", que refaz a carga
**E** nunca fica tela em branco sem explicação

**Dado** todas as telas e estados do console
**Quando** a verificação automatizada de acessibilidade roda
**Então** não há nenhuma violação de WCAG 2.2 AA (UX-DR11)

**Dado** os fluxos 1 e 2 do `EXPERIENCE.md` (editar o grupo de um colaborador e buscar numa árvore grande)
**Quando** eu os percorro só com teclado
**Então** consigo concluir os dois sem mouse

**Dado** toda mensagem exibida ao usuário
**Quando** eu a reviso
**Então** não tem emoji nem exclamação e nunca mostra erro técnico cru, como status HTTP ou stack trace (UX-DR12)
