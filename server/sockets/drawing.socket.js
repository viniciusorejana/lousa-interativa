// Eventos efêmeros (sem persistência, sem undo) que só existem enquanto o
// traço/forma está sendo desenhado em tempo real. O resultado final chega
// depois via 'object:add' normal (ver objects.socket.js), que já é
// responsável por gravar a ação no histórico — 'draw:end' só existe pra
// avisar outros clientes (e a tela de visualização) que o preview ao vivo
// acabou. NÃO grava histórico aqui: gravar de novo o mesmo objeto que o
// 'object:add' acabou de registrar criava uma segunda entrada (before≈after,
// um no-op) na pilha de undo, fazendo o traço só sumir no SEGUNDO Ctrl+Z.
function register(ctx) {
  const { socket, roomId, userId, bcast } = ctx;

  socket.on('draw:start', data => bcast('draw:start', { ...data, userId }));
  socket.on('draw:move',  data => socket.broadcast.to(roomId).emit('draw:move', { ...data, userId }));
  socket.on('draw:end',   data => bcast('draw:end', { ...data, userId }));

  socket.on('shape:start',  data => bcast('shape:start', { ...data, userId }));
  socket.on('shape:move',   data => socket.broadcast.to(roomId).emit('shape:move', { ...data, userId }));
  socket.on('shape:end',    data => bcast('shape:end', { ...data, userId }));
  socket.on('shape:cancel', data => bcast('shape:cancel', { ...data, userId }));
}

module.exports = { register };
