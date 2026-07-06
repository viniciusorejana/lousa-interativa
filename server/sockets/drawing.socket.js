const {
  pushUserAction, broadcastHistoryFlags, scheduleSave,
} = require('../services/room.service');

// Eventos efêmeros (sem persistência, sem undo) que só existem enquanto o
// traço/forma está sendo desenhado em tempo real. O resultado final chega
// depois via 'object:add' normal (ver objects.socket.js).
function register(ctx) {
  const { socket, io, room, roomId, userId, bcast } = ctx;

  socket.on('draw:start', data => bcast('draw:start', { ...data, userId }));
  socket.on('draw:move',  data => socket.broadcast.to(roomId).emit('draw:move', { ...data, userId }));
  socket.on('draw:end',   data => {
    if (data.object) {
      const before = { [data.object.id]: room.state.objects[data.object.id] || null };
      room.state.objects[data.object.id] = data.object;
      const after = { [data.object.id]: room.state.objects[data.object.id] };
      pushUserAction(room, userId, { objectsBefore: before, objectsAfter: after });
      broadcastHistoryFlags(io, roomId, room);
      scheduleSave(roomId);
    }
    bcast('draw:end', { ...data, userId });
  });

  socket.on('shape:start',  data => bcast('shape:start', { ...data, userId }));
  socket.on('shape:move',   data => socket.broadcast.to(roomId).emit('shape:move', { ...data, userId }));
  socket.on('shape:end',    data => bcast('shape:end', { ...data, userId }));
  socket.on('shape:cancel', data => bcast('shape:cancel', { ...data, userId }));
}

module.exports = { register };
