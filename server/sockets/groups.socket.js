const { scheduleSave } = require('../services/room.service');

// Grupos hoje são só uma etiqueta (`groupId`) em cada objeto — igual à camada
// (`layerId`). Este handler só sincroniza o registro `boardGroups` ({id, name,
// locked}) entre clientes, mesmo padrão de 'layers:update' (sem tracking de
// undo — consistente com o que já existia para 'layers:update'/'layer:visibility').
function register(ctx) {
  const { socket, room, roomId, bcast } = ctx;

  socket.on('groups:update', groups => {
    room.state.groups = groups;
    bcast('groups:update', groups);
    scheduleSave(roomId);
  });
}

module.exports = { register };
