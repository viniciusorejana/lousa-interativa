# Testes automatizados

Este projeto tem 4 camadas de teste automatizado, complementadas pelo roteiro
manual de `CHECKLIST.md`. Nenhuma delas usa bundler/transpilação (consistente
com o projeto zero-build) — servidor roda com `node:test` nativo (Node ≥18),
cliente reaproveita os mocks de `test-harness/`, e a camada de navegador usa
Playwright (única devDependency que não é puramente `node:test`).

## Visão geral

| Camada | Onde | O que cobre | Runner |
|---|---|---|---|
| 1. Unitários de servidor | `test/server/unit/` | `slugify`, `files`, `room.service`, `upload.service`, `auth.service` — lógica pura, sem HTTP/socket | `node --test` |
| 2. Integração de servidor | `test/server/integration/` | Servidor real (http + Socket.IO) de ponta a ponta: auth, eventos de socket, undo/redo, persistência | `node --test` + `socket.io-client` |
| 3. Cliente (mocks) | `test-harness/` | Import do grafo de módulos + asserções de estado real via mocks de `fabric`/socket/DOM | `node --test` + script custom |
| 4. E2E de navegador | `test/e2e/` | Fluxo completo num Chromium real: login, desenho, camadas, grupos, upload, multi-usuário, rota `/view` | Playwright |

## Como rodar

```bash
npm test                       # camadas 1 + 3 (server unit+integration, client mocks+smoke)
npm run test:server            # só camada 1 + 2 (unit + integration de servidor)
npm run test:server:unit       # só camada 1
npm run test:server:integration # só camada 2
npm run test:client            # só camada 3 (mocks + smoke)
npm run test:client-smoke      # só o smoke test de import (test-harness/import-test.mjs)
npm run test:e2e               # camada 4 (Playwright) — sobe o server sozinho, não precisa "npm run dev" rodando
```

`test:e2e` não entra no `npm test` padrão por ser mais lento (sobe um Chromium
real) — rode manualmente após mudanças não-triviais de UI, ou antes de um
merge maior.

## Camada 1 — Unitários de servidor (`test/server/unit/`)

Testam módulos de `server/services/` e `server/utils/` isoladamente, sem
subir HTTP nem Socket.IO. `room.service.test.js` e `upload.service.test.js`
tocam disco de verdade (escrevem em `data/rooms/`/`uploads/` reais), mas
sempre com `roomId`/nomes de arquivo únicos (`crypto.randomUUID()`) e limpeza
via `t.after(...)` — nunca deixam lixo nem colidem com dados de dev.

## Camada 2 — Integração de servidor (`test/server/integration/`)

Sobe uma instância **real** de `server/index.js` (mesmo processo do teste,
via `require`) numa porta livre, e conecta com `socket.io-client` de verdade
— sem mockar nada do lado do servidor. Cobre o protocolo de sync ponta a
ponta: `object:add`/`modify`/`remove`, `objects:batch`, `layers:update`,
`layer:visibility`, `groups:update`, `staging:sync`/`remove`,
`history:undo`/`redo`, e persistência em disco após a sala sair da RAM.

### ⚠️ Isolamento de dados — leia antes de mexer aqui

`server/index.js` **apaga tudo** em `uploads/` e `data/rooms/` no boot
(`cleanOnStartup()`, por design — ver `CLAUDE.md`). Rodar o servidor de
verdade dentro de um teste, sem cuidado, apaga dados reais de
desenvolvimento. Isso **já aconteceu** numa sessão anterior (apagou uma sala
real, sem como recuperar — o diretório é gitignored).

Para evitar isso, `server/config.js` aceita um override opcional via env,
usado *só* pelos testes:

```js
LB_TEST_UPLOADS_DIR  // sobrescreve UPLOADS
LB_TEST_DATA_DIR      // sobrescreve DATA_DIR
```

`test/server/integration/_setup.js` seta essas envs (apontando pra um
diretório temporário criado com `fs.mkdtempSync`) **antes** de dar
`require('server/index.js')`, e depois confirma que `config.js` realmente
pegou o override — se não pegou, lança erro alto e cedo em vez de deixar o
`cleanOnStartup()` seguir silenciosamente.

**Regra de ouro para qualquer teste novo nesta pasta**: nunca dê `require`
em `server/services/room.service.js` (ou qualquer outro módulo que puxe
`server/config.js`) **no topo do arquivo**. Se o módulo for exigido antes de
`startTestServer()` rodar, `config.js` fica com os caminhos REAIS
cacheados pelo Node, e o override nunca mais surte efeito para aquele
processo. Sempre `require(...)` esses módulos **dentro** do corpo do teste,
depois de `await startTestServer()` — veja o comentário em
`sockets.test.js` no teste de persistência para o exemplo real desse bug.

### Por que `process.exit(0)` no `after(...)`?

`server/index.js` não exporta a instância http/io (é bootstrap-only por
design) e deixa timers de manutenção em background (eviction sweep,
varredura de uploads órfãos) rodando. Sem uma referência a eles pra dar
`clearInterval`, o processo nunca sairia sozinho. `--test-force-exit` do
Node colide com um bug conhecido do libuv no Windows ao fechar handles do
Socket.IO à força (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`),
então cada arquivo de integração chama `process.exit(0)` manualmente dentro
de um `after()` (com um pequeno delay) em vez de usar essa flag.

## Camada 3 — Cliente sob mocks (`test-harness/`)

- `test-harness/mocks.mjs` — mocks mínimos de `fabric`, `socket.io-client`,
  DOM e storage, o bastante pra `public/js/board-app.js` (e o grafo de
  módulos que ele importa) rodar em Node puro. Não é um mock funcional
  completo de navegador — é ajustado sob demanda conforme os testes reais
  exigem estado correto (ex: `canvas.remove()`/`getActiveObjects()` foram
  reforçados durante a escrita desta suíte, porque eram stubs vazios).
- `test-harness/import-test.mjs` — importa o grafo inteiro (pega bugs de TDZ
  em import circular) e dispara ~25 eventos de socket reais contra os
  handlers, com asserções de estado (não só "não lançou erro") nos pontos
  onde dá pra checar resultado determinístico (`object:add`/`modify`/
  `remove`, `objects:batch`, `layers:update`, `board:clear`).
- `test-harness/unit/*.test.mjs` — testes isolados de módulos de lógica do
  cliente: `serialization.js` (`ser`/`serTransform`/`absoluteImgUrl`),
  `group-service.js` (agrupar/desagrupar), `event-bus.js` (pub/sub puro).

**Lacuna conhecida**: `features/spawn-area/staging-area.js` não tem teste
unitário dedicado (só a cobertura indireta do smoke test via evento
`staging:sync`) — a lógica de cálculo de área de spawn ficou de fora por
custo/benefício de tempo. Se for mexer nela, vale considerar adicionar.

## Camada 4 — E2E de navegador (`test/e2e/`, Playwright)

`playwright.config.js` sobe `server/index.js` sozinho (via `webServer`),
numa porta fixa (4173) e com o mesmo mecanismo de isolamento de diretório
da Camada 2 (`LB_TEST_UPLOADS_DIR`/`LB_TEST_DATA_DIR` apontando pra um
`mkdtempSync`) — não precisa (e não deve rodar ao mesmo tempo que) o
`npm run dev` de desenvolvimento.

- `board.spec.js` — fluxo de uma aba só: login, as 4 formas de desenho,
  seleção via marquee, camadas (criar/renomear/ocultar), grupo/desagrupar,
  upload de imagem (via `setInputFiles` no input real do app, não
  drag-and-drop simulado), undo/redo, exportar PNG (`page.waitForEvent('download')`).
- `collaboration.spec.js` — multi-aba (duas `BrowserContext` na mesma sala,
  objeto criado numa aparece na outra), rota `/view/:sala` (sem auth, fundo
  transparente, sem toolbar), troca de sala sem reautenticar.

**Lacunas conhecidas**: paste real de imagem via clipboard do SO (Ctrl+V) e
drag-and-drop de arquivo não são simulados — usei o input de arquivo real
(`#img-inp`) como proxy, que exercita o mesmo `insertImg()`/upload no
servidor, mas não o evento de paste em si. Esses dois continuam só no
roteiro manual (`CHECKLIST.md`, item 9 e 11).

## Ordem recomendada ao investigar uma regressão

1. `npm run test:server:unit` — mais rápido, isola lógica de serviço.
2. `npm run test:client` — pega TDZ/export faltando e regressões de
   serialização/grupo no cliente.
3. `npm run test:server:integration` — se a suspeita envolve protocolo de
   socket ou persistência.
4. `npm run test:e2e` — se a suspeita é de UI/DOM ou não reproduz nas
   camadas de baixo.
