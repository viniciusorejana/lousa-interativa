const { v4: uuidv4 } = require('uuid');

const { getRoom, historyFlagsFor } = require('../services/room.service');
const { slugify } = require('../utils/slugify');

const objectsSocket   = require('./objects.socket');
const groupsSocket    = require('./groups.socket');
const layersSocket    = require('./layers.socket');
const historySocket   = require('./history.socket');
const drawingSocket   = require('./drawing.socket');
const viewportSocket  = require('./viewport.socket');
const lifecycleSocket = require('./lifecycle.socket');

// Um módulo por grupo de eventos (ver arquivos irmãos). Cada um recebe o
// mesmo "contexto" (ctx) com socket/io/room/identidade do usuário/helpers de
// broadcast, e registra seus próprios `socket.on(...)`.
const handlerModules = [
  objectsSocket, groupsSocket, layersSocket,
  historySocket, drawingSocket, viewportSocket, lifecycleSocket,
];

function registerSocketHandlers(io) {
  io.on('connection', socket => {
    const clientType = socket.handshake.query.type || 'editor';
    const userId     = uuidv4().slice(0, 8);
    const userName   = (socket.handshake.query.userName || '').trim().slice(0, 24) || `Usuário ${userId.slice(0, 4)}`;
    const userColor  = `hsl(${Math.floor(Math.random() * 360)},70%,60%)`;
    const rawRoom    = (socket.handshake.query.roomId || 'default').trim();
    const roomId     = slugify(rawRoom) || 'default';
    // Identificador persistente POR NAVEGADOR (não por conexão — sobrevive a
    // reconexões, diferente de userId). Usado só pra identificar de quem é
    // cada área reservada de spawn (ver viewport.socket.js). Cai pro userId
    // da conexão se o cliente não enviar um (ex: cliente antigo, ou a view
    // do OBS).
    const clientId = (socket.handshake.query.clientId || '').trim().slice(0, 60) || userId;

    const room = getRoom(roomId);
    socket.join(roomId); // Socket.IO room para broadcast isolado
    socket._lbUserId = userId; // usado por broadcastHistoryFlags para achar o socket de cada usuário

    console.log(`[${new Date().toLocaleTimeString()}] ${clientType} +${userName} → [${roomId}]`);

    socket.emit('board:init', {
      state:  room.state,
      zorder: room.state.zorder || [],
      roomId,
      userId,
      userName,
      userColor,
      ...historyFlagsFor(room, userId), // sempre {canUndo:false, canRedo:false} numa conexão nova
    });

    if (clientType === 'editor') {
      room.users[userId] = { id: userId, name: userName, color: userColor };
      room.lastEmpty = null; // sala tem usuário — cancela eviction
      io.to(roomId).emit('users:update', Object.values(room.users));
    }

    const ctx = {
      socket, io, room, roomId,
      userId, userName, userColor, clientId, clientType,
      // Helper: broadcast para a sala exceto o remetente
      bcast:  (ev, data) => socket.broadcast.to(roomId).emit(ev, data),
      // Helper: emit para todos na sala (inclusive remetente)
      toRoom: (ev, data) => io.to(roomId).emit(ev, data),
    };

    handlerModules.forEach(mod => mod.register(ctx));
  });
}

module.exports = { registerSocketHandlers };
