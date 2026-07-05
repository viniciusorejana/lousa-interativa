const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const sharp    = require('sharp');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);

const PORT     = process.env.PORT;
const PASSWORD = process.env.BOARD_PASSWORD;
const UPLOADS  = path.join(__dirname, '../uploads');
const DATA_DIR = path.join(__dirname, '../data/rooms');
[UPLOADS, DATA_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ─── Configuração de armazenamento de uploads ─────────────────────────────────
// Imagens estáticas (jpg/png/webp/bmp) são recomprimidas pra WebP no upload —
// costuma cortar 70-90% do peso de uma foto normal sem perda visível. GIFs e
// SVGs NÃO passam por essa recompressão (GIF perderia a animação; SVG
// perderia a escalabilidade vetorial virando raster), então têm um teto de
// tamanho mais restrito, já que não há como reduzir o peso deles aqui.
const MAX_IMAGE_DIMENSION = 2400;              // maior lado, em px, após redimensionar
const WEBP_QUALITY        = 84;                // 0-100, 84 é visualmente ~idêntico ao original
const GIF_MAX_SIZE        = 8 * 1024 * 1024;   // 8MB — GIF não é recomprimido, teto mais rígido
const UPLOADS_MAX_MB      = parseInt(process.env.UPLOADS_MAX_MB || '2048', 10); // teto de /uploads (2GB por padrão)
const UPLOAD_SWEEP_INTERVAL = 5  * 60 * 1000;  // varredura de órfãos a cada 5min
const UPLOAD_GRACE_MS       = 10 * 60 * 1000;  // nunca apaga upload com menos de 10min (evita corrida com upload recém-chegado)
const STORAGE_LOG_INTERVAL  = 15 * 60 * 1000;  // log periódico de uso de disco a cada 15min

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
    // clientId (persistente por navegador, não por conexão) → posição da área
    // reservada de spawn desse cliente. Só existe uma entrada aqui depois que
    // a pessoa move a área pelo menos uma vez (ver 'staging:sync' abaixo) —
    // não sincroniza em tempo real, só quando a posição é confirmada.
    stagingAreas: {},
  };
}

// ─── Registro de salas em memória ─────────────────────────────────────────────
// rooms[roomId] = { state, userHistory, users, saveTimer, lastEmpty }
const rooms = {};

function getRoom(roomId) {
  if (rooms[roomId]) return rooms[roomId];

  // Tenta carregar do disco; se não existe, cria nova
  const saved = loadRoomFromDisk(roomId);
  const state = saved ? saved.state : defaultRoomState();
  if (!state.stagingAreas) state.stagingAreas = {}; // salas salvas antes dessa feature
  rooms[roomId] = {
    state,
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

    // Coleta uploads referenciados por imagens desta sala (recursivo — cobre
    // também imagens aninhadas dentro de grupos, ver collectImageFilenames).
    const imgFilesSet = new Set();
    for (const obj of Object.values(room.state.objects)) {
      collectImageFilenames(obj, imgFilesSet);
    }

    // Apaga JSON da sala e uploads (async, sem bloquear)
    fs.unlink(roomFile(roomId), () => {});
    for (const filename of imgFilesSet) {
      fs.unlink(path.join(UPLOADS, filename), () => {});
    }

    delete rooms[roomId];

    const mins = Math.round((now - room.lastEmpty) / 60000);
    console.log(`[room] Evicted: ${roomId} — ${mins}min inativa, ${imgFilesSet.size} upload(s) removido(s)`);
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

// Coleta recursivamente nomes de arquivo de imagem referenciados por um
// objeto — inclusive dentro de grupos. Grupos guardam os filhos serializados
// DENTRO de si mesmos (obj.objects[]), não como entradas separadas em
// room.state.objects, então uma imagem dentro de um grupo só é encontrada
// recursando aqui — sem isso, ela pareceria "não referenciada" e seria
// apagada por engano enquanto ainda está visível dentro do grupo.
function collectImageFilenames(obj, set) {
  if (!obj) return;
  const f1 = imgFilename(obj.src);
  if (f1) set.add(f1);
  const f2 = imgFilename(obj._gifUrl);
  if (f2) set.add(f2);
  if (obj.type === 'group' && Array.isArray(obj.objects)) {
    obj.objects.forEach(child => collectImageFilenames(child, set));
  }
}

// Todos os nomes de arquivo de imagem/gif atualmente referenciados por
// QUALQUER sala conhecida — no estado atual, em qualquer pilha de undo/redo
// de qualquer usuário conectado (pra não apagar algo que um "Ctrl+Z" ainda
// pode trazer de volta), e em salas salvas em disco mas fora da RAM no
// momento (não deveria acontecer durante uma mesma execução do servidor,
// já que o eviction apaga os dois juntos — mas checamos por segurança).
function collectReferencedFilenames() {
  const referenced = new Set();

  for (const room of Object.values(rooms)) {
    for (const obj of Object.values(room.state.objects || {})) {
      collectImageFilenames(obj, referenced);
    }
    for (const uh of Object.values(room.userHistory || {})) {
      for (const action of [...(uh.undoStack || []), ...(uh.redoStack || [])]) {
        for (const map of [action.objectsBefore, action.objectsAfter]) {
          if (!map) continue;
          for (const val of Object.values(map)) collectImageFilenames(val, referenced);
        }
      }
    }
  }

  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (!f.endsWith('.json')) continue;
      const roomId = f.replace('.json', '');
      if (rooms[roomId]) continue; // já contado acima
      try {
        const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
        for (const obj of Object.values((data.state || {}).objects || {})) {
          collectImageFilenames(obj, referenced);
        }
      } catch (_) {}
    }
  } catch (_) {}

  return referenced;
}

// Estatísticas de uso da pasta de uploads — usado no log periódico, no teto
// de segurança do /upload e no endpoint /api/storage.
function getUploadsStats() {
  let totalBytes = 0, fileCount = 0;
  try {
    for (const f of fs.readdirSync(UPLOADS)) {
      try {
        const stat = fs.statSync(path.join(UPLOADS, f));
        totalBytes += stat.size;
        fileCount++;
      } catch (_) {}
    }
  } catch (_) {}
  return { fileCount, totalBytes, totalMB: +(totalBytes / 1024 / 1024).toFixed(1) };
}

// Varredura periódica de uploads órfãos: um arquivo é órfão quando não está
// em collectReferencedFilenames() — ou seja, não é referenciado por NENHUMA
// sala conhecida, nem no estado atual, nem em nenhuma pilha de undo/redo.
//
// Não usamos "tempo desde o último uso" como critério de segurança (isso
// arriscaria apagar uma imagem parada mas visível na tela — ex: uma logo que
// fica horas sem ser tocada mas continua sendo exibida). O critério real é
// referência: existe em algum lugar ou não. O tempo (UPLOAD_GRACE_MS) entra
// só como uma folga de segurança pra uploads recém-chegados que ainda não
// foram sincronizados no estado da sala (uma corrida de milissegundos, não
// minutos) — nunca apagamos algo com menos de 10min de vida.
function sweepOrphanedUploads() {
  let referenced;
  try { referenced = collectReferencedFilenames(); }
  catch (err) { console.error('[uploads] Erro ao coletar referências:', err.message); return; }

  let files;
  try { files = fs.readdirSync(UPLOADS); } catch (_) { return; }

  const now = Date.now();
  let removed = 0, freedBytes = 0;

  for (const filename of files) {
    if (referenced.has(filename)) continue;
    const filePath = path.join(UPLOADS, filename);
    let stat;
    try { stat = fs.statSync(filePath); } catch (_) { continue; }
    if (now - stat.mtimeMs < UPLOAD_GRACE_MS) continue;
    try {
      fs.unlinkSync(filePath);
      removed++;
      freedBytes += stat.size;
    } catch (_) {}
  }

  if (removed > 0) {
    console.log(`[uploads] Varredura de órfãos: ${removed} arquivo(s) removido(s), ${(freedBytes / 1024 / 1024).toFixed(1)}MB liberados`);
  }
}
setInterval(sweepOrphanedUploads, UPLOAD_SWEEP_INTERVAL);

// Log periódico de uso de disco — visibilidade simples sem precisar de SSH
// durante uma live pra saber se o armazenamento está sob controle.
setInterval(() => {
  const stats = getUploadsStats();
  console.log(`[uploads] Uso atual: ${stats.fileCount} arquivo(s), ${stats.totalMB}MB / ${UPLOADS_MAX_MB}MB`);
}, STORAGE_LOG_INTERVAL);

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

app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo' });

  const cleanupTemp = () => fs.unlink(req.file.path, () => {});

  // Teto de segurança: nunca deixa a pasta de uploads crescer sem limite.
  // Roda uma varredura de órfãos primeiro — se o "excesso" for só lixo
  // acumulado, isso já libera espaço e evita recusar um upload legítimo.
  sweepOrphanedUploads();
  const stats = getUploadsStats();
  if (stats.totalMB >= UPLOADS_MAX_MB) {
    cleanupTemp();
    return res.status(507).json({
      error: `Armazenamento cheio (${stats.totalMB}MB / ${UPLOADS_MAX_MB}MB). Apague algumas imagens/gifs antigas do board pra liberar espaço.`
    });
  }

  const ext = path.extname(req.file.filename).toLowerCase();

  // GIF não é recomprimido (perderia a animação) — só um teto de tamanho
  // mais restrito, já que não há como reduzir o peso dele aqui.
  if (ext === '.gif') {
    if (req.file.size > GIF_MAX_SIZE) {
      cleanupTemp();
      return res.status(413).json({ error: `GIF muito grande (máx. ${GIF_MAX_SIZE / 1024 / 1024}MB).` });
    }
    return res.json({ url: '/uploads/' + req.file.filename });
  }

  // SVG também não é recomprimido: rasterizar um SVG faria ele perder a
  // escalabilidade vetorial, e SVGs já costumam ser pequenos (baseados em
  // texto) — não há ganho real em processar.
  if (ext === '.svg') {
    return res.json({ url: '/uploads/' + req.file.filename });
  }

  // Demais formatos (jpg/png/webp/bmp): redimensiona (se maior que o teto) e
  // recomprime pra WebP. Costuma cortar 70-90% do peso de uma foto normal
  // sem perda visível.
  try {
    const outputFilename = uuidv4() + '.webp';
    const outputPath = path.join(UPLOADS, outputFilename);

    await sharp(req.file.path)
      .rotate() // aplica a orientação EXIF antes de descartar os metadados
      .resize({
        width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION,
        fit: 'inside', withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toFile(outputPath);

    cleanupTemp(); // remove o arquivo original (pré-compressão)
    res.json({ url: '/uploads/' + outputFilename });
  } catch (err) {
    console.error('[upload] Erro ao comprimir imagem, entregando original:', err.message);
    // Fallback: se a compressão falhar por algum motivo (arquivo corrompido,
    // formato inesperado, etc.), ainda entrega o arquivo original em vez de
    // quebrar o upload do usuário.
    res.json({ url: '/uploads/' + req.file.filename });
  }
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

// API: visão geral de uso de armazenamento (uploads + salas) — pra
// acompanhar sem precisar de SSH durante uma live.
app.get('/api/storage', (req, res) => {
  if (!isAuth(req)) return res.status(401).json({ error: 'Não autenticado' });

  const uploads = getUploadsStats();

  const roomsInfo = Object.entries(rooms).map(([id, r]) => {
    let imgCount = 0;
    for (const obj of Object.values(r.state.objects || {})) {
      const set = new Set();
      collectImageFilenames(obj, set);
      imgCount += set.size;
    }
    return {
      id,
      users:   Object.keys(r.users).length,
      objects: Object.keys(r.state.objects || {}).length,
      images:  imgCount,
    };
  });

  res.json({
    uploads: {
      fileCount:    uploads.fileCount,
      totalMB:      uploads.totalMB,
      limitMB:      UPLOADS_MAX_MB,
      percentUsed:  +((uploads.totalMB / UPLOADS_MAX_MB) * 100).toFixed(1),
    },
    rooms: roomsInfo,
  });
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
  // Identificador persistente POR NAVEGADOR (não por conexão — sobrevive a
  // reconexões, diferente de userId). Usado só pra identificar de quem é cada
  // área reservada de spawn (ver 'staging:sync' abaixo). Cai pro userId da
  // conexão se o cliente não enviar um (ex: cliente antigo, ou a view do OBS).
  const clientId   = (socket.handshake.query.clientId || '').trim().slice(0, 60) || userId;

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

  // ── Área reservada de spawn (por cliente) ────────────────────────────────
  // Não é tempo real (não segue o mouse pela rede) — só sincroniza quando a
  // pessoa CONFIRMA a nova posição. Guardamos por clientId (persiste entre
  // reconexões) pra cada cliente ter sua própria área mostrada pros outros,
  // sem depender de estar online no momento.
  socket.on('staging:sync', pos => {
    if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
    if (!room.state.stagingAreas) room.state.stagingAreas = {};
    const entry = { clientId, name: userName, color: userColor, left: pos.left, top: pos.top, updatedAt: Date.now() };
    room.state.stagingAreas[clientId] = entry;
    toRoom('staging:sync', entry); // inclui o remetente, pra confirmar visualmente também
    scheduleSave(roomId);
  });

  socket.on('staging:remove', () => {
    if (room.state.stagingAreas) delete room.state.stagingAreas[clientId];
    toRoom('staging:remove', { clientId });
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