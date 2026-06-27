const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);

const PORT     = process.env.PORT;
const PASSWORD = process.env.BOARD_PASSWORD;
const UPLOADS  = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 5e6,
});

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS),
  filename:    (_, file, cb) => { cb(null, uuidv4() + (path.extname(file.originalname) || '.png')); },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const mime = file.mimetype || '';
    const ext  = path.extname(file.originalname || '').toLowerCase();
    const ok   = mime.startsWith('image/') || ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.svg'].includes(ext);
    ok ? cb(null, true) : cb(new Error('Apenas imagens'));
  },
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
const sessions = new Set();
function getToken(req) { const m = (req.headers.cookie||'').match(/lb_session=([^;]+)/); return m?m[1]:null; }
function isAuth(req)   { return sessions.has(getToken(req)); }

// ─── Board state ──────────────────────────────────────────────────────────────
// objects: { id → serialized fabric object }
// layers:  [ { id, name, visible } ]  — ordem = ordem visual (index 0 = fundo)
// undoStack / redoStack: arrays de snapshots do boardState.objects
let boardState = {
  objects:  {},
  layers:   [{ id: 'layer-default', name: 'Camada 1', visible: true }],
  viewport: { x: 0, y: 0, w: 1920, h: 1080 },
};
let undoStack = [];   // array de { objects, layers }
let redoStack = [];
const MAX_HISTORY = 30;
let connectedUsers = {};

function snapState() {
  return {
    objects: JSON.parse(JSON.stringify(boardState.objects)),
    layers:  JSON.parse(JSON.stringify(boardState.layers)),
  };
}
function pushUndo() {
  undoStack.push(snapState());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}, express.static(UPLOADS));

function imgFilename(src) {
  if (!src) return null;
  try { return path.basename(new URL(src).pathname); } catch(_) {}
  if (src.includes('/uploads/')) return path.basename(src);
  return null;
}
function deleteImgFile(src) {
  const f = imgFilename(src);
  if (f) fs.unlink(path.join(UPLOADS, f), ()=>{});
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.post('/auth', (req, res) => {
  if ((req.body||{}).password === PASSWORD) {
    const t = uuidv4();
    sessions.add(t);
    res.setHeader('Set-Cookie', `lb_session=${t}; Path=/; HttpOnly; SameSite=Strict`);
    res.json({ ok: true });
  } else res.status(401).json({ ok: false });
});
app.get('/check', (req, res) => isAuth(req) ? res.json({ok:true}) : res.status(401).json({ok:false}));

app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo' });
  res.json({ url: '/uploads/' + req.file.filename });
});

app.get('/',          (req,res) => res.sendFile(path.join(__dirname,'../public/index.html')));
app.get('/board.html',(req,res) => isAuth(req) ? res.sendFile(path.join(__dirname,'../public/board.html')) : res.redirect('/'));
app.get('/view',      (req,res) => res.sendFile(path.join(__dirname,'../public/view.html')));
app.use(express.static(path.join(__dirname,'../public')));

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  const clientType = socket.handshake.query.type || 'editor';
  const userId     = uuidv4().slice(0, 8);
  const userColor  = `hsl(${Math.floor(Math.random()*360)},70%,60%)`;
  console.log(`[${new Date().toLocaleTimeString()}] ${clientType} +${userId}`);

  socket.emit('board:init', { state: boardState, userId, userColor,
    canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });

  if (clientType === 'editor') {
    connectedUsers[userId] = { id: userId, color: userColor };
    io.emit('users:update', Object.values(connectedUsers));
  }

  // ── Objects ────────────────────────────────────────────────────────────────
  socket.on('object:add', obj => {
    pushUndo();
    boardState.objects[obj.id] = { ...obj, ts: Date.now() };
    socket.broadcast.emit('object:add', obj);
    io.emit('history:update', { canUndo: true, canRedo: false });
  });

  socket.on('object:modify', data => {
    // visibility changes need special save to persist, but no undo push for live transforms
    if (data._visibilityChange) {
      boardState.objects[data.id] = { ...boardState.objects[data.id], ...data };
      socket.broadcast.emit('object:modify', data);
      return;
    }
    boardState.objects[data.id] = { ...data, ts: Date.now() };
    socket.broadcast.emit('object:modify', data);
  });

  socket.on('object:modify:commit', data => {
    // Called after drag/resize ends — push undo
    pushUndo();
    boardState.objects[data.id] = { ...data, ts: Date.now() };
    socket.broadcast.emit('object:modify', data);
    io.emit('history:update', { canUndo: true, canRedo: false });
  });

  socket.on('object:remove', ids => {
    pushUndo();
    const list = Array.isArray(ids) ? ids : [ids];
    list.forEach(id => {
      const obj = boardState.objects[id];
      if (obj?.type === 'image') deleteImgFile(obj.src);
      delete boardState.objects[id];
    });
    socket.broadcast.emit('object:remove', list);
    io.emit('history:update', { canUndo: true, canRedo: false });
  });

  socket.on('objects:batch', objects => {
    pushUndo();
    objects.forEach(obj => { boardState.objects[obj.id] = { ...obj, ts: Date.now() }; });
    socket.broadcast.emit('objects:batch', objects);
    io.emit('history:update', { canUndo: true, canRedo: false });
  });

  socket.on('object:transform', data => {
    // Live transform — no undo push, just update state quietly
    if (boardState.objects[data.id]) {
      boardState.objects[data.id] = { ...boardState.objects[data.id], ...data };
    }
    socket.broadcast.volatile.emit('object:transform', data);
  });

  socket.on('objects:transform', updates => {
    updates.forEach(d => {
      if (boardState.objects[d.id]) boardState.objects[d.id] = { ...boardState.objects[d.id], ...d };
    });
    socket.broadcast.volatile.emit('objects:transform', updates);
  });

  socket.on('zorder:sync', order => {
    boardState.zorder = order;
    socket.broadcast.emit('zorder:sync', order);
  });

  // ── Layers ────────────────────────────────────────────────────────────────
  socket.on('layers:update', layers => {
    boardState.layers = layers;
    socket.broadcast.emit('layers:update', layers);
  });

  // layer visibility → must also propagate opacity change to all objects in that layer
  socket.on('layer:visibility', ({ layerId, visible }) => {
    const layer = boardState.layers.find(l => l.id === layerId);
    if (layer) layer.visible = visible;
    // Update all objects belonging to this layer
    Object.values(boardState.objects).forEach(obj => {
      if (obj.layerId === layerId) {
        obj._layerHidden = !visible;
      }
    });
    io.emit('layer:visibility', { layerId, visible });
  });

  // ── Undo / Redo (collaborative — server owns history) ─────────────────────
  socket.on('history:undo', () => {
    if (!undoStack.length) return;
    redoStack.push(snapState());
    const prev = undoStack.pop();
    boardState.objects = prev.objects;
    boardState.layers  = prev.layers || boardState.layers;
    io.emit('board:sync', boardState);
    io.emit('history:update', { canUndo: undoStack.length > 0, canRedo: true });
  });

  socket.on('history:redo', () => {
    if (!redoStack.length) return;
    undoStack.push(snapState());
    const next = redoStack.pop();
    boardState.objects = next.objects;
    boardState.layers  = next.layers || boardState.layers;
    io.emit('board:sync', boardState);
    io.emit('history:update', { canUndo: true, canRedo: redoStack.length > 0 });
  });

  // ── Draw streaming ────────────────────────────────────────────────────────
  socket.on('draw:start', data => socket.broadcast.emit('draw:start', { ...data, userId }));
  socket.on('draw:move',  data => socket.broadcast.volatile.emit('draw:move', { ...data, userId }));
  socket.on('draw:end',   data => {
    if (data.object) {
      pushUndo();
      boardState.objects[data.object.id] = data.object;
      io.emit('history:update', { canUndo: true, canRedo: false });
    }
    socket.broadcast.emit('draw:end', { ...data, userId });
  });

  // ── Cursor (board coordinates) ────────────────────────────────────────────
  socket.on('cursor:move', pos => {
    socket.broadcast.volatile.emit('cursor:move', { userId, color: userColor, ...pos });
  });

  // ── Viewport ──────────────────────────────────────────────────────────────
  socket.on('viewport:sync', vp => {
    boardState.viewport = vp;
    socket.broadcast.emit('viewport:sync', vp);
  });

  // ── Board level ───────────────────────────────────────────────────────────
  socket.on('board:clear', () => {
    pushUndo();
    Object.values(boardState.objects).forEach(obj => { if (obj.type==='image') deleteImgFile(obj.src); });
    boardState.objects = {};
    io.emit('board:clear');
    io.emit('history:update', { canUndo: true, canRedo: false });
  });

  socket.on('disconnect', () => {
    delete connectedUsers[userId];
    io.emit('users:update', Object.values(connectedUsers));
    socket.broadcast.emit('cursor:remove', userId);
    console.log(`[${new Date().toLocaleTimeString()}] ${clientType} -${userId}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nLiveBoard rodando na porta ${PORT}\n`);
});
