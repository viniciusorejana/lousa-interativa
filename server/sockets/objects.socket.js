const {
  pushUserAction, broadcastHistoryFlags, scheduleSave,
} = require('../services/room.service');

// Eventos de criação/edição/remoção de objetos do canvas (formas, imagens,
// textos, traços já finalizados) e do z-order (ordem de empilhamento).
function register(ctx) {
  const { socket, io, room, roomId, userId, bcast } = ctx;

  socket.on('object:add', obj => {
    const before = { [obj.id]: room.state.objects[obj.id] || null };
    room.state.objects[obj.id] = { ...obj, ts: Date.now() };
    if (!room.state.zorder) room.state.zorder = [];
    const zorderBefore = room.state.zorder.slice();
    const zorder = room.state.zorder;
    const existingIdx = zorder.indexOf(obj.id);
    if (existingIdx !== -1) zorder.splice(existingIdx, 1);
    const targetIdx = (obj.zIndex !== undefined)
      ? Math.min(obj.zIndex, zorder.length)
      : zorder.length;
    zorder.splice(targetIdx, 0, obj.id);
    const after = { [obj.id]: room.state.objects[obj.id] };
    pushUserAction(room, userId, { objectsBefore: before, objectsAfter: after, zorderBefore, zorderAfter: zorder.slice() });
    bcast('object:add', obj);
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
  });

  socket.on('object:modify', data => {
    if (data._visibilityChange) {
      room.state.objects[data.id] = { ...room.state.objects[data.id], ...data };
      bcast('object:modify', data);
      scheduleSave(roomId);
      return;
    }
    room.state.objects[data.id] = { ...data, ts: Date.now() };
    bcast('object:modify', data);
    scheduleSave(roomId);
  });

  socket.on('object:modify:commit', data => {
    const before = { [data.id]: room.state.objects[data.id] || null };
    room.state.objects[data.id] = { ...data, ts: Date.now() };
    const after = { [data.id]: room.state.objects[data.id] };
    pushUserAction(room, userId, { objectsBefore: before, objectsAfter: after });
    bcast('object:modify', data);
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
  });

  socket.on('object:remove', ids => {
    const list = Array.isArray(ids) ? ids : [ids];
    const before = {}, after = {};
    const zorderBefore = (room.state.zorder || []).slice();
    list.forEach(id => {
      before[id] = room.state.objects[id] || null;
      after[id]  = null;
      delete room.state.objects[id];
      if (room.state.zorder) {
        const i = room.state.zorder.indexOf(id);
        if (i !== -1) room.state.zorder.splice(i, 1);
      }
    });
    pushUserAction(room, userId, { objectsBefore: before, objectsAfter: after, zorderBefore, zorderAfter: (room.state.zorder || []).slice() });
    bcast('object:remove', list);
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
  });

  socket.on('objects:batch', objects => {
    if (!room.state.zorder) room.state.zorder = [];
    const zorderBefore = room.state.zorder.slice();
    const before = {}, after = {};
    objects.forEach(obj => {
      before[obj.id] = room.state.objects[obj.id] || null;
      room.state.objects[obj.id] = { ...obj, ts: Date.now() };
      after[obj.id] = room.state.objects[obj.id];
      const zorder = room.state.zorder;
      const existingIdx = zorder.indexOf(obj.id);
      if (existingIdx !== -1) zorder.splice(existingIdx, 1);
      const targetIdx = (obj.zIndex !== undefined)
        ? Math.min(obj.zIndex, zorder.length)
        : zorder.length;
      zorder.splice(targetIdx, 0, obj.id);
    });
    pushUserAction(room, userId, { objectsBefore: before, objectsAfter: after, zorderBefore, zorderAfter: room.state.zorder.slice() });
    bcast('objects:batch', objects);
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
  });

  socket.on('object:transform', data => {
    if (room.state.objects[data.id])
      room.state.objects[data.id] = { ...room.state.objects[data.id], ...data };
    socket.broadcast.to(roomId).volatile.emit('object:transform', data);
  });

  socket.on('objects:transform', updates => {
    updates.forEach(d => {
      if (room.state.objects[d.id])
        room.state.objects[d.id] = { ...room.state.objects[d.id], ...d };
    });
    socket.broadcast.to(roomId).volatile.emit('objects:transform', updates);
  });

  socket.on('zorder:sync', order => {
    room.state.zorder = order;
    bcast('zorder:sync', order);
    scheduleSave(roomId);
  });
}

module.exports = { register };
