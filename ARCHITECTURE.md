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
    ├── shared/     → código usado por mais de uma página (patch do Fabric, socket, event-bus)
    ├── core/       → canvas, estado central do editor, undo/redo
    ├── tools/      → ferramentas do editor (select/pan/pen/shape/text) — Strategy pattern
    ├── features/   → uma pasta por funcionalidade (camadas, grupos, export, mídia, clipboard...)
    ├── ui/         → toolbar, modais, toast
    └── net/        → handlers de socket.io do lado do client
```

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
  - [ ] `features/spawn-area/` (área reservada)
  - [ ] `features/groups/` (agrupar/desagrupar)
  - [ ] `features/export/` (exportar PNG)
  - [ ] `features/spawn-area/` (área reservada)
  - [ ] `features/remote-users/` (cursores/traços remotos)
  - [ ] `features/clipboard/` (paste/drag-drop/copiar-colar)
  - [ ] `features/onboarding/` (tooltip, tutorial)
  - [ ] `ui/` (toolbar, room switch, etc.)
- [ ] Fase 4 — client features
- [ ] Fase 5 — client UI + entrypoints
- [ ] Fase 6 — CSS
- [ ] Fase 7 — limpeza final
