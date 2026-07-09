const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');

const { startTestServer, uniqueRoomName } = require('./_setup');

// Ver auth.test.js: server/index.js não expõe a instância http/io e deixa
// timers de manutenção ativos, então o processo nunca sairia sozinho.
after(() => new Promise(resolve => setTimeout(() => { process.exit(0); resolve(); }, 200)));

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando evento '${event}'`)), 5000);
    socket.once(event, payload => { clearTimeout(timer); resolve(payload); });
  });
}

// Registra o listener de 'board:init' SÍNCRONAMENTE, antes de qualquer await —
// o servidor emite 'board:init' assim que aceita a conexão (dentro do próprio
// handler io.on('connection', ...)), quase junto com o ack de 'connect' do
// lado do cliente. Esperar 'connect' primeiro e só DEPOIS registrar o
// listener de 'board:init' é uma corrida real: o evento pode chegar
// exatamente nesse intervalo e nunca ser capturado.
function connectClient(baseUrl, { roomId, userName = 'Tester', clientId } = {}) {
  const socket = ioClient(baseUrl, {
    query: { roomId, userName, ...(clientId ? { clientId } : {}) },
    forceNew: true,
    reconnection: false,
  });
  const init = once(socket, 'board:init');
  return { socket, init };
}

test('integração de servidor: sockets em tempo real', async (t) => {
  const { baseUrl } = await startTestServer();

  await t.test('board:init: cliente novo recebe estado vazio da sala', async () => {
    const roomId = uniqueRoomName();
    const { socket: a, init } = connectClient(baseUrl, { roomId });
    t.after(() => a.close());

    const payload = await init;
    assert.equal(payload.roomId, roomId);
    assert.deepEqual(payload.state.objects, {});
    assert.equal(payload.canUndo, false);
    assert.equal(payload.canRedo, false);
    assert.ok(payload.userId);
  });

  await t.test('object:add é propagado para outros clientes da mesma sala (não para o remetente)', async () => {
    const roomId = uniqueRoomName();
    const { socket: a, init: initA } = connectClient(baseUrl, { roomId });
    const { socket: b, init: initB } = connectClient(baseUrl, { roomId });
    t.after(() => { a.close(); b.close(); });
    await Promise.all([initA, initB]);

    const bGotAdd = once(b, 'object:add');
    a.emit('object:add', { id: 'obj-1', type: 'rect', left: 0, top: 0 });
    const received = await bGotAdd;
    assert.equal(received.id, 'obj-1');
  });

  await t.test('object:add + object:remove: zorder e estado da sala são atualizados', async () => {
    const roomId = uniqueRoomName();
    const { socket: a, init: initA } = connectClient(baseUrl, { roomId });
    const { socket: b, init: initB } = connectClient(baseUrl, { roomId });
    t.after(() => { a.close(); b.close(); });
    await Promise.all([initA, initB]);

    const bGotAdd = once(b, 'object:add');
    a.emit('object:add', { id: 'obj-rm', type: 'rect', left: 0, top: 0 });
    await bGotAdd;

    const bGotRemove = once(b, 'object:remove');
    a.emit('object:remove', ['obj-rm']);
    const removedIds = await bGotRemove;
    assert.deepEqual(removedIds, ['obj-rm']);

    // Um terceiro cliente que entra depois não deveria ver o objeto removido.
    const { socket: c, init: initC } = connectClient(baseUrl, { roomId });
    t.after(() => c.close());
    const payload = await initC;
    assert.equal(payload.state.objects['obj-rm'], undefined);
  });

  await t.test('objects:batch: cria múltiplos objetos de uma vez, propagado para outros', async () => {
    const roomId = uniqueRoomName();
    const { socket: a, init: initA } = connectClient(baseUrl, { roomId });
    const { socket: b, init: initB } = connectClient(baseUrl, { roomId });
    t.after(() => { a.close(); b.close(); });
    await Promise.all([initA, initB]);

    const bGotBatch = once(b, 'objects:batch');
    a.emit('objects:batch', [
      { id: 'batch-1', type: 'rect', left: 0, top: 0 },
      { id: 'batch-2', type: 'rect', left: 10, top: 10 },
    ]);
    const batch = await bGotBatch;
    assert.equal(batch.length, 2);
  });

  await t.test('layers:update e layer:visibility são propagados para outros clientes', async () => {
    const roomId = uniqueRoomName();
    const { socket: a, init: initA } = connectClient(baseUrl, { roomId });
    const { socket: b, init: initB } = connectClient(baseUrl, { roomId });
    t.after(() => { a.close(); b.close(); });
    await Promise.all([initA, initB]);

    const newLayers = [
      { id: 'layer-default', name: 'Camada 1', visible: true },
      { id: 'layer-2', name: 'Camada 2', visible: true },
    ];
    const bGotLayers = once(b, 'layers:update');
    a.emit('layers:update', newLayers);
    assert.deepEqual(await bGotLayers, newLayers);

    const bGotVisibility = once(b, 'layer:visibility');
    a.emit('layer:visibility', { layerId: 'layer-2', visible: false });
    assert.deepEqual(await bGotVisibility, { layerId: 'layer-2', visible: false });
  });

  await t.test('groups:update: sincroniza o registro de grupos entre clientes', async () => {
    const roomId = uniqueRoomName();
    const { socket: a, init: initA } = connectClient(baseUrl, { roomId });
    const { socket: b, init: initB } = connectClient(baseUrl, { roomId });
    t.after(() => { a.close(); b.close(); });
    await Promise.all([initA, initB]);

    const groups = [{ id: 'group-1', name: 'Grupo 1', locked: false, viewHidden: false }];
    const bGotGroups = once(b, 'groups:update');
    a.emit('groups:update', groups);
    assert.deepEqual(await bGotGroups, groups);
  });

  await t.test('staging:sync/staging:remove: persistido por clientId, entregue a TODOS na sala (inclusive remetente)', async () => {
    const roomId = uniqueRoomName();
    const { socket: a, init } = connectClient(baseUrl, { roomId, clientId: 'client-fixo-123' });
    t.after(() => a.close());
    await init;

    const aGotSync = once(a, 'staging:sync');
    a.emit('staging:sync', { left: 100, top: 200 });
    const entry = await aGotSync;
    assert.equal(entry.clientId, 'client-fixo-123');
    assert.equal(entry.left, 100);
    assert.equal(entry.top, 200);

    const aGotRemove = once(a, 'staging:remove');
    a.emit('staging:remove');
    assert.deepEqual(await aGotRemove, { clientId: 'client-fixo-123' });
  });

  await t.test('history:undo/redo: restaura objetos + zorder juntos e atualiza canUndo/canRedo', async () => {
    const roomId = uniqueRoomName();
    const { socket: a, init } = connectClient(baseUrl, { roomId });
    t.after(() => a.close());
    await init;

    const gotHistoryAfterAdd = once(a, 'history:update');
    a.emit('object:add', { id: 'undo-1', type: 'rect', left: 0, top: 0 });
    const historyAfterAdd = await gotHistoryAfterAdd;
    assert.equal(historyAfterAdd.canUndo, true);
    assert.equal(historyAfterAdd.canRedo, false);

    const gotSyncAfterUndo = once(a, 'board:sync');
    a.emit('history:undo');
    const stateAfterUndo = await gotSyncAfterUndo;
    assert.equal(stateAfterUndo.objects['undo-1'], undefined);

    const gotSyncAfterRedo = once(a, 'board:sync');
    a.emit('history:redo');
    const stateAfterRedo = await gotSyncAfterRedo;
    assert.ok(stateAfterRedo.objects['undo-1']);
  });

  await t.test('persistência: sala evictada da RAM (mas com JSON salvo em disco) é restaurada ao reconectar', async () => {
    // Exigido só aqui, DEPOIS que startTestServer() (chamado no início deste
    // arquivo de teste, via baseUrl acima) já setou LB_TEST_DATA_DIR/
    // LB_TEST_UPLOADS_DIR e startTestServer requeriu server/index.js — que é
    // quando config.js de fato lê essas envs. Exigir room.service no topo do
    // arquivo, antes disso, faz config.js se vincular aos diretórios REAIS de
    // uploads/data-rooms antes do override existir — foi exatamente isso que
    // apagou data/rooms/lousa.json numa execução anterior deste teste.
    const roomService = require('../../../server/services/room.service');

    const roomId = uniqueRoomName();
    const { socket: a, init } = connectClient(baseUrl, { roomId });
    await init;

    a.emit('object:add', { id: 'persisted-1', type: 'rect', left: 1, top: 2 });
    // scheduleSave grava no disco 2s (SAVE_DEBOUNCE) após a última alteração.
    await new Promise(resolve => setTimeout(resolve, 2400));
    a.close();

    // Simula a sala saindo da RAM (eviction sweep real faria isso após 30min
    // vazia) sem esperar o tempo real nem reiniciar o processo — o arquivo em
    // disco (escrito acima) continua lá.
    delete roomService.rooms[roomId];

    const { socket: b, init: initB } = connectClient(baseUrl, { roomId });
    t.after(() => b.close());
    const payload = await initB;
    assert.ok(payload.state.objects['persisted-1'], 'objeto deveria ter sido restaurado do disco');
  });
});
