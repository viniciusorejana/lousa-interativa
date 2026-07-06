const {
  applyActionPatch, broadcastHistoryFlags, scheduleSave,
} = require('../services/room.service');

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
    toRoom('board:sync', room.state);
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
    toRoom('board:sync', room.state);
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
    if (conflicts) socket.emit('history:conflict', { count: conflicts, action: 'redo' });
  });
}

module.exports = { register };
