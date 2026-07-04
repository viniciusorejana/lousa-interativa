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
const DATA_DIR = path.join(__dirname, '../data/rooms');
[UPLOADS, DATA_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ─── Limpeza no startup ───────────────────────────────────────────────────────
// Apaga todos os dados de rooms e uploads ao iniciar.
// Garante estado limpo em cada inicialização — imagens são tratadas como
// dados voláteis de sessão, não persistentes entre reinicializações.
function cleanOnStartup() {
  let files = 0;
  for (const dir of [UPLOADS, DATA_DIR]) {
    try {
      for (const f of fs.readdirSync(dir)) {
        fs.unlinkSync(path.join(dir, f));
        files++;
      }
    } catch (_) {}
  }
  if (files > 0) console.log(`[startup] ${files} arquivo(s) removido(s) (uploads + rooms)`);
}
cleanOnStartup();

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
  filename:    (_, file, cb) => cb(null, uuidv4() + (path.extname(file.originalname) || '.png')),
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

// ─── Slugify: converte nome de sala para ID seguro para URL e arquivo ─────────
// "Lousa 1" → "lousa-1", "Minha Lousa!" → "minha-lousa"
function slugify(name) {
  return (name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')  // só letras, números, espaços e hífens
    .replace(/\s+/g, '-')          // espaços → hífens
    .replace(/-+/g, '-')           // hífens duplos → simples
    .replace(/^-|-$/g, '')         // remove hífens no início/fim
    || 'sala';
}

// ─── Persistência em arquivo JSON ─────────────────────────────────────────────
const MAX_HISTORY    = 30;
const EVICT_MS       = 30 * 60 * 1000;   // 30 minutos
const SAVE_DEBOUNCE  = 2000;             // salva 2s após última alteração

function roomFile(roomId) {
  return path.join(DATA_DIR, roomId + '.json');
}

function loadRoomFromDisk(roomId) {
  try {
    const raw = fs.readFileSync(roomFile(roomId), 'utf8');
    const data = JSON.parse(raw);
    console.log(`[room] Carregado do disco: ${roomId}`);
    return data;
  } catch (_) {
    return null;  // sala nova ou arquivo corrompido
  }
}

function defaultRoomState() {
  return {
    objects:  {},
    layers:   [{ id: 'layer-default', name: 'Camada 1', visible: true }],
    viewport: { x: 0, y: 0, w: 1920, h: 1080 },
  };
}

// ─── Registro de salas em memória ─────────────────────────────────────────────
// rooms[roomId] = { state, userHistory, users, saveTimer, lastEmpty }
const rooms = {};

function getRoom(roomId) {
  if (rooms[roomId]) return rooms[roomId];

  // Tenta carregar do disco; se não existe, cria nova
  const saved = loadRoomFromDisk(roomId);
  rooms[roomId] = {
    state:       saved ? saved.state : defaultRoomState(),
    userHistory: {},    // userId → { undoStack: [...], redoStack: [...] } — não persiste no disco (é por sessão)
    users:       {},    // userId → { id, name, color }
    saveTimer:   null,
    lastEmpty:   null,  // timestamp em que a sala ficou vazia (para eviction)
  };
  console.log(`[room] Na memória: ${roomId} (${saved ? 'restaurado' : 'novo'})`);
  return rooms[roomId];
}

// Salva uma sala no disco de forma debounced (2s após última alteração)
function scheduleSave(roomId) {
  const room = rooms[roomId]; if (!room) return;
  clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(() => {
    const payload = JSON.stringify({
      state: room.state,   // histórico de undo/redo é por sessão, não persiste no disco
    });
    fs.writeFile(roomFile(roomId), payload, err => {
      if (err) console.error(`[room] Erro ao salvar ${roomId}:`, err.message);
    });
  }, SAVE_DEBOUNCE);
}

// ─── Eviction: remove salas vazias há mais de 30 minutos ─────────────────────
// Apaga da RAM, do disco (JSON) e todos uploads referenciados pela sala.
// Economiza disco em ambientes com SSD limitado.
setInterval(() => {
  const now = Date.now();
  for (const roomId of Object.keys(rooms)) {
    const room = rooms[roomId];
    if (Object.keys(room.users).length > 0) continue;  // sala ainda tem usuários
    if (!room.lastEmpty)                   continue;    // nunca ficou vazia
    if (now - room.lastEmpty < EVICT_MS)   continue;    // ainda no prazo

    clearTimeout(room.saveTimer);

    // Coleta uploads referenciados por imagens desta sala
    const imgFiles = [];
    for (const obj of Object.values(room.state.objects)) {
      if (obj.type === 'image' && obj.src) {
        const filename = imgFilename(obj.src);
        if (filename) imgFiles.push(filename);
      }
    }

    // Apaga JSON da sala e uploads (async, sem bloquear)
    fs.unlink(roomFile(roomId), () => {});
    for (const filename of imgFiles) {
      fs.unlink(path.join(UPLOADS, filename), () => {});
    }

    delete rooms[roomId];

    const mins = Math.round((now - room.lastEmpty) / 60000);
    console.log(`[room] Evicted: ${roomId} — ${mins}min inativa, ${imgFiles.length} upload(s) removido(s)`);
  }
}, 60 * 1000);  // checa a cada 1 minuto

// ─── Helpers de história por sala (undo/redo por usuário) ────────────────────
// Cada usuário tem sua própria pilha de undo/redo (room.userHistory[userId]).
// Cada entrada é um PATCH (não um snapshot completo): guarda o valor "antes" e
// "depois" apenas dos objetos/zorder/layers realmente afetados pela ação.
// Isso permite que o Ctrl+Z de um usuário desfaça só a própria última ação,
// mesmo que outros usuários tenham feito coisas depois.
function pushUserAction(room, userId, patch) {
  if (!room.userHistory) room.userHistory = {};
  if (!room.userHistory[userId]) room.userHistory[userId] = { undoStack: [], redoStack: [] };
  const uh = room.userHistory[userId];
  uh.undoStack.push({
    id: uuidv4(), ts: Date.now(),
    objectsBefore: patch.objectsBefore || null,
    objectsAfter:  patch.objectsAfter  || null,
    layersBefore:  patch.layersBefore  || null,
    layersAfter:   patch.layersAfter   || null,
    zorderBefore:  patch.zorderBefore  || null,
    zorderAfter:   patch.zorderAfter   || null,
  });
  if (uh.undoStack.length > MAX_HISTORY) uh.undoStack.shift();
  uh.redoStack = []; // nova ação invalida qualquer redo pendente deste usuário
}

// Aplica um patch (before ou after) no estado da sala.
// Verifica conflito: só sobrescreve um objeto se o valor atual ainda bate com
// o que a ação esperava encontrar (ninguém mexeu nele depois). Isso evita que
// um undo/redo tardio apague a edição mais recente de outra pessoa.
function applyActionPatch(room, action, direction) {
  const objMap    = direction === 'before' ? action.objectsBefore : action.objectsAfter;
  const expectMap = direction === 'before' ? action.objectsAfter  : action.objectsBefore;
  let conflicts = 0;
  if (objMap) {
    Object.entries(objMap).forEach(([id, targetVal]) => {
      const expected = expectMap ? (expectMap[id] ?? null) : undefined;
      const current  = room.state.objects[id] || null;
      if (expected !== undefined && JSON.stringify(current) !== JSON.stringify(expected)) {
        conflicts++; return; // outro usuário alterou este objeto depois — não sobrescreve
      }
      if (targetVal === null) delete room.state.objects[id];
      else room.state.objects[id] = targetVal;
    });
  }
  const layers = direction === 'before' ? action.layersBefore : action.layersAfter;
  if (layers) room.state.layers = layers;
  const zorder = direction === 'before' ? action.zorderBefore : action.zorderAfter;
  if (zorder) room.state.zorder = zorder;
  return conflicts;
}

function historyFlagsFor(room, userId) {
  const uh = (room.userHistory || {})[userId];
  return { canUndo: !!(uh && uh.undoStack.length), canRedo: !!(uh && uh.redoStack.length) };
}

// Envia canUndo/canRedo PERSONALIZADOS para cada socket conectado na sala —
// cada usuário só pode desfazer/refazer as próprias ações, então o estado do
// botão precisa ser individual, não compartilhado.
function broadcastHistoryFlags(io, roomId, room) {
  const socketsInRoom = io.sockets.adapter.rooms.get(roomId);
  if (!socketsInRoom) return;
  socketsInRoom.forEach(socketId => {
    const s = io.sockets.sockets.get(socketId);
    if (!s || !s._lbUserId) return;
    s.emit('history:update', historyFlagsFor(room, s._lbUserId));
  });
}

// ─── Helpers de imagem ────────────────────────────────────────────────────────
function imgFilename(src) {
  if (!src) return null;
  try { return path.basename(new URL(src).pathname); } catch(_) {}
  if (src.includes('/uploads/')) return path.basename(src);
  return null;
}
function deleteImgFile(src) {
  const f = imgFilename(src);
  if (f) fs.unlink(path.join(UPLOADS, f), () => {});
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}, express.static(UPLOADS));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.post('/auth', (req, res) => {
  if ((req.body||{}).password === PASSWORD) {
    const t = uuidv4();
    sessions.add(t);
    res.setHeader('Set-Cookie', `lb_session=${t}; Path=/; HttpOnly; SameSite=Strict`);
    res.json({ ok: true });
  } else res.status(401).json({ ok: false });
});
app.get('/check', (req, res) => isAuth(req) ? res.json({ ok: true }) : res.status(401).json({ ok: false }));

app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// Proxy de imagens externas — evita problemas de CORS ao arrastar/colar imagens da internet
app.get('/api/img-proxy', (req, res) => {
  if (!isAuth(req)) return res.status(401).send('Não autenticado');
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).send('URL inválida');
  try {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? require('https') : require('http');
    const request = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      if (r.statusCode >= 400) return res.status(r.statusCode).send('Erro ao buscar imagem');
      res.setHeader('Content-Type', r.headers['content-type'] || 'image/png');
      res.setHeader('Access-Control-Allow-Origin', '*');
      r.pipe(res);
    });
    request.on('error', err => res.status(500).send('Proxy error: ' + err.message));
    request.setTimeout(10000, () => { request.destroy(); res.status(504).send('Timeout'); });
  } catch (err) {
    res.status(500).send('Proxy error: ' + err.message);
  }
});

// API: lista salas ativas (para UI de escolha de sala)
app.get('/api/rooms', (req, res) => {
  // Salas em RAM
  const inMemory = Object.entries(rooms).map(([id, r]) => ({
    id,
    users: Object.keys(r.users).length,
    active: Object.keys(r.users).length > 0,
  }));
  // Salas salvas em disco mas fora da RAM
  const onDisk = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .filter(id => !rooms[id])
    .map(id => ({ id, users: 0, active: false }));
  res.json([...inMemory, ...onDisk]);
});

// Slug preview: retorna o slug que será usado para um nome
app.get('/api/slug', (req, res) => {
  res.json({ slug: slugify(req.query.name || '') });
});

// Páginas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/board.html', (req, res) =>
  isAuth(req) ? res.sendFile(path.join(__dirname, '../public/board.html')) : res.redirect('/'));
app.get('/view',          (req, res) => res.sendFile(path.join(__dirname, '../public/view.html')));
app.get('/view/:roomId',  (req, res) => res.sendFile(path.join(__dirname, '../public/view.html')));
app.use(express.static(path.join(__dirname, '../public')));

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  const clientType = socket.handshake.query.type || 'editor';
  const userId     = uuidv4().slice(0, 8);
  const userName   = (socket.handshake.query.userName || '').trim().slice(0, 24) || `Usuário ${userId.slice(0,4)}`;
  const userColor  = `hsl(${Math.floor(Math.random()*360)},70%,60%)`;
  const rawRoom    = (socket.handshake.query.roomId || 'default').trim();
  const roomId     = slugify(rawRoom) || 'default';

  const room = getRoom(roomId);
  socket.join(roomId);  // Socket.IO room para broadcast isolado
  socket._lbUserId = userId; // usado por broadcastHistoryFlags para achar o socket de cada usuário

  console.log(`[${new Date().toLocaleTimeString()}] ${clientType} +${userName} → [${roomId}]`);

  socket.emit('board:init', {
    state:    room.state,
    zorder:   room.state.zorder || [],
    roomId,
    userId,
    userName,
    userColor,
    ...historyFlagsFor(room, userId), // sempre {canUndo:false, canRedo:false} numa conexão nova
  });

  if (clientType === 'editor') {
    room.users[userId] = { id: userId, name: userName, color: userColor };
    room.lastEmpty = null;  // sala tem usuário — cancela eviction
    io.to(roomId).emit('users:update', Object.values(room.users));
  }

  // Helper: broadcast para a sala exceto o remetente
  const bcast  = (ev, data) => socket.broadcast.to(roomId).emit(ev, data);
  // Helper: emit para todos na sala (inclusive remetente)
  const toRoom = (ev, data) => io.to(roomId).emit(ev, data);

  // ── Objects ────────────────────────────────────────────────────────────────
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

  // Operação atômica: adiciona grupo, remove filhos, atualiza zorder — 1 única ação
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

  // Operação atômica: remove grupo, adiciona filhos, atualiza zorder — 1 única ação
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

  // ── Layers ────────────────────────────────────────────────────────────────
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

  // ── Undo / Redo (por usuário) ────────────────────────────────────────────────
  socket.on('history:undo', () => {
    const uh = (room.userHistory || {})[userId];
    if (!uh || !uh.undoStack.length) return;
    const action = uh.undoStack.pop();
    const conflicts = applyActionPatch(room, action, 'before');
    uh.redoStack.push(action);
    toRoom('board:sync', room.state);
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
    if (conflicts) socket.emit('history:conflict', { count: conflicts, action: 'undo' });
  });

  socket.on('history:redo', () => {
    const uh = (room.userHistory || {})[userId];
    if (!uh || !uh.redoStack.length) return;
    const action = uh.redoStack.pop();
    const conflicts = applyActionPatch(room, action, 'after');
    uh.undoStack.push(action);
    toRoom('board:sync', room.state);
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
    if (conflicts) socket.emit('history:conflict', { count: conflicts, action: 'redo' });
  });

  // ── Draw streaming (caneta livre) ────────────────────────────────────────────
  socket.on('draw:start', data => bcast('draw:start', { ...data, userId }));
  socket.on('draw:move',  data => socket.broadcast.to(roomId).emit('draw:move', { ...data, userId }));
  socket.on('draw:end',   data => {
    if (data.object) {
      const before = { [data.object.id]: room.state.objects[data.object.id] || null };
      room.state.objects[data.object.id] = data.object;
      const after = { [data.object.id]: room.state.objects[data.object.id] };
      pushUserAction(room, userId, { objectsBefore: before, objectsAfter: after });
      broadcastHistoryFlags(io, roomId, room);
      scheduleSave(roomId);
    }
    bcast('draw:end', { ...data, userId });
  });

  // ── Shape streaming (retângulo, elipse, linha, seta em tempo real) ───────────
  // Mesmo padrão do draw:start/move/end: eventos efêmeros (sem persistência,
  // sem undo) que só existem enquanto a forma está sendo arrastada. A forma
  // real e definitiva chega via 'object:add' normal (emitFull no cliente).
  socket.on('shape:start', data => bcast('shape:start', { ...data, userId }));
  socket.on('shape:move',  data => socket.broadcast.to(roomId).emit('shape:move', { ...data, userId }));
  socket.on('shape:end',   data => bcast('shape:end', { ...data, userId }));
  socket.on('shape:cancel', data => bcast('shape:cancel', { ...data, userId }));

  // ── Cursor ────────────────────────────────────────────────────────────────
  socket.on('cursor:move', pos => {
    socket.broadcast.to(roomId).volatile.emit('cursor:move', { userId, userName, color: userColor, ...pos });
  });

  // ── Viewport ──────────────────────────────────────────────────────────────
  socket.on('viewport:sync', vp => {
    room.state.viewport = vp;
    bcast('viewport:sync', vp);
    scheduleSave(roomId);
  });

  // ── Board clear ───────────────────────────────────────────────────────────
  socket.on('board:clear', () => {
    const before = {};
    Object.entries(room.state.objects).forEach(([id, obj]) => { before[id] = obj; });
    const after = {};
    Object.keys(room.state.objects).forEach(id => { after[id] = null; });
    const zorderBefore = (room.state.zorder || []).slice();
    room.state.objects = {};
    room.state.zorder  = [];
    pushUserAction(room, userId, { objectsBefore: before, objectsAfter: after, zorderBefore, zorderAfter: [] });
    toRoom('board:clear');
    broadcastHistoryFlags(io, roomId, room);
    scheduleSave(roomId);
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    delete room.users[userId];
    // userId é gerado por conexão — ao desconectar, o histórico deste usuário
    // fica inalcançável mesmo se reconectar (novo userId). Libera a memória.
    if (room.userHistory) delete room.userHistory[userId];
    toRoom('users:update', Object.values(room.users));
    bcast('cursor:remove', userId);
    // Se a sala ficou vazia, marca o timestamp para eviction
    if (Object.keys(room.users).length === 0) {
      room.lastEmpty = Date.now();
      // Não salvamos mais em disco ao ficar vazia — o eviction apaga tudo após 30min
      console.log(`[room] Vazia: ${roomId} — será apagada em 30min se ninguém entrar`);
    }
    console.log(`[${new Date().toLocaleTimeString()}] ${clientType} -${userName} ← [${roomId}]`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nLiveBoard rodando na porta ${PORT}`);
  console.log(`Dados das salas: ${DATA_DIR}\n`);
});