# Arquitetura (em construção — refatoração incremental)

Este documento é atualizado a cada fase da refatoração. Ver `REFATORACAO.md` (fora do
repo, entregue à parte) para o racional completo de cada decisão.

> **Importante**: este projeto continua **zero-build**. `npm start` / `npm run dev`
> continuam funcionando exatamente como antes — os módulos abaixo são JavaScript puro
> (ES Modules nativos do navegador, `<script type="module">`), sem Webpack/Vite/Babel/TS.
> O Node no server também continua sendo executado direto via `node --env-file=...`,
> sem etapa de build.

## Estrutura de pastas (client)

```
public/
├── index.html / board.html / view.html   → apenas marcação
├── css/            → estilos extraídos (tokens compartilhados + por página)
└── js/
    ├── shared/     → código usado por mais de uma página (patch do Fabric, socket-client)
    ├── core/       → canvas, event-bus, serialização
    ├── features/   → uma pasta por funcionalidade (camadas, grupos, export, mídia,
    │                 clipboard, ferramentas de desenho, área reservada, usuários
    │                 remotos, onboarding)
    ├── ui/         → toolbar/painéis flutuantes, ações de seleção, controles de sala
    ├── board-app.js  → entrypoint do board.html (hub: dispatcher de mouse/touch,
    │                   sockets, ponte window.*)
    ├── view-app.js   → entrypoint do view.html (cliente somente-leitura, independente)
    └── index-app.js  → entrypoint do index.html (login + tutorial)
```

> **Nota (Fase 7)**: o plano original desta seção previa pastas `tools/` (Strategy
> pattern por ferramenta) e `net/` (handlers de socket do client). Na prática, a
> lógica de ferramentas ficou coesa o suficiente dentro de
> `features/drawing-tools/drawing-tools.js` (ver nota da Fase 4) e os handlers de
> socket.io do client nunca precisaram de uma pasta própria — cada feature registra
> os seus (`initStagingSocketListeners()`, `initRemoteUsersSocketListeners()`, etc.)
> e os eventos "hub" (dispatcher de mouse/touch, sockets de board-app.js) ficam no
> próprio entrypoint. As duas pastas vazias foram removidas nesta fase para o
> diagrama não prometer uma estrutura que não existe.

## Estrutura de pastas (server)

```
server/
├── index.js       → só bootstrap (cria app/http/io, monta rotas e sockets)
├── config.js      → constantes de configuração (porta, senha, limites, paths)
├── routes/        → um arquivo por grupo de rotas HTTP
├── sockets/        → um arquivo por grupo de eventos socket.io
├── services/       → regras de negócio (salas, upload) — Repository pattern
└── utils/          → helpers puros (slugify, arquivos)
```

## ⚠️ Bug real encontrado (fase 4g) — corrigido

Ao testar `lousa-interativa-fase4g.zip`, apareceu em produção:
```
Uncaught ReferenceError: Cannot access 'myRoomId' before initialization
    at staging-area.js:107:41
```

**Causa**: violei minha própria regra do padrão de import circular ("só usar o
binding importado dentro de corpo de função, nunca no nível superior do
módulo") em dois pontos de `staging-area.js` sem perceber:
1. `const _stagingPosKey = \`lb_stagingPos_${myRoomId}\`;` — lia `myRoomId`
   (de `board-app.js`) direto no nível superior do módulo.
2. `socket.on('staging:sync', ...)` / `socket.on('staging:remove', ...)` —
   registrados direto no nível superior, lendo `socket` (também de
   `board-app.js`) antes da hora.

Como `board-app.js` importa `staging-area.js`, e `staging-area.js` importa de
volta `myRoomId`/`socket` de `board-app.js`, na hora em que o loader de
módulos avalia `staging-area.js` (no meio da resolução dos imports de
`board-app.js`, **antes** do corpo do próprio `board-app.js` rodar), essas
duas variáveis ainda estão em TDZ (declaradas, mas não inicializadas).

**Correção**: `_stagingPosKey` virou uma função (calcula a chave só quando
chamada, nunca no nível superior) e `_stagingPos` passou a ser carregado do
`localStorage` de forma preguiçosa, no primeiro uso real. Os dois
`socket.on(...)` foram movidos pra dentro de uma função
`initStagingSocketListeners()`, exportada e chamada por `board-app.js`
**depois** que sua própria `const socket = ...` já rodou.

**Rede de segurança nova**: criei `test-harness/` (mocks mínimos de
`fabric`/`socket.io`/DOM/`localStorage` + `test-harness/import-test.mjs`), que
**importa de verdade** o grafo inteiro de módulos em Node — e Node implementa
a mesma semântica de import circular/TDZ que o navegador. Isso reproduz
exatamente esse tipo de bug sem precisar de navegador. Confirmei que ele pega
esse bug específico (reintroduzi de propósito, o teste falhou com a mensagem
exata que você viu; corrigido, passa). Rodo isso a partir de agora em toda
extração futura, além das validações que já fazia. Para rodar manualmente:
```bash
node test-harness/import-test.mjs
```
Também reauditei **todos** os módulos já extraídos (grep sistemático por uso
de binding circular fora de corpo de função) — só `staging-area.js` tinha o
problema; os outros 7 módulos já extraídos passam no teste de importação.

## ⚠️ Mais 2 bugs encontrados (mesma rodada) — corrigidos, e o teste ficou mais forte

Depois da correção acima, você reportou um SEGUNDO erro:
```
Uncaught (in promise) ReferenceError: _stagingAreaEntries is not defined
    at board-app.js:458
```

Esse era de uma classe **diferente** do primeiro: não é TDZ de import circular,
é simplesmente eu ter esquecido de exportar/importar uma variável durante a
extração — `_stagingAreaEntries` era privada de `staging-area.js`, e
`board-app.js` tentava reatribuí-la direto (o que também não seria válido pra
um binding importado; virou um setter exportado `setStagingAreaEntries()`).

Isso me fez desconfiar de mais casos assim, então rodei uma auditoria
sistemática (script comparando identificadores privados de cada módulo contra
o que `board-app.js` referencia) e achei **mais 4**: `cancelStagingPlacement`,
`emitStagingSync`, `getStagingOrigin`, `imageSpawnMode` — todos usados em
`board-app.js` (atalho de teclado Esc, e a lógica de colar com "spawn: área
reservada" ativo) sem terem sido exportados. Corrigidos.

**Por que meu harness anterior não pegou isso**: `import-test.mjs` só testava
se o grafo de módulos **importava** sem erro (avaliação de nível superior).
Esses bugs só se manifestam quando um **handler de evento roda de verdade**
(ex: o servidor manda `board:init`) — código que só executa em resposta a
algo, não na importação. Reforcei o teste: agora, depois de importar o grafo,
ele **dispara os 17 eventos de socket** que o client escuta (com payloads
realistas) e falha especificamente em `ReferenceError` (a assinatura exata de
"esqueci de exportar/importar"). Rodando esse teste reforçado eu achei mais um:
`vpRect is not defined` dentro do handler de `staging:sync` — também
corrigido (esquecimento simples de import).

Depois dessas 3 correções + o teste reforçado, rodei tudo de novo do zero e
está limpo (só resta um aviso cosmético de `TypeError` num mock incompleto do
harness, sem relação com bug real). Fiz também as duas auditorias sistemáticas
(módulo→board-app.js e board-app.js→módulos) nos 8 módulos já extraídos —
nenhum outro caso encontrado.

**Lição pra mim**: extrações que tocam em handlers de evento (socket, teclado)
precisam do teste disparando o evento de verdade, não só verificando que o
arquivo importa. Vou rodar `node test-harness/import-test.mjs` (versão
reforçada) em toda extração daqui pra frente, e vou revisar com mais cuidado
cada `export`/`import` antes de considerar uma extração pronta.

---

## Status por fase

- [x] **Fase 0** — estrutura de pastas criada, nenhuma lógica movida ainda. App continua
      funcionando exatamente como no branch `v3` original (nada foi alterado em
      `board.html`, `view.html`, `index.html` ou `server/index.js`).
- [x] **Fase 1** — server dividido em `config.js`, `routes/*`, `sockets/*`,
      `services/*` e `utils/*`. `server/index.js` caiu de 875 para 70 linhas
      (só bootstrap: cria app/http/io, monta middlewares, rotas e sockets, sobe
      a manutenção em background). Nenhuma rota HTTP nem evento de socket.io
      mudou de nome, payload ou comportamento — é uma extração mecânica, não
      uma reescrita de lógica. Client (`public/*.html`) ainda não foi tocado.
- [x] **Fase 2** — extraído `public/js/shared/fabric-image-patch.js` (o monkey-patch
      de `fabric.Image.fromURL`, que era 100% duplicado, byte a byte, entre `board.html`
      e `view.html`) e `public/js/shared/socket-client.js` (`LB.createSocket(query)`,
      centralizando o único ponto de configuração de transporte do socket.io). Os dois
      arquivos HTML agora carregam os mesmos dois arquivos — zero duplicação nesse
      trecho. `board.html`: 4.380 → 4.288 linhas. `view.html`: 579 → 501 linhas.
      > **Nota de arquitetura**: esses dois arquivos são **scripts clássicos**
      > (`<script src="...">`), não ES Modules (`type="module"`) — de propósito. O
      > restante do código de `board.html`/`view.html` ainda é um único script clássico
      > gigante (será modularizado nas Fases 3-5). Módulos ES são carregados de forma
      > adiada (depois do parsing do HTML), enquanto scripts clássicos executam
      > imediatamente, na ordem em que aparecem — misturar os dois agora inverteria a
      > ordem de execução e quebraria o patch (ele precisa rodar *antes* de qualquer
      > `fabric.Image` ser usado). Quando o resto do client virar ES Modules (Fase 3+),
      > esses dois arquivos viram módulos reais junto com o resto, com a ordem de
      > `import` resolvendo isso corretamente.
- [x] **Fase 3 (parte 1 — infraestrutura de módulos)** — `board.html` virou um módulo ES
      de verdade: `public/js/board-app.js` (`<script type="module">`), importando
      `public/js/core/canvas-manager.js` (cria e exporta o `fabric.Canvas`) e
      `public/js/core/event-bus.js` (pub/sub, Observer pattern — ainda sem
      consumidores, prontos pra Fase 4/5 desacoplar toolbar ⇄ canvas ⇄ socket).
      `board.html`: 4.288 → **668 linhas** (só marcação/CSS agora).
      > **Importante sobre o tamanho de `board-app.js` (3.661 linhas)**: esta fatia da
      > Fase 3 troca a ARQUITETURA (script clássico global → módulo ES real), não ainda
      > o tamanho por arquivo — o corpo da lógica (ferramentas, camadas, grupos, mídia,
      > clipboard...) foi movido quase inteiro pra dentro de `board-app.js` por enquanto.
      > A redução de linhas desse arquivo específico é o objetivo da Fase 4/5: puxar
      > cada pedaço coeso pra seu próprio arquivo em `tools/` e `features/`, um de cada
      > vez, testável isoladamente — a mesma abordagem incremental das Fases 1 e 2.
      > **Ponte HTML ⇄ módulo**: `board.html` usa ~50 atributos inline
      > (`onclick`/`onchange`/`oninput`) chamando ~35 funções distintas. Módulos ES não
      > vazam declarações de nível superior pro escopo global (diferente de scripts
      > clássicos) — então essas ~35 funções são expostas explicitamente em `window` no
      > final de `board-app.js`, com comentário explicando o porquê. Documentado também
      > no topo do arquivo.
      > **Verificação nesta fase**: validei sintaxe ESM real (`node --input-type=module
      > --check`, já que `node -c`/`node --check` comuns *não* detectam erro de sintaxe
      > em arquivos com `import`/`export` sem `"type":"module"` no `package.json` — uma
      > armadilha que só descobri testando de propósito), conferi que as 35 funções da
      > ponte existem de fato no arquivo, chequei ausência de identificador duplicado no
      > nível superior (risco real ao fundir os dois `<script>` que existiam antes em um
      > só módulo), servidor no ar servindo os arquivos corretamente (conteúdo
      > byte-idêntico), e rodei de novo o teste de fluxo via socket.io (regressão do
      > server, que não foi tocado). **Não consegui** testar a execução real no
      > navegador (tentei montar jsdom + node-canvas pra simular, mas o pacote `canvas`
      > precisa baixar headers de `nodejs.org`, que não está liberado na rede deste
      > ambiente) — essa é, de longe, a fase de maior risco até agora (é onde ~35
      > funções de UI passaram por uma ponte manual), então o roteiro completo do
      > `CHECKLIST.md` precisa ser rodado com atenção redobrada.
- [ ] Fase 3 (parte 2) / Fase 4 — extrair tools/ e features/ de dentro de board-app.js
  - [x] `features/media/gif-service.js` (227 linhas) — subsistema completo de GIFs
        animados (decodificação em WebWorker, loop de animação, registro de GIFs
        ativos). `board-app.js`: 3.661 → 3.450 linhas.
        > **Padrão de import "circular" adotado a partir daqui**: `gif-service.js`
        > importa `genId`, `activeLayerId`, `placeNewImage`, `addToCanvas`,
        > `emitFull`, `hideToast`, `absoluteImgUrl`, `uploadFile` de volta de
        > `board-app.js` (que por sua vez importa `gif-service.js`). Isso é seguro
        > em ES Modules **desde que nenhum dos dois lados use o binding importado
        > no nível superior do módulo** — só dentro de corpo de função, chamado em
        > resposta a um evento (clique, socket, timer), bem depois de todos os
        > módulos já terem terminado de avaliar. Confirmei isso manualmente nesta
        > extração antes de fechar. Extrair um "core/board-state.js" próprio pra
        > eliminar esses ciclos por completo exigiria consolidar ~15-20 helpers
        > genéricos de uma vez só — um investimento grande por si só; o ciclo
        > controlado é a opção mais segura e incremental por enquanto.
  - [x] `features/export/png-exporter.js` (147 linhas) — as 3 estratégias de export
        (objeto único, seleção, board inteiro) e o helper compartilhado de
        renderização usado também pelo "copiar como imagem" do clipboard.
        `board-app.js`: 3.450 → 3.313 linhas.
  - [x] `features/groups/group-service.js` (106 linhas) — agrupar/desagrupar
        (incluindo a matemática de decomposição de matriz de transformação pra
        preservar posição/rotação/escala de cada filho ao desagrupar) e o toggle
        de habilitação dos botões de grupo na toolbar. `board-app.js`: 3.313 →
        3.219 linhas.
  - [x] `features/layers/layers-panel.js` (613 linhas) — a maior extração até agora:
        estado de camadas (`boardLayers`, `activeLayerId`), gerenciar camadas
        (criar/mover/excluir/visibilidade), renderização completa do painel
        (drag-and-drop de objetos entre camadas, colapsar/expandir, rename inline),
        e as ações de objeto vindas do painel (mostrar/ocultar, excluir,
        excluir/ocultar grupo de traços). `board-app.js`: 3.219 → **2.642 linhas**.
        > Nesta extração também converti `boardLayers` de `let` reatribuível pra
        > `export const` mutado sempre in-place (`.length=0; .push(...)` em vez de
        > `boardLayers = novoArray`) — necessário porque um binding importado de
        > outro módulo não pode ser reatribuído, só mutado. Achei e corrigi os 6
        > pontos do arquivo que faziam essa reatribuição direta antes de mover a
        > seção. Também precisei **reexportar** de `board-app.js` os itens que os
        > módulos já extraídos (`gif-service`, `png-exporter`, `group-service`)
        > importavam de lá e que agora moraram em `layers-panel.js`
        > (`activeLayerId`, `objectNames`, `typeCounters`, `assignDefaultName`,
        > `scheduleLayersUpdate`) — sem isso, aqueles três arquivos quebrariam.
  - [x] `features/onboarding/tooltip.js` (45 linhas) e `features/onboarding/tutorial.js`
        (116 linhas) — ambos módulos autocontidos, zero dependência de
        canvas/socket/estado (só DOM), então **sem import circular** — os primeiros
        dois módulos desta refatoração que não precisaram desse padrão.
        `board-app.js`: 2.642 → 2.495 linhas.
  - [x] `core/serialization.js` (120 linhas) — converte objetos Fabric em dados
        serializáveis (`ser`, `serTransform`, `serTransformAbsolute`) usados por
        socket, histórico de undo/redo, grupos e camadas. `board-app.js`: 2.495 →
        2.386 linhas.
        > Diferente das extrações anteriores, este módulo **não precisou** do
        > padrão de import circular — só depende de `canvas`. Aproveitei pra
        > **reduzir** a circularidade dos módulos já extraídos: `gif-service.js` e
        > `group-service.js`/`layers-panel.js` agora importam `absoluteImgUrl`/`ser`
        > direto daqui, em vez de circularmente de volta de `board-app.js`.
  - [x] `features/spawn-area/staging-area.js` (359 linhas) — onde novas
        imagens/gifs/objetos colados "nascem" (centralizado ou em área
        reservada), posição por cliente, e áreas dos outros usuários mostradas
        no board. `board-app.js`: 2.386 → 2.052 linhas.
        > Esta extração ficou espalhada em duas partes não-contíguas do arquivo
        > original (uma delas — criar/desenhar o retângulo tracejado — vivia
        > perto do dispatcher central de mouse). O dispatcher (`canvas.on('mouse:
        > move'/'down')`) continua em `board-app.js` de propósito: ele decide entre
        > pan/desenho/seleção/reposicionar-área a cada evento, então é um hub
        > compartilhado por várias features, não algo que pertence só à área
        > reservada. Ele importa de volta `stagingRect`/`_stagingPlacementMode`/
        > `confirmStagingPlacement` (circular). Também simplifiquei: `gif-service.js`
        > agora importa `placeNewImage` direto daqui, sem passar por `board-app.js`.
  - [x] `features/remote-users/remote-users.js` (114 linhas) — renderização de
        cursores, traço livre (pen) e formas (retângulo/elipse/linha/seta) de
        outros usuários conectados na sala, recebidos via socket (`draw:*`,
        `shape:*`, `cursor:move`/`cursor:remove`). `board-app.js`: 2.055 →
        **1.954 linhas**.
        > Extração isolada e "burra": só renderiza o que chega do servidor,
        > nenhum estado é compartilhado com outro módulo já extraído. Precisou
        > do padrão de import circular de sempre — importa `socket`, `vpRect`,
        > `myId`, `applyFull`, `mkShape`, `pts2path` de volta de `board-app.js`,
        > usados só dentro dos corpos das callbacks de `socket.on(...)` (nunca
        > no nível superior do módulo). Segue o mesmo padrão de
        > `initStagingSocketListeners()`: exporta `initRemoteUsersSocketListeners()`,
        > chamada em `board-app.js` só depois de `socket` já existir. `myId`
        > virou `export let` (só leitura por quem importa, continua reatribuído
        > normalmente dentro do próprio `board-app.js`); `applyFull`/`mkShape`/
        > `pts2path` ganharam `export` (já existiam, usados por várias outras
        > partes de `board-app.js` — não migraram, só passaram a ser
        > reexportados).
        > Reforcei o `test-harness/`: os eventos `draw:start/move/end` e
        > `shape:start/move/end/cancel` nunca tinham sido cobertos pelo teste
        > automático (só `cursor:move`/`cursor:remove` estavam lá) — adicionei
        > os 7 que faltavam em `import-test.mjs` (17 → 25 eventos cobertos) e
        > completei o mock `fabric` com `Path` (assinatura própria, diferente
        > dos outros construtores fabric.*) e `FakeElement.remove()` em
        > `mocks.mjs`, que faltavam e geravam avisos de falso-positivo.
  - [x] `features/clipboard/clipboard.js` (310 linhas) — paste do clipboard do
        sistema (objetos do board via marcador oculto, arquivo de imagem, URL
        de imagem/texto), drag-and-drop (arquivo do SO ou imagem de outra aba),
        e copiar/colar interno (`copySel`/`pasteBoardObjects`, grava PNG +
        dados originais no clipboard do sistema). `board-app.js`: 1.954 →
        **1.666 linhas**.
        > Maior redução de linhas desde `layers-panel.js`. Precisou do padrão
        > de import circular de sempre — importa `socket`, `vpRect`, `deser`,
        > `genId`, `emitFull`, `addToCanvas`, `showToast`, `hideToast`,
        > `uploadFile` de volta de `board-app.js` (ganharam `export`; já
        > existiam, usados por outras partes do arquivo — não migraram). Os
        > demais imports (`ser`, `renderObjectsAsDataURL`, `isGifUrl`/
        > `placeGif`/`placeImageFromUrl`, `activeLayerId`/`assignDefaultName`/
        > `scheduleLayersUpdate`, `imageSpawnMode`/`placeStagingGroup`/
        > `stagingRect`) vieram direto dos módulos donos (serialization,
        > png-exporter, gif-service, layers-panel, staging-area), sem passar
        > por `board-app.js` — reduz a circularidade em vez de empilhar mais
        > uma camada nela.
        > Diferente de `remote-users.js` (que precisou de um `init...()` chamado
        > depois de `socket` existir), aqui os listeners de `window`/`canvas`
        > (`paste`, `dragover`, `drop`) são registrados direto no nível
        > superior do módulo — seguro porque `canvas` não é circular (vem de
        > `core/canvas-manager.js`, já totalmente avaliado antes) e nenhum
        > binding circular (`socket`, `vpRect`, etc.) é lido fora do corpo das
        > próprias callbacks, só chamadas muito depois, quando o usuário cola/
        > arrasta algo.
        > `copySel` é exportado e importado de volta em `board-app.js` só para
        > o atalho Ctrl+C do teclado — não é chamado por `onclick` inline.
  - [x] `features/drawing-tools/drawing-tools.js` (178 linhas) — estado da
        ferramenta ativa (`tool`/`color`/`sz`/`op`/`fillShape`) e a lógica de
        pointer down/move/up que decide o que cada ferramenta faz a cada
        evento: `getCanvasPoint`, `handlePointerDown`, `updateTmpShape`,
        `handlePointerUp`, `setTool`, `setColor`, `setSz`, `setOp`,
        `setFillShape`. `board-app.js`: 1.666 → **1.522 linhas**.
        > Esta era a peça mais arriscada que faltava (ver nota da fase 3): o
        > registro bruto dos listeners de mouse/touch (`wheel`, `mousedown`
        > de pan, `touchstart/move/end`, `canvas.on('mouse:move'/'down'/
        > 'up')`) **continua** em `board-app.js` de propósito — é um hub
        > compartilhado por pan e pela área reservada (staging) além deste
        > módulo, então não pertence só a "ferramentas de desenho". O que
        > migrou foi a "Strategy" de cada ferramenta: o que fazer no
        > pointer-down/move/up dado o `tool` ativo.
        > Import circular de sempre: `socket`, `vpRect`, `findById`, `genId`,
        > `mkShape`, `addToCanvas`, `emitFull`, `throttle60`, `addText`,
        > `isPanMode`, `spaceHeld`, `enterPanMode`, `exitPanMode`,
        > `layoutSidePanels`, `scheduleLayersUpdate` vêm de volta de
        > `board-app.js` (ganharam `export`; usados só dentro de corpo de
        > função). `ser` veio direto de `core/serialization.js`, sem passar
        > por `board-app.js`.
        > Caso especial: `penActive` precisou de um setter exportado
        > (`setPenActive`) em vez de só um `export let` — os handlers de
        > touch/mouse que ficaram em `board-app.js` (`touchstart`, `touchend`,
        > `canvas.on('mouse:up')`) reatribuíam `penActive` diretamente antes
        > da extração, e um binding importado não pode ser reatribuído por
        > quem importa, só mutado por quem o exporta. `tool`, `isDrawing`,
        > `drawStart`, `color`, `sz`, `op`, `fillShape` continuam só lidos
        > (nunca reatribuídos) fora do novo módulo, então bastou `export let`.
        > **Não é ainda** o Strategy pattern completo mencionado na Fase 3
        > (arquivos separados por ferramenta em `tools/`) — é a extração que
        > isola a lógica hoje toda num módulo só; separar select/pan/pen/
        > shape/text em arquivos próprios fica para uma fase futura, quando
        > fizer sentido revisitar.
  - [x] `ui/` (toolbar, room switch, etc.) — última peça da Fase 4, dividida em
        3 módulos de baixo risco (nenhum tem a lógica de canvas/desenho que
        tornou `drawing-tools.js` arriscado):
        - `ui/panel-layout.js` (215 linhas): posicionamento coordenado de todos
          os painéis flutuantes (spawn, propriedades do objeto `#ctx`,
          Camadas, Viewport, view/ajuda) e o preenchimento do painel `#ctx`
          (`updCtx`) conforme a seleção do canvas. **Zero import circular** —
          só depende de `canvas` (de `core/canvas-manager.js`) e do DOM, nunca
          de `socket` ou estado compartilhado.
        - `ui/selection-toolbar.js` (112 linhas): ações do painel `#ctx` sobre
          `canvas.getActiveObjects()` — mudar cor/preenchimento/espessura/
          opacidade, redimensionar, excluir, mandar pra trás/frente, duplicar
          (Ctrl+D).
        - `ui/room-controls.js` (40 linhas): trocar de lousa, limpar o quadro,
          abrir a view do OBS, e o bind dos botões do painel superior direito
          (ver ao vivo / ajuda).
        `board-app.js`: 1.522 → **1.207 linhas** (maior redução desde
        `layers-panel.js`).
        > Import circular de sempre (`selection-toolbar.js`/`room-controls.js`):
        > `socket`, `vpRect`, `scheduleLayersUpdate`, `emitModify`, `genId`,
        > `myRoomId`, `myRoomName` vêm de volta de `board-app.js` (as duas
        > últimas, e `emitModify`, ganharam `export` — já existiam, usadas só
        > aqui). `ser`/`serTransformAbsolute` vêm direto de
        > `core/serialization.js`, e `applyLayerZOrder` direto de
        > `features/layers/layers-panel.js` — sem passar por `board-app.js`,
        > reduzindo a circularidade em vez de empilhar mais uma camada nela.
        > `layoutSidePanels` continua sendo **reexportada** por `board-app.js`
        > (mesmo padrão de `activeLayerId`/`scheduleLayersUpdate`), porque
        > `drawing-tools.js` já a importava de lá — evita ter que tocar num
        > módulo já extraído e validado só por causa de onde a função mora
        > agora.
        > `sendBackFront` foi o único ponto onde troquei a forma de acessar
        > `vpRect`: em vez de reimplementar a busca, simplesmente importei o
        > `vpRect` (já exportado) de `board-app.js` como os outros módulos já
        > fazem.
- [ ] Fase 4 — client features
- [x] **Fase 5 — client UI + entrypoints**: os dois entrypoints que ainda eram
      scripts clássicos inteiros viraram módulos ES de verdade, mesma
      mecânica da Fase 3 (parte 1) com `board.html`.
      - `view.html` → `public/js/view-app.js` (`<script type="module">`).
        `view.html`: 501 → **20 linhas** (só marcação/CSS + as 4 tags
        `<script>` clássicas de sempre + a nova tag `type="module"`).
        **Zero atributo onclick/onchange/oninput** existia em `view.html` —
        diferente de `board-app.js`/`index-app.js`, este módulo não precisou
        de nenhuma ponte com `window`.
      - `index.html` → `public/js/index-app.js` (`<script type="module">`,
        fusão dos 2 `<script>` clássicos que existiam ali — o que injeta o
        botão de tutorial e o que tem toda a lógica dos 3 passos de login +
        tutorial da lousa de giz). `index.html`: 668 → **341 linhas** (CSS
        inline não foi tocado — fica para a Fase 6). Precisou da mesma ponte
        `window.*` de `board-app.js`, pelo mesmo motivo (atributos onclick
        inline): `checkPassword`, `chooseRoom`, `goStep`, `enterBoard`,
        `goBackToStep2`, `openTutorial`, `closeTutorial`, `tutNav`.
      > **Por que a duplicação entre `view-app.js` e `board-app.js` foi
      > mantida** (`deser`/`applyFull`/`loadState`/`findById`/`pts2path`/
      > `absoluteImgUrl`/o worker de GIF existem nos dois arquivos, quase
      > idênticos): a view é deliberadamente um cliente "somente leitura"
      > independente, sem nenhum objeto selecionável/editável, e já tinha
      > zero import circular / zero dependência de `core/canvas-
      > manager.js` (cria seu próprio `fabric.Canvas` do tamanho da janela,
      > diferente do board). Unificar os dois exigiria puxar `core/
      > serialization.js`+`deser`+GIF-decode pra um módulo compartilhado
      > entre board e view — um projeto por si só, fora do escopo mecânico
      > desta fase (só trocar script clássico → módulo ES, sem mudar nenhuma
      > lógica). Fica anotado como possível trabalho futuro, não urgente.
      > **Nenhuma lógica mudou** em nenhum dos dois arquivos — é uma extração
      > 100% mecânica (mesmo texto, só movido pra um arquivo `.js` externo
      > com `export`/`window` bridge onde necessário), sem nenhum import
      > circular novo (nenhum dos dois módulos importa de `board-app.js` nem
      > vice-versa — são três entrypoints irmãos, não uma árvore).
- [x] **Fase 6 — CSS**: os 4 blocos `<style>` inline que restavam (2 em
      `board.html`, 1 em `index.html`, 1 em `view.html`) viraram arquivos em
      `public/css/`, referenciados via `<link rel="stylesheet">` — mesma
      extração mecânica das fases anteriores, zero regra CSS reescrita ou
      reordenada.
      - `public/css/board.css` (349 linhas) — estilos principais do editor
        (toolbar, painéis, camadas, viewport etc). `board.html`: 668 → 319
        linhas (nesse passo).
      - `public/css/board-tutorial.css` (72 linhas) — o segundo `<style>` de
        `board.html`, específico do tutorial do editor (classes `btut-*`),
        que vivia aninhado dentro da própria marcação do overlay do
        tutorial (HTML válido, mas incomum) — mantive o `<link>` exatamente
        no mesmo ponto onde a `<style>` estava, pra não mudar a estrutura do
        documento nesta passada. `board.html` final: **246 linhas**.
      - `public/css/index.css` (210 linhas) — estilos da tela de login (os 3
        passos, o card, e o tutorial "lousa de giz" da tela de login —
        classes `tut-*`, diferente do `btut-*` do board). `index.html`: 668
        → **130 linhas**.
      - `public/css/view.css` (3 linhas) — reset mínimo da view (fundo
        transparente, canvas full-screen). `view.html`: 20 → **16 linhas**.
      > **Duplicação mantida de propósito**: `board-tutorial.css` (`btut-*`)
      > e `index.css`'s trecho de tutorial (`tut-*`) implementam o mesmo
      > visual "lousa de giz" com nomes de classe deliberadamente diferentes
      > (evita colisão caso algum dia as duas páginas compartilhem contexto).
      > Unificar isso num só arquivo de tema compartilhado é possível no
      > futuro, mas está fora do escopo mecânico desta fase (só mover CSS
      > existente pra fora do HTML, sem redesenhar nada).
      > Nenhuma regra de CSS foi alterada, removida, reordenada ou
      > combinada — cada arquivo novo tem exatamente o conteúdo que estava
      > entre as tags `<style>`/`</style>` correspondentes.
- [x] **Fase 7 — limpeza final**: nenhuma extração de código nesta fase, só
      auditoria e organização.
      - Removidas 3 pastas vazias que sobraram da Fase 0 e nunca foram usadas
        (`public/js/tools/`, `public/js/net/`, `public/js/features/viewport/`)
        — o plano original previa Strategy pattern por ferramenta e uma pasta
        própria pra handlers de socket do client, mas na prática essas
        responsabilidades ficaram coesas o suficiente dentro de
        `features/drawing-tools/` e de cada módulo de feature (ver nota da
        Fase 4). Diagrama de pastas no topo deste documento atualizado pra
        refletir a estrutura real.
      - Auditoria de exports órfãos: script comparando toda `export
        function/const/let` de `public/js/**` contra o resto do código —
        nenhuma exportação sem uso encontrada.
      - Auditoria de resíduos de debug: busca por `console.log`/`TODO`/
        `FIXME`/`XXX` em `public/js` e `server` — os únicos `console.log`
        encontrados são logs de operação do servidor (startup, conexão/
        desconexão de sala, eviction, varredura de uploads órfãos),
        intencionais; nenhum `TODO`/`FIXME` real (só falsos-positivos da
        palavra "TODOS" em comentários em português).
      - Busca por arquivos de backup/transição (`.bak`, `.orig`, `*copy*`) —
        nenhum encontrado.
      - `package.json`/`.gitignore` conferidos — nada a limpar.
      - Validação final completa: sintaxe ESM de todos os arquivos
        `public/js/**` e `server/**`, `test-harness/import-test.mjs` (25/25
        eventos), servidor real no ar (login via `/auth` com JSON, `/board.html`
        autenticado, `css/board.css` com `content-type` correto), log do
        servidor limpo, artefatos de teste removidos ao final.
      > Esta fase não teve risco de regressão de comportamento (nenhuma linha
      > de lógica foi tocada) — o roteiro completo (1-19) pedido no
      > `CHECKLIST.md` é a validação final de todo o processo de refatoração
      > da Fase 0 até aqui, não desta fase isoladamente.
