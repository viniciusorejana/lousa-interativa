const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { DATA_DIR, MAX_HISTORY, EVICT_MS, SAVE_DEBOUNCE } = require('../config');
const { collectImageFilenames } = require('../utils/files');

// ─── Registro de salas em memória ─────────────────────────────────────────────
// rooms[roomId] = { state, userHistory, users, saveTimer, lastEmpty }
const rooms = {};

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
    return null; // sala nova ou arquivo corrompido
  }
}

function defaultRoomState() {
  return {
    objects:  {},
    layers:   [{ id: 'layer-default', name: 'Camada 1', visible: true }],
    groups:   [],
    viewport: { x: 0, y: 0, w: 1920, h: 1080 },
    // clientId (persistente por navegador, não por conexão) → posição da área
    // reservada de spawn desse cliente. Só existe uma entrada aqui depois que
    // a pessoa move a área pelo menos uma vez (ver 'staging:sync' no client) —
    // não sincroniza em tempo real, só quando a posição é confirmada.
    stagingAreas: {},
  };
}

function getRoom(roomId) {
  if (rooms[roomId]) return rooms[roomId];

  // Tenta carregar do disco; se não existe, cria nova
  const saved = loadRoomFromDisk(roomId);
  const state = saved ? saved.state : defaultRoomState();
  if (!state.stagingAreas) state.stagingAreas = {}; // salas salvas antes dessa feature
  if (!state.groups) state.groups = []; // salas salvas antes do sistema de grupos por etiqueta
  rooms[roomId] = {
    state,
    userHistory: {}, // userId → { undoStack: [...], redoStack: [...] } — não persiste no disco (é por sessão)
    users:       {}, // userId → { id, name, color }
    saveTimer:   null,
    lastEmpty:   null, // timestamp em que a sala ficou vazia (para eviction)
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
      state: room.state, // histórico de undo/redo é por sessão, não persiste no disco
    });
    fs.writeFile(roomFile(roomId), payload, err => {
      if (err) console.error(`[room] Erro ao salvar ${roomId}:`, err.message);
    });
  }, SAVE_DEBOUNCE);
}

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

// Todos os nomes de arquivo de imagem/gif atualmente referenciados por
// QUALQUER sala conhecida — no estado atual, em qualquer pilha de undo/redo
// de qualquer usuário conectado (pra não apagar algo que um "Ctrl+Z" ainda
// pode trazer de volta), e em salas salvas em disco mas fora da RAM no
// momento (não deveria acontecer durante uma mesma execução do servidor, já
// que o eviction apaga os dois juntos — mas checamos por segurança).
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

// ─── Eviction: remove salas vazias há mais de 30 minutos ─────────────────────
// Apaga da RAM, do disco (JSON) e todos uploads referenciados pela sala.
// Economiza disco em ambientes com SSD limitado.
function startEvictionSweep({ uploadsDir }) {
  setInterval(() => {
    const now = Date.now();
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      if (Object.keys(room.users).length > 0) continue; // sala ainda tem usuários
      if (!room.lastEmpty)                    continue; // nunca ficou vazia
      if (now - room.lastEmpty < EVICT_MS)    continue; // ainda no prazo

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
        fs.unlink(path.join(uploadsDir, filename), () => {});
      }

      delete rooms[roomId];

      const mins = Math.round((now - room.lastEmpty) / 60000);
      console.log(`[room] Evicted: ${roomId} — ${mins}min inativa, ${imgFilesSet.size} upload(s) removido(s)`);
    }
  }, 60 * 1000); // checa a cada 1 minuto
}

module.exports = {
  rooms,
  roomFile,
  loadRoomFromDisk,
  defaultRoomState,
  getRoom,
  scheduleSave,
  pushUserAction,
  applyActionPatch,
  historyFlagsFor,
  broadcastHistoryFlags,
  collectReferencedFilenames,
  startEvictionSweep,
};
