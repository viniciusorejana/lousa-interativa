const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 50e6,
});

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.BOARD_PASSWORD || 'live123';

// Sessões válidas: Set de tokens gerados no login
const sessions = new Set();

// ─── Board state em memória ───────────────────────────────────────────────────
let boardState = { objects: {} };
let connectedUsers = {};

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));

// Lê o cookie de sessão da requisição
function getSessionToken(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/lb_session=([^;]+)/);
  return match ? match[1] : null;
}

function isAuthenticated(req) {
  return sessions.has(getSessionToken(req));
}

// ─── Rotas de autenticação ────────────────────────────────────────────────────

// Login: recebe senha, devolve cookie de sessão
app.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (password === PASSWORD) {
    const token = uuidv4();
    sessions.add(token);
    res.setHeader('Set-Cookie', `lb_session=${token}; Path=/; HttpOnly; SameSite=Strict`);
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
});

// Check: verifica se a sessão ainda é válida
app.get('/check', (req, res) => {
  if (isAuthenticated(req)) res.json({ ok: true });
  else res.status(401).json({ ok: false });
});

// ─── Rotas de páginas ────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/board.html', (req, res) => {
  if (!isAuthenticated(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../public/board.html'));
});

app.get('/view', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/view.html'));
});

// Arquivos estáticos (socket.io client, fabric, etc.) — sem checar auth
app.use(express.static(path.join(__dirname, '../public')));

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const clientType = socket.handshake.query.type || 'editor';
  const userId = uuidv4().slice(0, 8);
  const userColor = `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;

  console.log(`[${new Date().toLocaleTimeString()}] ${clientType} conectado: ${userId}`);

  socket.emit('board:init', { state: boardState, userId, userColor });

  if (clientType === 'editor') {
    connectedUsers[userId] = { id: userId, color: userColor };
    io.emit('users:update', Object.values(connectedUsers));
  }

  socket.on('object:add', (obj) => {
    boardState.objects[obj.id] = { ...obj, lastModified: Date.now() };
    socket.broadcast.emit('object:add', obj);
  });

  socket.on('object:modify', (data) => {
    // Substitui completamente para não corromper o estado
    boardState.objects[data.id] = { ...data, lastModified: Date.now() };
    socket.broadcast.emit('object:modify', data);
  });

  socket.on('object:remove', (ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    list.forEach(id => delete boardState.objects[id]);
    socket.broadcast.emit('object:remove', list);
  });

  socket.on('objects:batch', (objects) => {
    objects.forEach(obj => {
      boardState.objects[obj.id] = { ...obj, lastModified: Date.now() };
    });
    socket.broadcast.emit('objects:batch', objects);
  });

  socket.on('draw:start', (data) => {
    socket.broadcast.emit('draw:start', { ...data, userId });
  });

  socket.on('draw:move', (data) => {
    socket.broadcast.volatile.emit('draw:move', { ...data, userId });
  });

  socket.on('draw:end', (data) => {
    if (data.object) boardState.objects[data.object.id] = data.object;
    socket.broadcast.emit('draw:end', { ...data, userId });
  });

  socket.on('cursor:move', (pos) => {
    socket.broadcast.volatile.emit('cursor:move', { userId, color: userColor, ...pos });
  });

  socket.on('board:clear', () => {
    boardState.objects = {};
    socket.broadcast.emit('board:clear');
  });

  socket.on('board:sync', (state) => {
    boardState.objects = state.objects || {};
    socket.broadcast.emit('board:sync', state);
  });

  socket.on('disconnect', () => {
    delete connectedUsers[userId];
    io.emit('users:update', Object.values(connectedUsers));
    socket.broadcast.emit('cursor:remove', userId);
    console.log(`[${new Date().toLocaleTimeString()}] ${clientType} desconectado: ${userId}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║         LiveBoard rodando!               ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║  Editor:   http://localhost:${PORT}           ║`);
  console.log(`║  OBS/View: http://localhost:${PORT}/view     ║`);
  console.log(`║  Senha:    ${PASSWORD.padEnd(31)}║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});