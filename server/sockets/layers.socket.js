const { scheduleSave } = require('../services/room.service');

function register(ctx) {
  const { socket, room, roomId, bcast, toRoom } = ctx;

  socket.on('layers:update', layers => {
    room.state.layers = layers;
    bcast('layers:update', layers);
    scheduleSave(roomId);
  });

  socket.on('layer:visibility', ({ layerId, visible }) => {
    const layer = room.state.layers.find(l => l.id === layerId);
    if (layer) layer.visible = visible;
    Object.values(room.state.objects).forEach(obj => {
      if (obj.layerId === layerId) obj._layerHidden = !visible;
    });
    toRoom('layer:visibility', { layerId, visible });
    scheduleSave(roomId);
  });
}

module.exports = { register };
