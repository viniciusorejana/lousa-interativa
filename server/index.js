const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT     = process.env.PORT;
const PASSWORD = process.env.BOARD_PASSWORD;
const UPLOADS  = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

// ─── Socket.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 2e6,
});

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS),
  filename:    (_, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, uuidv4() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    // Alguns browsers mobile enviam mimetype undefined — validar pela extensão também
    const mime = file.mimetype || '';
    const ext  = path.extname(file.originalname || '').toLowerCase();
    const validExt  = ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.svg'].includes(ext);
    const validMime = mime.startsWith('image/') || mime === '';
    if (validMime && (validExt || mime.startsWith('image/'))) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  },
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
const sessions = new Set();
function getToken(req) {
  const c = req.headers.cookie || '';
  const m = c.match(/lb_session=([^;]+)/);
  return m ? m[1] : null;
}
function isAuth(req) { return sessions.has(getToken(req)); }

// ─── Board state ──────────────────────────────────────────────────────────────
let boardState     = { objects: {}, viewport: { x: 0, y: 0, w: 1920, h: 1080 } };
let connectedUsers = {};

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// CORS para /uploads — necessário para crossOrigin: 'anonymous' funcionar
// entre dispositivos na rede (IP público, celular, etc.)
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}, express.static(UPLOADS));
function imgFilename(src) {
  if (!src) return null;
  try {
    const u = new URL(src);
    const base = path.basename(u.pathname);
    if (base) return base;
  } catch (_) {
    if (src.includes('/uploads/')) return path.basename(src);
  }
  return null;
}
function deleteImgFile(src) {
  const filename = imgFilename(src);
  if (!filename) return;
  const filepath = path.join(UPLOADS, filename);
  fs.unlink(filepath, (err) => {
    if (err && err.code !== 'ENOENT') console.warn('[delete]', err.message);
    else if (!err) console.log('[delete] removido:', filename);
  });
}

// ─── Auth routes ──────────────────────────────────────────────────────────────
app.post('/auth', (req, res) => {
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
app.get('/check', (req, res) => {
  isAuth(req) ? res.json({ ok: true }) : res.status(401).json({ ok: false });
});

// ─── Upload ───────────────────────────────────────────────────────────────────
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo' });
  // Sempre retorna path relativo — cada cliente resolve para sua própria origem.
  // Isso garante que localhost e IP público carreguem a mesma imagem corretamente.
  const url = '/uploads/' + req.file.filename;
  console.log(`[upload] ${req.file.originalname} → ${url} (${(req.file.size/1024).toFixed(1)}KB)`);
  res.json({ url });
});

// ─── Páginas ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/board.html', (req, res) => {
  if (!isAuth(req)) return res.redirect('/');
  res.sendFile(path.join(__dirname, '../public/board.html'));
});
app.get('/view', (req, res) => res.sendFile(path.join(__dirname, '../public/view.html')));
app.use(express.static(path.join(__dirname, '../public')));

// ─── Socket.IO handlers ───────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const clientType = socket.handshake.query.type || 'editor';
  const userId     = uuidv4().slice(0, 8);
  const userColor  = `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;

  console.log(`[${new Date().toLocaleTimeString()}] ${clientType} conectado: ${userId}`);

  // Estado inicial (inclui viewport)
  socket.emit('board:init', { state: boardState, userId, userColor });
  if (boardState.zorder && boardState.zorder.length) {
    socket.emit('zorder:sync', boardState.zorder);
  }
  // Envia o viewport atual para novos viewers
  if (boardState.viewport) {
    socket.emit('viewport:sync', boardState.viewport);
  }

  if (clientType === 'editor') {
    connectedUsers[userId] = { id: userId, color: userColor };
    io.emit('users:update', Object.values(connectedUsers));
  }

  socket.on('object:add', (obj) => {
    boardState.objects[obj.id] = { ...obj, ts: Date.now() };
    socket.broadcast.emit('object:add', obj);
  });

  socket.on('object:modify', (data) => {
    boardState.objects[data.id] = { ...data, ts: Date.now() };
    socket.broadcast.emit('object:modify', data);
  });

  socket.on('object:remove', (ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    list.forEach(id => {
      const obj = boardState.objects[id];
      if (obj && obj.type === 'image') deleteImgFile(obj.src);
      delete boardState.objects[id];
    });
    socket.broadcast.emit('object:remove', list);
  });

  socket.on('objects:batch', (objects) => {
    objects.forEach(obj => { boardState.objects[obj.id] = { ...obj, ts: Date.now() }; });
    socket.broadcast.emit('objects:batch', objects);
  });

  socket.on('object:transform', (data) => {
    socket.broadcast.volatile.emit('object:transform', data);
  });

  socket.on('objects:transform', (updates) => {
    socket.broadcast.volatile.emit('objects:transform', updates);
  });

  socket.on('zorder:sync', (order) => {
    boardState.zorder = order;
    socket.broadcast.emit('zorder:sync', order);
  });

  // ── VIEWPORT SYNC ──────────────────────────────────────────────────────────
  // Salva a posição/tamanho do viewport e repassa para todos os clientes
  // (principalmente o view.html / OBS)
  socket.on('viewport:sync', (vp) => {
    boardState.viewport = vp;
    // Repassa para TODOS (inclusive o próprio editor se aberto em outro tab e para o view)
    socket.broadcast.emit('viewport:sync', vp);
  });

  socket.on('draw:start', (data) => socket.broadcast.emit('draw:start', { ...data, userId }));
  socket.on('draw:move',  (data) => socket.broadcast.volatile.emit('draw:move', { ...data, userId }));
  socket.on('draw:end',   (data) => {
    if (data.object) boardState.objects[data.object.id] = data.object;
    socket.broadcast.emit('draw:end', { ...data, userId });
  });

  socket.on('cursor:move', (pos) => {
    socket.broadcast.volatile.emit('cursor:move', { userId, color: userColor, ...pos });
  });

  socket.on('board:clear', () => {
    Object.values(boardState.objects).forEach(obj => {
      if (obj.type === 'image') deleteImgFile(obj.src);
    });
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
  console.log(`║  Editor:   http://localhost:${PORT}         ║`);
  console.log(`║  OBS/View: http://localhost:${PORT}/view    ║`)
  console.log(`╚══════════════════════════════════════════╝\n`);
});
