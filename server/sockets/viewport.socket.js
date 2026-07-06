const { scheduleSave } = require('../services/room.service');

function register(ctx) {
  const { socket, room, roomId, userId, userName, userColor, clientId, bcast, toRoom } = ctx;

  socket.on('cursor:move', pos => {
    socket.broadcast.to(roomId).volatile.emit('cursor:move', { userId, userName, color: userColor, ...pos });
  });

  socket.on('viewport:sync', vp => {
    room.state.viewport = vp;
    bcast('viewport:sync', vp);
    scheduleSave(roomId);
  });

  // Área reservada de spawn (por cliente). Não é tempo real (não segue o
  // mouse pela rede) — só sincroniza quando a pessoa CONFIRMA a nova posição.
  // Guardamos por clientId (persiste entre reconexões) pra cada cliente ter
  // sua própria área mostrada pros outros, sem depender de estar online no
  // momento.
  socket.on('staging:sync', pos => {
    if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
    if (!room.state.stagingAreas) room.state.stagingAreas = {};
    const entry = { clientId, name: userName, color: userColor, left: pos.left, top: pos.top, updatedAt: Date.now() };
    room.state.stagingAreas[clientId] = entry;
    toRoom('staging:sync', entry); // inclui o remetente, pra confirmar visualmente também
    scheduleSave(roomId);
  });

  socket.on('staging:remove', () => {
    if (room.state.stagingAreas) delete room.state.stagingAreas[clientId];
    toRoom('staging:remove', { clientId });
    scheduleSave(roomId);
  });
}

module.exports = { register };
