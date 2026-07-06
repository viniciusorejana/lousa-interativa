// ── Conexão socket.io compartilhada entre board.html e view.html ─────────────
// Centraliza o único ponto de configuração de transporte (hoje: só websocket,
// sem fallback pra polling) — se isso precisar mudar no futuro (ex: atrás de
// um proxy que só libera polling), muda aqui uma vez só, pros dois clientes.
//
// Script clássico (não ES module) pelo mesmo motivo do fabric-image-patch.js:
// o restante do código de board.html/view.html ainda é um script clássico
// grande que espera `socket` como variável global no mesmo escopo — isso
// muda quando a Fase 3+ modularizar o resto do client.
window.LB = window.LB || {};
window.LB.createSocket = function createSocket(query) {
  return io({ query, transports: ['websocket'] });
};
