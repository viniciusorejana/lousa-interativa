// Testa se o grafo de módulos de board-app.js consegue ser IMPORTADO (avaliação
// de nível superior) sem lançar erro — é exatamente essa fase que pega bugs de
// TDZ em imports circulares, como o `Cannot access 'X' before initialization`.
import assert from 'node:assert/strict';
import './mocks.mjs';

let importFailed = false;
let canvas, boardLayers;
try {
  await import('../public/js/board-app.js');
  ({ canvas } = await import('../public/js/core/canvas-manager.js'));
  ({ boardLayers } = await import('../public/js/features/layers/layers-panel.js'));
  console.log('[ok] board-app.js e todo o grafo de módulos importaram sem erro');
} catch (err) {
  importFailed = true;
  console.error('[FALHA] erro ao importar o grafo de módulos:');
  console.error(err.stack || err);
}

if (importFailed) process.exit(1);

// ── Fase 2: dispara eventos de socket reais, simulando o que o servidor manda ──
// Pega bugs que só aparecem DENTRO de um handler de evento (ex: referenciar uma
// variável que devia ter sido importada de outro módulo, mas não foi) — isso não
// aparece no teste de importação sozinho, que só cobre o nível superior do
// módulo. Reporta qualquer erro; falha o teste especificamente em
// ReferenceError, que é a assinatura exata de "esqueci de exportar/importar
// alguma coisa" (outros erros podem só refletir limitação dos mocks, não bug
// real — ficam como aviso pra revisão manual).
const socket = globalThis.__testSocket;
let referenceErrors = 0;

const events = {
  'board:init': {
    state: { objects: {}, layers: [{ id: 'layer-default', name: 'Camada 1', visible: true }], viewport: { x: 0, y: 0, w: 1920, h: 1080 }, stagingAreas: {} },
    zorder: [], roomId: 'test-room', userId: 'u1', userName: 'Tester', userColor: 'hsl(0,70%,60%)',
    canUndo: false, canRedo: false,
  },
  'users:update': [{ id: 'u1', name: 'Tester', color: 'red' }],
  'history:update': { canUndo: false, canRedo: false },
  'layers:update': [{ id: 'layer-default', name: 'Camada 1', visible: true }],
  'layer:visibility': { layerId: 'layer-default', visible: true },
  'object:add': { id: 'o1', type: 'rect', left: 0, top: 0 },
  // Payload real de object:modify sempre inclui o objeto serializado inteiro
  // (ver ser() em core/serialization.js), não só os campos alterados — o
  // servidor apenas repassa o que o cliente mandou (server/sockets/objects.socket.js).
  'object:modify': { id: 'o1', type: 'rect', left: 5, top: 5 },
  'object:remove': ['o1'],
  'objects:batch': [{ id: 'o2', type: 'rect', left: 0, top: 0 }],
  'zorder:sync': ['o1'],
  'viewport:sync': { x: 0, y: 0, w: 1920, h: 1080 },
  'staging:sync': { clientId: 'c2', name: 'Outro', color: 'blue', left: 0, top: 0 },
  'staging:remove': { clientId: 'c2' },
  'cursor:move': { userId: 'u2', userName: 'Outro', color: 'blue', x: 10, y: 10 },
  'cursor:remove': 'u2',
  'draw:start': { userId: 'u2', x: 0, y: 0, color: 'blue', width: 4, opacity: 1 },
  'draw:move': { userId: 'u2', x: 5, y: 5 },
  'draw:end': { userId: 'u2', object: null },
  'shape:start': { userId: 'u2', shapeId: 's1', tool: 'rect', x: 0, y: 0, color: 'blue', width: 4, opacity: 1, fillShape: false },
  'shape:move': { userId: 'u2', x: 5, y: 5 },
  'shape:end': { userId: 'u2', object: null },
  'shape:cancel': { userId: 'u2' },
  'board:sync': { objects: {}, layers: [{ id: 'layer-default', name: 'Camada 1', visible: true }], viewport: { x: 0, y: 0, w: 1920, h: 1080 }, stagingAreas: {} },
  'board:clear': undefined,
};

// ── Asserções reais de estado, rodadas logo depois do evento correspondente ──
// Os mocks (FakeCanvas._objects, boardLayers) já guardam estado o bastante pra
// checar comportamento de verdade, não só "não lançou erro". Cobre só os
// eventos onde dá pra afirmar algo simples e determinístico — o resto continua
// coberto apenas pelo smoke test de "não lança ReferenceError" abaixo.
function findObj(id) { return canvas.getObjects().find(o => o.id === id); }

const assertions = {
  'object:add': () => assert.ok(findObj('o1'), "object:add deveria ter adicionado o objeto 'o1' ao canvas"),
  'object:modify': () => {
    const o = findObj('o1');
    assert.ok(o, "'o1' deveria continuar no canvas após object:modify");
    assert.equal(canvas.getObjects().filter(x => x.id === 'o1').length, 1, "object:modify não deveria duplicar o objeto");
  },
  'object:remove': () => assert.equal(findObj('o1'), undefined, "object:remove deveria ter removido 'o1' do canvas"),
  'objects:batch': () => assert.ok(findObj('o2'), "objects:batch deveria ter adicionado o objeto 'o2' ao canvas"),
  'layers:update': () => assert.ok(
    boardLayers.some(l => l.id === 'layer-default'),
    "layers:update deveria refletir no array boardLayers compartilhado"
  ),
  'board:clear': () => assert.equal(
    canvas.getObjects().filter(o => !o._isViewportRect).length, 0,
    'board:clear deveria remover todos os objetos de conteúdo do canvas'
  ),
};

let assertionFailures = 0;

for (const [event, payload] of Object.entries(events)) {
  try {
    socket.emit(event, payload);
    console.log(`[ok] evento '${event}' processado sem erro`);
    if (assertions[event]) {
      assertions[event]();
      console.log(`[ok] evento '${event}' passou na asserção de estado`);
    }
  } catch (err) {
    if (err instanceof assert.AssertionError) {
      assertionFailures++;
      console.error(`[FALHA] asserção do evento '${event}' falhou: ${err.message}`);
      continue;
    }
    const isRefError = err instanceof ReferenceError;
    console.error(`[${isRefError ? 'FALHA' : 'aviso'}] evento '${event}' lançou ${err.constructor.name}: ${err.message}`);
    if (isRefError) referenceErrors++;
  }
}

if (referenceErrors > 0) {
  console.error(`\n${referenceErrors} ReferenceError encontrado(s) — provável export/import faltando.`);
  process.exit(1);
}
if (assertionFailures > 0) {
  console.error(`\n${assertionFailures} asserção(ões) de estado falharam.`);
  process.exit(1);
}
console.log('\n[ok] nenhum ReferenceError e todas as asserções de estado passaram');
process.exit(0);
