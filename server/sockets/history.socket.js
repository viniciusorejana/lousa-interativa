const {
  applyActionPatch, broadcastHistoryFlags, scheduleSave,
} = require('../services/room.service');

// Monta o payload de diff de um undo/redo: só os objetos AFETADOS pela ação
// (as chaves do patch), com seu valor resultante no estado da sala (ou null se
// foram removidos), mais layers/zorder resultantes. Substitui o antigo
// 'board:sync' que reenviava o ESTADO INTEIRO da sala a cada Ctrl+Z — o
// cliente descartava e re-deserializava todos os objetos (re-baixando imagens
// e re-decodificando GIFs), causando flicker proporcional ao tamanho do board.
// Objetos que sofreram conflito (outro usuário mexeu depois) entram no diff com
// seu valor ATUAL inalterado — o cliente só reaplica o que já tem (no-op).
function buildHistoryDiff(room, action, direction) {
  const objMap = direction === 'before' ? action.objectsBefore : action.objectsAfter;
  const objects = {};
  if (objMap) {
    for (const id of Object.keys(objMap)) {
      objects[id] = room.state.objects[id] || null; // null = remover no cliente
    }
  }
  const payload = { objects, zorder: room.state.zorder || [] };
  // layers só entram se a ação de fato mexeu em camadas (rename/add/delete de
  // camada via undo) — a maioria das ações não mexe.
  if (action.layersBefore || action.layersAfter) payload.layers = room.state.layers;
  return payload;
}

// Undo/redo por usuário (cada um só desfaz/refaz as próprias ações — ver
// comentário completo em room.service.js/pushUserAction).
function register(ctx) {
  const { socket, io, room, roomId, userId, toRoom } = ctx;

  socket.on('history:undo', () => {
    const uh = (room.userHistory || {})[userId];
    if (!uh || !uh.undoStack.length) return;
    const action = uh.undoStack.pop();
    const conflicts = applyActionPatch(room, action, 'before');
    uh.redoStack.push(action);
    toRoom('history:apply', buildHistoryDiff(room, action, 'before'));
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
    if (conflicts) socket.emit('history:conflict', { count: conflicts, action: 'undo' });
  });

  socket.on('history:redo', () => {
    const uh = (room.userHistory || {})[userId];
    if (!uh || !uh.redoStack.length) return;
    const action = uh.redoStack.pop();
    const conflicts = applyActionPatch(room, action, 'after');
    uh.undoStack.push(action);
    toRoom('history:apply', buildHistoryDiff(room, action, 'after'));
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
    if (conflicts) socket.emit('history:conflict', { count: conflicts, action: 'redo' });
  });
}

module.exports = { register };
