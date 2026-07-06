const {
  pushUserAction, broadcastHistoryFlags, scheduleSave,
} = require('../services/room.service');

// Operações atômicas de agrupar/desagrupar: cada uma mexe em vários objetos
// e no zorder de uma vez só, mas conta como UMA única ação de undo/redo.
function register(ctx) {
  const { socket, io, room, roomId, userId, bcast } = ctx;

  socket.on('group:commit', ({ group, childIds, zorder }) => {
    const before = { [group.id]: room.state.objects[group.id] || null };
    childIds.forEach(id => { before[id] = room.state.objects[id] || null; });
    const zorderBefore = (room.state.zorder || []).slice();

    room.state.objects[group.id] = { ...group, ts: Date.now() };
    childIds.forEach(id => delete room.state.objects[id]);
    if (zorder) room.state.zorder = zorder;

    const after = { [group.id]: room.state.objects[group.id] };
    childIds.forEach(id => { after[id] = null; });

    pushUserAction(room, userId, { objectsBefore: before, objectsAfter: after, zorderBefore, zorderAfter: (room.state.zorder || []).slice() });
    bcast('group:commit', { group, childIds, zorder });
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
  });

  socket.on('ungroup:commit', ({ groupId, children, zorder }) => {
    const before = { [groupId]: room.state.objects[groupId] || null };
    children.forEach(ch => { before[ch.id] = room.state.objects[ch.id] || null; });
    const zorderBefore = (room.state.zorder || []).slice();

    delete room.state.objects[groupId];
    children.forEach(ch => { room.state.objects[ch.id] = { ...ch, ts: Date.now() }; });
    if (zorder) room.state.zorder = zorder;

    const after = { [groupId]: null };
    children.forEach(ch => { after[ch.id] = room.state.objects[ch.id]; });

    pushUserAction(room, userId, { objectsBefore: before, objectsAfter: after, zorderBefore, zorderAfter: (room.state.zorder || []).slice() });
    bcast('ungroup:commit', { groupId, children, zorder });
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
  });
}

module.exports = { register };
