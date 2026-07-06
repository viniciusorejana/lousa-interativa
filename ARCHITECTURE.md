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
- [ ] Fase 2 — client shared (fabric-image-patch, socket-client, event-bus)
- [ ] Fase 3 — client core + tools
- [ ] Fase 4 — client features
- [ ] Fase 5 — client UI + entrypoints
- [ ] Fase 6 — CSS
- [ ] Fase 7 — limpeza final
