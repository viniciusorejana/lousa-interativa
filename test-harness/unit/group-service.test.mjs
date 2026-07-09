// Testa public/js/features/groups/group-service.js sob os mocks do
// test-harness. O módulo importa de volta de board-app.js (padrão circular
// documentado em CLAUDE.md), então o caminho de importação precisa seguir a
// mesma ordem que o navegador real usa: mocks -> board-app.js (que já importa
// group-service.js internamente) -> reimporta os módulos específicos (ESM
// cacheia, então é a mesma instância).
import test from 'node:test';
import assert from 'node:assert/strict';
import '../mocks.mjs';

await import('../../public/js/board-app.js');
const { canvas } = await import('../../public/js/core/canvas-manager.js');
const { boardGroups } = await import('../../public/js/features/layers/layers-panel.js');
const { groupSelected, ungroupSelected, ungroupByIds } = await import('../../public/js/features/groups/group-service.js');

// O mock de socket.io-client (fakeIo) é um único EventEmitter compartilhado
// entre "cliente emite" e "cliente escuta" — diferente da rede real, onde
// socket.emit(...) vai pro servidor e só o broadcast de volta (com uma cópia
// serializada) dispara os listeners locais. Isso faz o listener real de
// 'groups:update' em board-app.js (que faz `boardGroups.length = 0` e
// reconstrói a partir do payload) disparar SINCRONAMENTE dentro do próprio
// socket.emit('groups:update', boardGroups) de group-service.js — e como o
// payload aqui é a MESMA referência de array, o listener acaba esvaziando
// boardGroups antes mesmo dele terminar de ler. Isso é um artefato do mock,
// não um bug do app, então removemos esse listener específico só pra estes
// testes (que verificam o efeito direto de group-service.js sobre
// canvas/boardGroups, não o round-trip de socket).
globalThis.__testSocket.removeAllListeners('groups:update');

function makeRect(id, opts = {}) {
  return new fabric.Rect({ id, type: 'rect', left: 0, top: 0, layerId: null, ...opts });
}

test('groupSelected: atribui o mesmo groupId a todos os objetos selecionados e registra em boardGroups', () => {
  const o1 = makeRect('g-o1');
  const o2 = makeRect('g-o2');
  canvas.add(o1, o2);
  canvas._activeObjects = [o1, o2];

  const groupsBefore = boardGroups.length;
  groupSelected();

  assert.ok(o1.groupId, 'o1 deveria ter recebido um groupId');
  assert.equal(o1.groupId, o2.groupId, 'ambos objetos deveriam compartilhar o mesmo groupId');
  assert.equal(boardGroups.length, groupsBefore + 1, 'boardGroups deveria ganhar uma entrada');
});

test('groupSelected: com menos de 2 selecionados não faz nada', () => {
  const o1 = makeRect('g-solo');
  canvas.add(o1);
  canvas._activeObjects = [o1];

  const groupsBefore = boardGroups.length;
  groupSelected();

  assert.equal(o1.groupId, undefined);
  assert.equal(boardGroups.length, groupsBefore);
});

test('ungroupSelected: remove groupId dos selecionados e limpa boardGroups quando o grupo fica vazio', () => {
  const o1 = makeRect('u-o1');
  const o2 = makeRect('u-o2');
  canvas.add(o1, o2);
  canvas._activeObjects = [o1, o2];
  groupSelected();
  const gid = o1.groupId;
  assert.ok(boardGroups.some(g => g.id === gid));

  canvas._activeObjects = [o1, o2];
  ungroupSelected();

  assert.equal(o1.groupId, null);
  assert.equal(o2.groupId, null);
  assert.ok(!boardGroups.some(g => g.id === gid), 'grupo sem membros deveria ser removido de boardGroups');
});

test('ungroupByIds: desagrupa a partir de uma lista de ids, sem depender da seleção atual do canvas', () => {
  const o1 = makeRect('bi-o1');
  const o2 = makeRect('bi-o2');
  canvas.add(o1, o2);
  canvas._activeObjects = [o1, o2];
  groupSelected();
  const gid = o1.groupId;

  canvas._activeObjects = []; // seleção atual vazia — não deveria importar
  ungroupByIds(['bi-o1', 'bi-o2']);

  assert.equal(o1.groupId, null);
  assert.equal(o2.groupId, null);
  assert.ok(!boardGroups.some(g => g.id === gid));
});
