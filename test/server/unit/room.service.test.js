const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { MAX_HISTORY, SAVE_DEBOUNCE } = require('../../../server/config');
const roomService = require('../../../server/services/room.service');

// Cada teste usa um roomId único pra nunca colidir com salas reais de
// desenvolvimento — e limpamos o registro em memória + o arquivo em disco
// (se criado) ao final de cada teste.
function uniqueRoomId() {
  return 'test-room-' + crypto.randomUUID();
}

function cleanup(roomId) {
  delete roomService.rooms[roomId];
  try { fs.unlinkSync(roomService.roomFile(roomId)); } catch (_) {}
}

test('defaultRoomState: formato inicial esperado', () => {
  const state = roomService.defaultRoomState();
  assert.deepEqual(state.layers, [{ id: 'layer-default', name: 'Camada 1', visible: true }]);
  assert.deepEqual(state.groups, []);
  assert.deepEqual(state.objects, {});
  assert.deepEqual(state.stagingAreas, {});
});

test('getRoom: cria sala nova quando não existe no disco', (t) => {
  const roomId = uniqueRoomId();
  t.after(() => cleanup(roomId));

  const room = roomService.getRoom(roomId);
  assert.ok(room.state);
  assert.deepEqual(room.users, {});
  assert.deepEqual(room.userHistory, {});
});

test('getRoom: chamadas repetidas retornam a mesma instância em memória', (t) => {
  const roomId = uniqueRoomId();
  t.after(() => cleanup(roomId));

  const room1 = roomService.getRoom(roomId);
  room1.state.objects['obj-1'] = { id: 'obj-1', type: 'rect' };
  const room2 = roomService.getRoom(roomId);
  assert.equal(room1, room2);
  assert.ok(room2.state.objects['obj-1']);
});

test('pushUserAction + historyFlagsFor: canUndo fica true após ação, canRedo continua false', (t) => {
  const roomId = uniqueRoomId();
  t.after(() => cleanup(roomId));
  const room = roomService.getRoom(roomId);

  assert.deepEqual(roomService.historyFlagsFor(room, 'user-1'), { canUndo: false, canRedo: false });

  roomService.pushUserAction(room, 'user-1', {
    objectsBefore: null,
    objectsAfter: { 'obj-1': { id: 'obj-1', type: 'rect' } },
  });

  assert.deepEqual(roomService.historyFlagsFor(room, 'user-1'), { canUndo: true, canRedo: false });
});

test(`pushUserAction: undoStack nunca ultrapassa MAX_HISTORY (${MAX_HISTORY})`, (t) => {
  const roomId = uniqueRoomId();
  t.after(() => cleanup(roomId));
  const room = roomService.getRoom(roomId);

  for (let i = 0; i < MAX_HISTORY + 5; i++) {
    roomService.pushUserAction(room, 'user-1', { objectsAfter: { [`o${i}`]: { id: `o${i}` } } });
  }

  assert.equal(room.userHistory['user-1'].undoStack.length, MAX_HISTORY);
});

test('applyActionPatch: aplica objectsAfter na direção "after" e objectsBefore na direção "before"', () => {
  const room = { state: { objects: {}, layers: [], zorder: [] } };
  const action = {
    objectsBefore: { 'obj-1': null },
    objectsAfter: { 'obj-1': { id: 'obj-1', left: 10 } },
  };

  const conflictsAfter = roomService.applyActionPatch(room, action, 'after');
  assert.equal(conflictsAfter, 0);
  assert.deepEqual(room.state.objects['obj-1'], { id: 'obj-1', left: 10 });

  const conflictsBefore = roomService.applyActionPatch(room, action, 'before');
  assert.equal(conflictsBefore, 0);
  assert.equal(room.state.objects['obj-1'], undefined);
});

test('applyActionPatch: detecta conflito quando o valor atual diverge do esperado', () => {
  const room = { state: { objects: { 'obj-1': { id: 'obj-1', left: 999 } }, layers: [], zorder: [] } };
  const action = {
    objectsBefore: { 'obj-1': { id: 'obj-1', left: 0 } },
    objectsAfter: { 'obj-1': { id: 'obj-1', left: 10 } },
  };

  // "before" espera encontrar objectsAfter (left:10) no estado atual, mas o
  // estado atual tem left:999 (outro usuário mexeu depois) — deve contar 1 conflito.
  const conflicts = roomService.applyActionPatch(room, action, 'before');
  assert.equal(conflicts, 1);
  assert.equal(room.state.objects['obj-1'].left, 999); // não sobrescreve
});

test('collectReferencedFilenames: inclui imagens do estado atual da sala', (t) => {
  const roomId = uniqueRoomId();
  t.after(() => cleanup(roomId));
  const room = roomService.getRoom(roomId);
  room.state.objects['img-1'] = { id: 'img-1', type: 'image', src: '/uploads/referenced.webp' };

  const referenced = roomService.collectReferencedFilenames();
  assert.ok(referenced.has('referenced.webp'));
});

test('scheduleSave: persiste o estado no disco após o debounce e loadRoomFromDisk lê de volta', async (t) => {
  const roomId = uniqueRoomId();
  t.after(() => cleanup(roomId));
  const room = roomService.getRoom(roomId);
  room.state.objects['obj-persisted'] = { id: 'obj-persisted', type: 'rect' };

  roomService.scheduleSave(roomId);
  await new Promise(resolve => setTimeout(resolve, SAVE_DEBOUNCE + 300));

  assert.ok(fs.existsSync(roomService.roomFile(roomId)));
  const loaded = roomService.loadRoomFromDisk(roomId);
  assert.ok(loaded.state.objects['obj-persisted']);
});
