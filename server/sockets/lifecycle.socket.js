const {
  pushUserAction, broadcastHistoryFlags, scheduleSave,
} = require('../services/room.service');

function register(ctx) {
  const { socket, io, room, roomId, userId, userName, clientType, bcast, toRoom } = ctx;

  socket.on('board:clear', () => {
    const before = {};
    Object.entries(room.state.objects).forEach(([id, obj]) => { before[id] = obj; });
    const after = {};
    Object.keys(room.state.objects).forEach(id => { after[id] = null; });
    const zorderBefore = (room.state.zorder || []).slice();
    room.state.objects = {};
    room.state.zorder  = [];
    pushUserAction(room, userId, { objectsBefore: before, objectsAfter: after, zorderBefore, zorderAfter: [] });
    toRoom('board:clear');
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
  });

  socket.on('disconnect', () => {
    delete room.users[userId];
    // userId é gerado por conexão — ao desconectar, o histórico deste usuário
    // fica inalcançável mesmo se reconectar (novo userId). Libera a memória.
    if (room.userHistory) delete room.userHistory[userId];
    toRoom('users:update', Object.values(room.users));
    bcast('cursor:remove', userId);
    // Se a sala ficou vazia, marca o timestamp para eviction
    if (Object.keys(room.users).length === 0) {
      room.lastEmpty = Date.now();
      // Não salvamos mais em disco ao ficar vazia — o eviction apaga tudo após 30min
      console.log(`[room] Vazia: ${roomId} — será apagada em 30min se ninguém entrar`);
    }
    console.log(`[${new Date().toLocaleTimeString()}] ${clientType} -${userName} ← [${roomId}]`);
  });
}

module.exports = { register };
