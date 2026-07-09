// ─── Entry point do board.html ────────────────────────────────────────────────
// Módulo ES real (import/export, escopo próprio, strict mode implícito).
//
// Estado atual da migração (ver ARCHITECTURE.md): o canvas e o event-bus já
// são módulos próprios (core/canvas-manager.js, core/event-bus.js). O restante
// da lógica do editor (ferramentas, camadas, grupos, mídia, clipboard, etc.)
// ainda vive inteiro aqui, dentro deste único módulo — a extração de cada
// pedaço em arquivos próprios continua nas próximas fases (4 e 5), um de
// cada vez, testável isoladamente.
//
// ── Ponte com o HTML ──────────────────────────────────────────────────────────
// `board.html` usa atributos inline (onclick="setTool('pen')", etc.) em ~50
// pontos. Handlers inline só enxergam identificadores em `window` — módulos ES
// não vazam suas declarações de nível superior pra lá automaticamente (ao
// contrário de scripts clássicos, que hoje compartilham esse mesmo escopo
// global). A lista de funções abaixo é exposta explicitamente em `window` no
// final deste arquivo — é a única razão de existir dessa ponte; internamente
// o módulo continua com import/export de verdade.
import { canvas, setResizeHook } from './core/canvas-manager.js';
import { eventBus } from './core/event-bus.js';
import { absoluteImgUrl, ser, serTransform, serTransformAbsolute } from './core/serialization.js';
import { isGifUrl, placeGif, placeImageFromUrl, insertImg, activeGifs } from './features/media/gif-service.js';
import { renderObjectsAsDataURL, exportSelectionOrBoardAsPNG } from './features/export/png-exporter.js';
import { updateLayerToolbar, groupSelected, ungroupSelected, ungroupByIds } from './features/groups/group-service.js';
import { closeBoardTutorial, btutNav } from './features/onboarding/tutorial.js';
import './features/onboarding/tooltip.js';
import {
  stagingRect, STAGING_RECT_W, STAGING_RECT_H, createStagingRect, drawStagingRect,
  _stagingPlacementMode, confirmStagingPlacement, placeStagingGroup,
  initStagingSocketListeners, setStagingAreaEntries,
  imageSpawnMode, getStagingOrigin, emitStagingSync, cancelStagingPlacement,
  previewStagingPlacement,
} from './features/spawn-area/staging-area.js';
import {
  boardLayers, boardGroups, activeLayerId, hiddenObjects, objectNames, collapsedLayers,
  typeCounters, collapsedGroups, scheduleLayersUpdate, scheduleLayersPanel,
  assignDefaultName, ensureActiveLayer, addLayer, deleteLayer,
  toggleLayerVisibility, moveLayer, applyLayerZOrder, updateLayersPanel,
  toggleObjVisibility, togglePathGroup, deletePathGroup, deleteObjById,
  toggleObjLock, toggleLayerLock, toggleGroupLock, isLayerLocked,
  toggleObjViewVisibility, toggleViewPathGroup, toggleLayerViewVisibility, toggleGroupViewVisibility,
} from './features/layers/layers-panel.js';
import { initRemoteUsersSocketListeners } from './features/remote-users/remote-users.js';
import { copySel } from './features/clipboard/clipboard.js';
import {
  tool, color, sz, op, fillShape, isDrawing, drawStart, penActive,
  getCanvasPoint, handlePointerDown, updateTmpShape, handlePointerUp,
  setTool, setColor, setSz, setOp, setFillShape, setPenActive,
} from './features/drawing-tools/drawing-tools.js';
import { layoutSidePanels, toggleVpPanel, toggleLayersPanel, updCtx } from './ui/panel-layout.js';
import {
  setSelColor, setSelFill, toggleSelFill, setSelStroke, resizeSel, setSelOp,
  delSel, sendBackFront, dupSel,
} from './ui/selection-toolbar.js';
import { changeRoom, clearAll, initHeaderButtons } from './ui/room-controls.js';
import { initLiveBg, toggleLiveBg, toggleLiveBgInteract, applyLiveBg, setLiveBgOpacity, isLiveBgEnabled } from './features/live-bg/live-bg.js';
// Re-exportadas: outros módulos já extraídos (gif-service, png-exporter,
// group-service, drawing-tools, selection-toolbar, room-controls) importam
// essas de volta daqui — ver comentário no topo deste arquivo sobre o padrão
// de import circular.
export { activeLayerId, objectNames, typeCounters, assignDefaultName, scheduleLayersUpdate, layoutSidePanels };

// Conecta o resize do canvas (definido em canvas-manager.js) ao redesenho do
// retângulo de viewport (definido mais abaixo neste arquivo). `drawViewportRect`
// é uma `function` — hoisted, então já existe como identificador aqui mesmo
// antes da sua definição textual mais abaixo.
setResizeHook(() => drawViewportRect());


// ═══════════════════════════════════════════════════════════════════════════════
// ESTADO GERAL
// ═══════════════════════════════════════════════════════════════════════════════
export let myId = null;


// ═══════════════════════════════════════════════════════════════════════════════
// ── FUNCIONALIDADE 1: PAN / NAVEGAÇÃO ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
export let isPanMode = false;   // ferramenta pan ativa
let isPanning   = false;   // está arrastando agora
let panLastX    = 0, panLastY = 0;
export let spaceHeld = false;   // espaço pressionado = pan temporário
let prevTool    = 'select';

// Dois dedos mobile
let touchLastDist = null, touchLastMidX = null, touchLastMidY = null;
let isTwoFinger = false;

export function enterPanMode() {
  isPanMode = true;
  canvas.isDrawingMode = false;
  canvas.selection = false;
  canvas.defaultCursor = 'grab';
  canvas.hoverCursor  = 'grab';
  document.body.classList.add('pan-mode');
}
export function exitPanMode() {
  isPanMode = false;
  canvas.hoverCursor = 'move';
  document.body.classList.remove('pan-mode');
  document.body.classList.remove('panning');
}

// Scroll (trackpad / roda do mouse) → pan + zoom
canvas.wrapperEl.addEventListener('wheel', e => {
  e.preventDefault();
  const zoom  = canvas.getZoom();
  const point = new fabric.Point(e.offsetX, e.offsetY);

  if (e.ctrlKey || e.metaKey) {
    // Pinch-to-zoom do trackpad (ctrlKey) ou Ctrl+scroll
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.05, Math.min(8, zoom * delta));
    canvas.zoomToPoint(point, newZoom);
  } else {
    // Pan com dois dedos no trackpad ou roda do mouse
    const vpt = canvas.viewportTransform;
    vpt[4] -= e.deltaX;
    vpt[5] -= e.deltaY;
    canvas.setViewportTransform(vpt);
  }
  canvas.renderAll();
  updateZoomInfo();
  drawViewportRect();
  updateVpCoords();
}, { passive: false });

// Mouse: clique do meio = pan; pan mode = arrastar com btn esquerdo
const canvasEl = canvas.upperCanvasEl;

canvasEl.addEventListener('mousedown', e => {
  const isMiddle = e.button === 1;
  const isLeft   = e.button === 0;
  if (isMiddle || (isPanMode && isLeft) || (spaceHeld && isLeft)) {
    e.preventDefault();
    isPanning = true;
    panLastX  = e.clientX;
    panLastY  = e.clientY;
    document.body.classList.add('panning');
  }
}, { passive: false });

window.addEventListener('mousemove', e => {
  if (!isPanning) return;
  const dx = e.clientX - panLastX;
  const dy = e.clientY - panLastY;
  panLastX = e.clientX; panLastY = e.clientY;
  const vpt = canvas.viewportTransform;
  vpt[4] += dx; vpt[5] += dy;
  canvas.setViewportTransform(vpt);
  canvas.renderAll();
  drawViewportRect();
  updateVpCoords();
});

window.addEventListener('mouseup', e => {
  if (isPanning) {
    isPanning = false;
    document.body.classList.remove('panning');
  }
});

// Touch: dois dedos = pan + zoom
canvasEl.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    isTwoFinger = true;
    touchLastDist = null;
    touchLastMidX = null; touchLastMidY = null;
    e.preventDefault();
    return;
  }
  isTwoFinger = false;

  // Um dedo em pan mode
  if (isPanMode && e.touches.length === 1) {
    isPanning = true;
    panLastX = e.touches[0].clientX;
    panLastY = e.touches[0].clientY;
    e.preventDefault();
    return;
  }

  // Fallback para lógica normal (ferramenta de desenho)
  if (tool === 'pen' && !spaceHeld) {
    setPenActive(true);
    const p = getCanvasPoint(e);
    socket.emit('draw:start', { x: p.x, y: p.y, color, width: sz, opacity: op });
    return;
  }
  e.preventDefault();
  if (e.touches.length !== 1) return;
  const p = getCanvasPoint(e);
  socket.volatile.emit('cursor:move', { x: p.x, y: p.y });
  const target = canvas.findTarget(e.touches[0]);
  if (canvas.getActiveObjects().length > 0 && tool !== 'eraser') return;
  if (target && ['rect','circle','line','arrow'].includes(tool)) return;
  handlePointerDown({ x: p.x, y: p.y }, target);
}, { passive: false });

canvasEl.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const t0 = e.touches[0], t1 = e.touches[1];
    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    const midX = (t0.clientX + t1.clientX) / 2;
    const midY = (t0.clientY + t1.clientY) / 2;

    if (touchLastDist !== null) {
      const scaleFactor = dist / touchLastDist;
      const zoom  = canvas.getZoom();
      const newZoom = Math.max(0.05, Math.min(8, zoom * scaleFactor));
      const point = new fabric.Point(midX, midY);
      canvas.zoomToPoint(point, newZoom);

      const dx = midX - touchLastMidX;
      const dy = midY - touchLastMidY;
      const vpt = canvas.viewportTransform;
      vpt[4] += dx; vpt[5] += dy;
      canvas.setViewportTransform(vpt);
      canvas.renderAll();
      updateZoomInfo();
      drawViewportRect();
    }
    touchLastDist = dist;
    touchLastMidX = midX; touchLastMidY = midY;
    return;
  }

  if (isPanMode && isPanning && e.touches.length === 1) {
    e.preventDefault();
    const dx = e.touches[0].clientX - panLastX;
    const dy = e.touches[0].clientY - panLastY;
    panLastX = e.touches[0].clientX; panLastY = e.touches[0].clientY;
    const vpt = canvas.viewportTransform;
    vpt[4] += dx; vpt[5] += dy;
    canvas.setViewportTransform(vpt);
    canvas.renderAll();
    drawViewportRect();
    updateVpCoords();
    return;
  }

  if (tool === 'pen') {
    const p = getCanvasPoint(e);
    socket.volatile.emit('draw:move', { x: p.x, y: p.y });
    return;
  }
  e.preventDefault();
  if (!isDrawing || !drawStart) return;
  const p = getCanvasPoint(e);
  socket.volatile.emit('cursor:move', { x: p.x, y: p.y });
  updateTmpShape({ x: p.x, y: p.y });
}, { passive: false });

canvasEl.addEventListener('touchend', e => {
  if (isTwoFinger) { isTwoFinger = false; touchLastDist = null; e.preventDefault(); return; }
  if (isPanMode && isPanning) { isPanning = false; e.preventDefault(); return; }
  if (tool === 'pen') { setPenActive(false); return; }
  e.preventDefault();
  const p = getCanvasPoint(e);
  handlePointerUp({ x: p.x, y: p.y });
}, { passive: false });

function resetZoom() {
  canvas.setViewportTransform([1,0,0,1,0,0]);
  canvas.renderAll();
  updateZoomInfo();
  drawViewportRect();
  updateVpCoords();
}

function updateZoomInfo() {
  const pct = Math.round(canvas.getZoom() * 100);
  document.getElementById('zoom-info').textContent = pct + '%';
}

// ═══════════════════════════════════════════════════════════════════════════════
// ── FUNCIONALIDADE 2: VIEWPORT 1920×1080 ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// O retângulo de viewport é um objeto especial no canvas (não sincronizado)
// que representa a área que o /view enxerga.
// O servidor recebe a posição do viewport e repassa para o view.html.

export let vpRect = null;          // fabric.Rect do viewport (não faz parte do board)
// Viewport é SEMPRE fixo em (0, 0) — a view sempre olha para essa origem.
const vpX = 0, vpY = 0;
export let vpW = 1920, vpH = 1080;
let isDraggingVp = false; // mantido para compatibilidade, nunca será true

function createViewportRect() {
  if (vpRect) { canvas.remove(vpRect); }
  vpRect = new fabric.Rect({
    left: 0, top: 0,
    width: vpW, height: vpH,
    fill: 'transparent',
    stroke: '#7c5cff',
    strokeWidth: 2,
    strokeDashArray: [12, 6],
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    excludeFromExport: true,
    _isViewportRect: true,
  });
  canvas.add(vpRect);
  canvas.bringToFront(vpRect);
  drawViewportRect();
  createStagingRect();
}

function drawViewportRect() {
  if (!vpRect) return;
  vpRect.set({ left: 0, top: 0, width: vpW, height: vpH });
  vpRect.setCoords();
  canvas.bringToFront(vpRect);
  document.getElementById('vp-w').value = Math.round(vpW);
  document.getElementById('vp-h').value = Math.round(vpH);
  canvas.renderAll();
  drawStagingRect();
}


canvas.on('mouse:move', opt => {
  const p = canvas.getPointer(opt.e);

  // Modo "mira" de reposicionamento da área reservada: o retângulo tracejado
  // segue o ponteiro em tempo real (só localmente) até o próximo clique.
  if (_stagingPlacementMode && stagingRect) {
    previewStagingPlacement(p);
    return;
  }

  // Emite em coordenadas do BOARD (não da tela) para funcionar com zoom/pan
  socket.volatile.emit('cursor:move', { x: p.x, y: p.y });

  if (penActive && tool === 'pen') {
    socket.emit('draw:move', { x: p.x, y: p.y });
  }
  if (!isDrawing || !drawStart) return;
  updateTmpShape(p);
});

canvas.on('mouse:up', opt => {
  if (tool === 'pen') { setPenActive(false); return; }
  handlePointerUp(canvas.getPointer(opt.e));
});

canvas.on('mouse:down', opt => {
  // Modo "mira" de reposicionamento da área reservada: este clique confirma
  // a nova posição (só pra este cliente) e não deve iniciar nenhuma outra
  // ação normal do board (desenho, seleção etc.)
  if (_stagingPlacementMode) {
    confirmStagingPlacement(canvas.getPointer(opt.e));
    return;
  }
  if (opt.target && opt.target._isViewportRect) return; // nunca seleciona o viewport/área reservada
  if (isPanMode || spaceHeld) return; // pan mode handled separately
  if (opt.e.button !== 0) return;
  if (canvas.getActiveObjects().length > 0 && tool !== 'eraser') return;
  // Não precisa mais checar "opt.target && ferramenta de forma" aqui: com
  // canvas.skipTargetFind = true (setado em setTool para as ferramentas de
  // desenho), o Fabric nunca encontra um alvo, então opt.target já vem
  // undefined nesses casos — o clique sempre inicia um desenho novo.
  handlePointerDown(canvas.getPointer(opt.e), opt.target);
});

function updateViewport() {
  vpW = parseInt(document.getElementById('vp-w').value) || 1920;
  vpH = parseInt(document.getElementById('vp-h').value) || 1080;
  drawViewportRect();
  emitViewportSync();
}

function fitViewport() {
  // Centraliza a câmera exatamente no retângulo do viewport (sempre em 0,0)
  const zoom = Math.min(
    (window.innerWidth * 0.85) / vpW,
    (window.innerHeight * 0.85) / vpH
  );
  const newZoom = Math.max(0.05, Math.min(8, zoom));
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const vptX = cx - (vpW / 2) * newZoom;
  const vptY = cy - (vpH / 2) * newZoom;
  canvas.setViewportTransform([newZoom,0,0,newZoom, vptX, vptY]);
  canvas.renderAll();
  updateZoomInfo();
  drawViewportRect();
  updateVpCoords();
}

function updateVpCoords() {
  document.getElementById('vp-coords').textContent = `${vpW} × ${vpH} px`;
}

function emitViewportSync() {
  socket.emit('viewport:sync', { x: 0, y: 0, w: vpW, h: vpH });
}

// toggleVpPanel/toggleLayersPanel/layoutSidePanels/updCtx vêm de
// ui/panel-layout.js (importadas no topo deste arquivo).

// ═══════════════════════════════════════════════════════════════════════════════
// SOCKET
// ═══════════════════════════════════════════════════════════════════════════════
// ── Nome do usuário e sala ────────────────────────────────────────────────────
const myUserName = sessionStorage.getItem('lb_username')
  || localStorage.getItem('lb_username')
  || 'Anônimo';
export const myRoomId   = sessionStorage.getItem('lb_roomId')   || 'default';
export const myRoomName = sessionStorage.getItem('lb_roomName') || myRoomId;

// Identificador persistente POR NAVEGADOR — diferente do userId (que é por
// conexão e muda a cada reconexão). Usado só pra saber "qual área reservada
// de spawn é a minha" entre os outros usuários (ver staging:sync mais
// abaixo) — nunca enviado a mais ninguém além do próprio servidor.
export const myClientId = localStorage.getItem('lb_clientId') || (() => {
  const id = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'c-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  localStorage.setItem('lb_clientId', id);
  return id;
})();

export const socket = LB.createSocket({ type: 'editor', userName: myUserName, roomId: myRoomId, clientId: myClientId });
initStagingSocketListeners(); // precisa rodar só depois que `socket` acima existe (ver staging-area.js)
initLiveBg(); // idem — depende de myRoomId acima (ver live-bg.js)

socket.on('connect', () => {
  document.getElementById('sdot').className = 'sdot on';
  document.getElementById('stxt').textContent = 'Conectado';
});
socket.on('disconnect', () => {
  document.getElementById('sdot').className = 'sdot blink';
  document.getElementById('stxt').textContent = 'Reconectando...';
});
socket.on('board:init', ({ state, roomId, userId, userName, userColor, canUndo, canRedo }) => {
  myId = userId;
  document.getElementById('mydot').style.background = userColor;
  document.getElementById('myname').textContent = userName || myUserName;
  // Mostra o nome da sala no badge inferior
  const roomLabel = document.getElementById('roomlabel');
  if (roomLabel) roomLabel.textContent = myRoomName || roomId || '';
  if (state && state.layers && state.layers.length) {
    boardLayers.length = 0;
    boardLayers.push(...state.layers);
  }
  if (state && state.groups) {
    boardGroups.length = 0;
    boardGroups.push(...state.groups);
  }
  ensureActiveLayer();
  loadState(state);
  if (state && state.viewport) {
    vpW = state.viewport.w || 1920; vpH = state.viewport.h || 1080;
  }
  // Cache local das áreas reservadas de spawn de cada cliente da sala —
  // populado aqui (estado já existente) e depois mantido ao vivo por
  // staging:sync/staging:remove. createViewportRect() → createStagingRect()
  // é quem efetivamente desenha isso no canvas.
  setStagingAreaEntries((state && state.stagingAreas) ? { ...state.stagingAreas } : {});
  createViewportRect();
  fitViewport();
  // Se essa pessoa já estava com "Spawn: área reservada" ativo (preferência
  // salva no localStorage) antes de recarregar a página / reconectar, avisa
  // os outros de novo — senão a área só reaparecia pros outros depois da
  // próxima vez que ela fosse movida, mesmo já estando ativa.
  if (imageSpawnMode === 'staging') emitStagingSync(getStagingOrigin());
  const btnU = document.querySelector('[onclick="undo()"]');
  const btnR = document.querySelector('[onclick="redo()"]');
  if (btnU) btnU.style.opacity = canUndo ? '1' : '0.35';
  if (btnR) btnR.style.opacity = canRedo ? '1' : '0.35';
});
socket.on('users:update', users => {
  const count = users.length;
  const names = users.map(u => u.name || u.id).join(', ');
  const el = document.getElementById('ucnt');
  el.textContent = ' · ' + count + (count === 1 ? ' editor' : ' editores');
  el.title = 'Online: ' + names;
});

socket.on('object:add',       d       => applyFull(d));
socket.on('object:modify',    d       => applyFull(d));
socket.on('object:transform', d       => { applyTransformOnly(d); canvas.renderAll(); });
socket.on('objects:transform', updates => { updates.forEach(d => applyTransformOnly(d)); canvas.renderAll(); });
socket.on('object:remove', ids => {
  ids.forEach(id => { const o = findById(id); if (o) canvas.remove(o); });
  canvas.renderAll();
});
socket.on('objects:batch', objs => { objs.forEach(d => applyFull(d, false)); canvas.renderAll(); });

// Registro de grupos (etiqueta groupId) — sincronizado como um todo, mesmo
// padrão de 'layers:update' (sem tracking de undo). Os objetos em si (com seu
// groupId) já chegam por object:add/object:modify/objects:modify:commit.
socket.on('groups:update', groups => {
  boardGroups.length = 0;
  boardGroups.push(...groups);
  scheduleLayersPanel();
});

socket.on('board:clear', () => {
  canvas.clear(); canvas.backgroundColor = isLiveBgEnabled() ? 'transparent' : '#1e1e2a'; canvas.renderAll();
  createViewportRect();
  hiddenObjects.clear();
  scheduleLayersUpdate();
});
socket.on('board:sync', st => {
  canvas.clear(); canvas.backgroundColor = isLiveBgEnabled() ? 'transparent' : '#1e1e2a';
  hiddenObjects.clear();
  if (st && st.layers && st.layers.length) { boardLayers.length = 0; boardLayers.push(...st.layers); }
  if (st && st.groups) { boardGroups.length = 0; boardGroups.push(...st.groups); }
  ensureActiveLayer();
  loadState(st);
  setTimeout(createViewportRect, 100);
  scheduleLayersUpdate();
});
socket.on('zorder:sync', order => {
  const contentObjs = canvas.getObjects().filter(o => !o._isViewportRect);
  order.forEach((id, idx) => {
    const o = contentObjs.find(x => x.id === id);
    if (o) canvas.moveTo(o, idx);
  });
  if (vpRect) canvas.bringToFront(vpRect);
  canvas.renderAll();
  scheduleLayersUpdate();
});

socket.on('viewport:sync', vp => {
  vpW = vp.w; vpH = vp.h;
  drawViewportRect();
});

// Visibilidade de camada — aplica para todos os objetos dessa camada
socket.on('layer:visibility', ({ layerId, visible }) => {
  const layer = boardLayers.find(l => l.id === layerId);
  if (layer) layer.visible = visible;
  canvas.getObjects()
    .filter(o => o.layerId === layerId && !o._isViewportRect)
    .forEach(o => {
      if (!visible) {
        o._savedOpacity = o._savedOpacity ?? o.opacity;
        o.set({ opacity: 0, visible: false });
        hiddenObjects.add(o.id);
      } else {
        o.set({ opacity: o._savedOpacity ?? 1, visible: true });
        delete o._savedOpacity;
        hiddenObjects.delete(o.id);
      }
    });
  canvas.renderAll();
  scheduleLayersPanel();
});

socket.on('layers:update', layers => {
  boardLayers.length = 0;
  boardLayers.push(...layers);
  ensureActiveLayer();
  applyLayerZOrder(); // reflete nova ordem das camadas no canvas
  scheduleLayersPanel();
});

// Streaming de traço/formas de outros usuários e cursores remotos — ver
// features/remote-users/remote-users.js (init chamado logo após `socket` acima).
initRemoteUsersSocketListeners();

// ═══════════════════════════════════════════════════════════════════════════════
// APLICAÇÃO DE DADOS RECEBIDOS
// ═══════════════════════════════════════════════════════════════════════════════
// ── Fila de carregamento por objeto ───────────────────────────────────────────
// Evita race condition quando chegam múltiplos updates para o mesmo objeto
// enquanto uma imagem ainda está carregando via fromURL.
const loadingQueue = {};  // id → último data recebido enquanto carregando
const loadingNow   = new Set();  // ids que estão no meio de um fromURL

export function applyFull(data, render = true) {
  if (!data || !data.id) return;

  // Se já está carregando esse objeto, guarda o update mais recente para depois
  if (loadingNow.has(data.id)) {
    loadingQueue[data.id] = data;
    return;
  }

  const ex = findById(data.id);
  if (ex) canvas.remove(ex);

  // Trata como async se for imagem OU grupo que contém imagens/gifs (deser é assíncrono)
  const isAsync = data.type === 'image' ||
    (data.type === 'group' && Array.isArray(data.objects) &&
      data.objects.some(c => c.type === 'image'));
  if (isAsync) loadingNow.add(data.id);

  deser(data, o => {
    // Aplica visibility state de camada se existir
    if (data._layerHidden) { o.set({ opacity: 0, visible: false }); }

    canvas.add(o);

    // Sincroniza o Set local hiddenObjects com o estado real do objeto recebido.
    // Sem isso, o ícone de olho e o toggle de visibilidade ficam dessincronizados
    // em qualquer cliente que não foi quem escondeu o objeto originalmente —
    // o clique local passaria a repetir a ação errada (esconder de novo, por ex).
    const isHiddenNow = data._layerHidden === true ||
      (data.opacity === 0 && data.visible === false);
    if (isHiddenNow) {
      hiddenObjects.add(o.id);
      // _prevOpacity viaja no payload quando quem escondeu tinha opacidade != 1;
      // sem isso não temos como saber para qual valor restaurar depois.
      o._savedOpacity = (data._prevOpacity !== undefined) ? data._prevOpacity : (o._savedOpacity ?? 1);
    } else {
      hiddenObjects.delete(o.id);
      delete o._savedOpacity;
    }

    // Aplica z-order: usa zIndex do objeto se disponível, depois reforça a ordem de camadas.
    // Isso garante que um objeto adicionado numa camada inferior fique abaixo de objetos
    // em camadas superiores, independente da ordem de chegada.
    if (data.zIndex !== undefined) {
      const contentObjs = canvas.getObjects().filter(x => !x._isViewportRect);
      const tgt = Math.min(data.zIndex, contentObjs.length - 1);
      canvas.moveTo(o, tgt);
    }
    // Reforça a ordem entre camadas (corrige casos onde zIndex está desatualizado)
    applyLayerZOrder();

    if (vpRect) canvas.bringToFront(vpRect);
    if (render) canvas.renderAll();

    if (isAsync) {
      loadingNow.delete(data.id);
      if (loadingQueue[data.id]) {
        const queued = loadingQueue[data.id];
        delete loadingQueue[data.id];
        applyFull(queued, true);
        return;
      }
    }
    scheduleLayersUpdate();
  });
}

function applyTransformOnly(data) {
  const obj = findById(data.id); if (!obj) return;
  obj.set({
    left:    data.left,  top:     data.top,
    scaleX:  Math.abs(data.scaleX || 1), scaleY:  Math.abs(data.scaleY || 1),
    angle:   data.angle   || 0,
    flipX:   data.flipX   || false, flipY:   data.flipY   || false,
    opacity: data.opacity !== undefined ? data.opacity : obj.opacity,
  });
  obj.setCoords();
  if ((data.type === 'i-text' || data.type === 'text') && data.text !== undefined) {
    obj.set({ text: data.text, fill: data.fill || obj.fill });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMIT — SYNC
// ═══════════════════════════════════════════════════════════════════════════════
let lastSyncMs = 0;
export function throttle60(fn) {
  const now = Date.now();
  if (now - lastSyncMs < 16) return;
  lastSyncMs = now;
  fn();
}

function emitLiveTransform(target) {
  if (!target || target._isViewportRect) return;
  throttle60(() => {
    const isMulti = target.type === 'activeSelection';
    if (!isMulti) {
      if (target.id) socket.volatile.emit('object:transform', serTransform(target));
      return;
    }
    const gm = target.calcTransformMatrix();
    const updates = target.getObjects().filter(o => o.id).map(o => serTransformAbsolute(o, gm));
    if (updates.length) socket.volatile.emit('objects:transform', updates);
  });
}

export function emitFull(obj) {
  if (obj._isViewportRect) return;
  ensureActiveLayer(); // garante que activeLayerId é válido antes de atribuir
  const targetLayerId = obj.layerId || activeLayerId;
  if (isLayerLocked(targetLayerId)) {
    // Camada travada (inclusive quando é a única existente, caso em que
    // ensureActiveLayer não tem outra camada pra desviar) — recusa a criação
    // em vez de desenhar silenciosamente dentro dela.
    canvas.remove(obj);
    canvas.renderAll();
    showToast('Camada travada — destrave para criar objetos aqui.', 2500);
    return;
  }
  if (!obj.id) obj.id = genId();
  if (!obj.layerId) obj.layerId = activeLayerId;
  const s = ser(obj);
  if (s) socket.emit('object:add', s);
}

// Wrapper para canvas.add que sempre reforça a ordem de camadas depois.
// Usar em todo lugar que adiciona um objeto localmente (não via applyFull).
export function addToCanvas(obj) {
  canvas.add(obj);
  applyLayerZOrder();
  if (vpRect) canvas.bringToFront(vpRect);
}

export function emitModify(obj) {
  if (obj._isViewportRect || !obj.id) return;
  const s = ser(obj);
  if (s) socket.emit('object:modify:commit', s);
}

function emitModifyGroup(target) {
  if (!target) return;
  const isMulti = target.type === 'activeSelection';
  if (!isMulti) { emitModify(target); return; }
  const gm = target.calcTransformMatrix();
  // Emite tudo junto num único evento de commit, pra virar UMA ação de
  // histórico (senão o Ctrl+Z desfaz só o último sub-objeto do grupo).
  const updates = target.getObjects().filter(o => o.id).map(o => {
    const abs  = serTransformAbsolute(o, gm);
    const data = ser(o);
    if (!data) return null;
    Object.assign(data, abs);
    return data;
  }).filter(Boolean);
  if (updates.length) socket.emit('objects:modify:commit', updates);
}

// sendBackFront vem de ui/selection-toolbar.js (importada no topo deste
// arquivo).

// ═══════════════════════════════════════════════════════════════════════════════
// EVENTOS DO CANVAS
// ═══════════════════════════════════════════════════════════════════════════════
canvas.on('object:moving',   opt => { if (!opt.target._isViewportRect) emitLiveTransform(opt.target); });
canvas.on('object:scaling',  opt => { if (!opt.target._isViewportRect) emitLiveTransform(opt.target); });
canvas.on('object:rotating', opt => { if (!opt.target._isViewportRect) emitLiveTransform(opt.target); });
canvas.on('object:skewing',  opt => { if (!opt.target._isViewportRect) emitLiveTransform(opt.target); });
canvas.on('object:modified', opt => {
  if (!opt.target || opt.target._isViewportRect) return;
  emitModifyGroup(opt.target);
  scheduleLayersUpdate();
});

canvas.on('path:created', opt => {
  const path = opt.path; path.id = genId();
  path.layerId = activeLayerId;
  path.set('opacity', op);
  // O Fabric já adicionou o path ao canvas automaticamente (no topo) — reforça
  // a ordem de camadas para que ele respeite a hierarquia correta.
  applyLayerZOrder();
  emitFull(path);
  socket.emit('draw:end', { object: ser(path) });
  // Sincroniza z-order para que o traço apareça na camada correta nos clientes remotos
  socket.emit('zorder:sync', canvas.getObjects().filter(o => o.id && !o._isViewportRect).map(o => o.id));
});

canvas.on('selection:created', updCtx);
canvas.on('selection:updated', updCtx);
canvas.on('object:modified',   updCtx);
canvas.on('selection:cleared', () => { document.getElementById('ctx').style.display = 'none'; layoutSidePanels(); });

// ═══════════════════════════════════════════════════════════════════════════════
// POINTER LOGIC / FERRAMENTAS
// ═══════════════════════════════════════════════════════════════════════════════
// getCanvasPoint, handlePointerDown/Up, updateTmpShape, setTool, setColor,
// setSz, setOp, setFillShape — ver features/drawing-tools/drawing-tools.js
// (importado no topo deste arquivo). O registro bruto dos listeners de
// mouse/touch (acima e no wheel/mousedown de pan) continua aqui: é um hub
// compartilhado também por pan e pela área reservada.

// updCtx e todo o layout dos painéis flutuantes (spawn/ctx/camadas/viewport/
// view-ajuda) vêm de ui/panel-layout.js (importados no topo deste arquivo).

// ── Funções de edição ao vivo ─────────────────────────────────────────────────
// Funcionam tanto em seleção única quanto em multi-seleção.
// IMPORTANTE: quando há activeSelection, o Fabric converte left/top dos filhos
// para coordenadas relativas — precisamos serializar com coordenadas absolutas.
// setSelColor/setSelFill/toggleSelFill/setSelStroke/resizeSel/setSelOp/delSel
// vêm de ui/selection-toolbar.js (importadas no topo deste arquivo).

// ═══════════════════════════════════════════════════════════════════════════════
// CRIAÇÃO DE FORMAS
// ═══════════════════════════════════════════════════════════════════════════════
export function mkShape(t, s, e, id, style) {
  const st   = style || { color, sz, op, fillShape };
  const oid  = id || genId();
  const base = {
    stroke: st.color, strokeWidth: st.sz, fill: 'transparent',
    opacity: st.op, selectable: true, evented: true,
    strokeLineCap: 'round', strokeLineJoin: 'round', id: oid
  };
  if (t === 'rect')   return new fabric.Rect({ ...base, fill: st.fillShape ? st.color : 'transparent', left: Math.min(s.x,e.x), top: Math.min(s.y,e.y), width: Math.abs(e.x-s.x)||1, height: Math.abs(e.y-s.y)||1 });
  if (t === 'circle') return new fabric.Ellipse({ ...base, fill: st.fillShape ? st.color : 'transparent', left: Math.min(s.x,e.x), top: Math.min(s.y,e.y), rx: Math.abs(e.x-s.x)/2||1, ry: Math.abs(e.y-s.y)/2||1 });
  if (t === 'line')   return new fabric.Line([s.x, s.y, e.x, e.y], { ...base, fill: null });
  if (t === 'arrow') {
    const dx  = e.x - s.x, dy = e.y - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    // Tamanho da cabeça proporcional à espessura, mínimo razoável
    const hl  = Math.max(16, st.sz * 4);
    const hw  = Math.max(10, st.sz * 2.5);
    // Recua o fim da linha para não passar pela cabeça
    const ex2 = e.x - Math.cos(ang) * hl * 0.6;
    const ey2 = e.y - Math.sin(ang) * hl * 0.6;
    // Pontos da cabeça triangular no espaço local
    const cos = Math.cos(ang), sin = Math.sin(ang);
    // Ponta, esquerda, direita
    const tip = [e.x, e.y];
    const lx  = e.x - hl * cos + hw * sin;
    const ly  = e.y - hl * sin - hw * cos;
    const rx  = e.x - hl * cos - hw * sin;
    const ry  = e.y - hl * sin + hw * cos;
    const pathStr = [
      `M ${s.x} ${s.y} L ${ex2} ${ey2}`,
      `M ${tip[0]} ${tip[1]} L ${lx} ${ly} L ${rx} ${ry} Z`,
    ].join(' ');
    return new fabric.Path(pathStr, {
      ...base,
      fill: st.color,          // cabeça preenchida
      stroke: st.color,
      strokeWidth: st.sz,
      strokeLineCap: 'round',
      strokeLineJoin: 'round',
      _isArrow: true,       // marcador para saber que é seta
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXTO
// ═══════════════════════════════════════════════════════════════════════════════
export function addText(pos) {
  const t = new fabric.IText('Texto', {
    left: pos.x, top: pos.y, id: genId(),
    fill: color, fontSize: Math.max(16, sz * 4), opacity: op,
    fontFamily: 'Segoe UI, system-ui, sans-serif',
    selectable: true, editable: true
  }); addToCanvas(t);
  canvas.setActiveObject(t); t.enterEditing(); canvas.renderAll();
  t.on('editing:exited', () => emitFull(t));
  t.on('changed', () => socket.volatile.emit('object:transform', {
    id: t.id, type: t.type, text: t.text, fill: t.fill,
    left: t.left, top: t.top, scaleX: t.scaleX, scaleY: t.scaleY,
    angle: t.angle, flipX: t.flipX, flipY: t.flipY, opacity: t.opacity
  }));
  setTool('select');
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMAGENS
// ═══════════════════════════════════════════════════════════════════════════════
// showToast(msg) sozinho = toast "de processo" (ex: "Enviando imagem..."),
// fica até o próprio código chamar hideToast() quando a operação terminar.
// showToast(msg, ms) = toast "de notificação" (confirmação/erro rápido),
// some sozinho depois de `ms`. O timer é sempre cancelado/reiniciado a cada
// chamada, pra um toast novo nunca ser escondido por um timer de um toast
// anterior que ainda estava pendente.
let _toastHideTimer = null;
export function showToast(msg, autoHideMs) {
  document.getElementById('toast-msg').textContent = msg;
  document.getElementById('toast').classList.add('show');
  clearTimeout(_toastHideTimer);
  _toastHideTimer = autoHideMs ? setTimeout(hideToast, autoHideMs) : null;
}
export function hideToast() {
  clearTimeout(_toastHideTimer);
  document.getElementById('toast').classList.remove('show');
}

export async function uploadFile(file) {
  showToast('Enviando imagem...');
  const fd = new FormData(); fd.append('image', file);
  const res = await fetch('/upload', { method: 'POST', body: fd });
  if (!res.ok) {
    let msg = 'Falha no upload';
    try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  return (await res.json()).url;
}



// Paste, drag-and-drop e o listener de 'paste' do sistema — ver
// features/clipboard/clipboard.js (import por efeito colateral: registra os
// listeners de window/canvas assim que o módulo carrega).

// ═══════════════════════════════════════════════════════════════════════════════
// HISTÓRICO (colaborativo — servidor é a fonte da verdade)
// ═══════════════════════════════════════════════════════════════════════════════
// O servidor mantém undoStack/redoStack. O cliente apenas emite os comandos.
// board:sync recebido do servidor recarrega o estado para todos.

function undo() { socket.emit('history:undo'); }
function redo() { socket.emit('history:redo'); }

// Atualiza botões de undo/redo baseado no estado do servidor (por usuário)
socket.on('history:update', ({ canUndo, canRedo }) => {
  const btnU = document.querySelector('[onclick="undo()"]');
  const btnR = document.querySelector('[onclick="redo()"]');
  if (btnU) btnU.style.opacity = canUndo ? '1' : '0.35';
  if (btnR) btnR.style.opacity = canRedo ? '1' : '0.35';
});

// Avisa quando um undo/redo não pôde ser aplicado por completo porque outro
// usuário alterou o(s) mesmo(s) objeto(s) depois da ação original.
socket.on('history:conflict', ({ count, action }) => {
  const verbo = action === 'undo' ? 'desfazer' : 'refazer';
  showToast(`Não foi possível ${verbo} ${count} item(ns) — outro usuário alterou depois.`, 3500);
});
// changeRoom/clearAll vêm de ui/room-controls.js (importadas no topo deste
// arquivo).

// ═══════════════════════════════════════════════════════════════════════════════
// DESERIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════
function getFabricType(type) {
  const map = {
    'i-text': fabric.IText, 'text': fabric.Text, 'textbox': fabric.Textbox,
    'rect': fabric.Rect, 'circle': fabric.Circle, 'ellipse': fabric.Ellipse,
    'triangle': fabric.Triangle, 'line': fabric.Line,
    'polyline': fabric.Polyline, 'polygon': fabric.Polygon,
  };
  return type in map ? map[type] : fabric[type.charAt(0).toUpperCase() + type.slice(1)];
}

export function deser(data, cb) {
  if (!data || !data.type) return;
  if (data.type === 'image') {
    if (data._isGif && (data._gifUrl || data.src)) {
      // GIF — decodifica via Worker (gif.worker.js) e anima com rAF global
      placeGif(data._gifUrl || data.src, data)
        .then(img => cb(img))
        .catch(() => {
          // Fallback: carrega como imagem estática
          fabric.Image.fromURL(absoluteImgUrl(data.src || data._gifUrl), img => {
            img.set(data); img.id = data.id; if (data.layerId) img.layerId = data.layerId; cb(img);
          }, { crossOrigin: 'anonymous' });
        });
      return;
    }
    fabric.Image.fromURL(absoluteImgUrl(data.src), img => { img.set(data); img.id = data.id; if (data.layerId) img.layerId = data.layerId; if (data.groupId) img.groupId = data.groupId; img.locked = !!data.locked; cb(img); }, { crossOrigin: 'anonymous' });
    return;
  }
  if (data.type === 'path') { const o = new fabric.Path(data.path, data); o.id = data.id; if (data.layerId) o.layerId = data.layerId; if (data.groupId) o.groupId = data.groupId; o.locked = !!data.locked; if (data._isArrow) o._isArrow = true; cb(o); return; }
  if (data.type === 'line') {
    const o = new fabric.Line([data.x1, data.y1, data.x2, data.y2], data);
    o.id = data.id; if (data.groupId) o.groupId = data.groupId; o.locked = !!data.locked; cb(o); return;
  }
  if (data.type === 'group') {
    // Usa o fabric.Group.fromObject nativo — ele chama fabric.Image.fromURL
    // internamente para cada filho, que agora é interceptado pelo nosso patch:
    // src é normalizado para o host atual e crossOrigin='anonymous' é garantido.
    // Só ocorre para grupos antigos (fabric.Group real) salvos antes deste
    // sistema de groupId por etiqueta — novos grupos não usam mais type='group'.
    fabric.Group.fromObject(data, o => {
      o.id = data.id;
      if (data.layerId) o.layerId = data.layerId;
      cb(o);
    });
    return;
  }
  const FT = getFabricType(data.type);
  if (!FT) { console.warn('Tipo desconhecido:', data.type); return; }
  FT.fromObject(data, o => { o.id = data.id; if (data.layerId) o.layerId = data.layerId; if (data.groupId) o.groupId = data.groupId; o.locked = !!data.locked; cb(o); });
}

export function findById(id) { return canvas.getObjects().find(o => o.id === id); }

// Token de geração — cancela loadState anterior se um novo board:sync chegar antes de terminar
let _loadGen = 0;

function loadState(state) {
  const gen = ++_loadGen;
  canvas.getObjects().filter(o => !o._isViewportRect).forEach(o => canvas.remove(o));
  if (!state || !state.objects) { canvas.renderAll(); return; }
  const objs = Object.values(state.objects);
  if (!objs.length) { canvas.renderAll(); return; }
  let done = 0;
  const total = objs.length;
  objs.forEach(d => deser(d, o => {
    if (gen !== _loadGen) return;
    canvas.add(o);
    if (++done < total) return;
    if (gen !== _loadGen) return;

    // Aplica z-order: usa state.zorder se disponível (fonte de verdade precisa),
    // senão cai no applyLayerZOrder como fallback (para salas antigas sem zorder salvo).
    if (state.zorder && state.zorder.length) {
      state.zorder.forEach((id, idx) => {
        const o = canvas.getObjects().find(x => x.id === id);
        if (o) canvas.moveTo(o, idx);
      });
    } else {
      applyLayerZOrder();
    }

    if (vpRect) canvas.bringToFront(vpRect);
    canvas.renderAll();
    scheduleLayersUpdate();
  }));
}

export function pts2path(pts) { return pts.reduce((a, p, i) => i === 0 ? 'M ' + p.x + ' ' + p.y : a + ' L ' + p.x + ' ' + p.y, ''); }
export function genId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

// ═══════════════════════════════════════════════════════════════════════════════
// ATALHOS DE TECLADO
// ═══════════════════════════════════════════════════════════════════════════════
window.addEventListener('keydown', e => {
  const activeObj = canvas.getActiveObject();
  if (activeObj && activeObj.isEditing) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

  // Esc cancela o modo "mira" de reposicionar a área reservada
  if (e.key === 'Escape' && _stagingPlacementMode) {
    e.preventDefault();
    cancelStagingPlacement();
    return;
  }

  // Espaço: pan temporário
  if (e.code === 'Space' && !spaceHeld) {
    e.preventDefault();
    spaceHeld = true;
    prevTool = tool;
    // Se estava na caneta, desativa o modo de desenho para o pan não criar traços
    if (canvas.isDrawingMode) {
      canvas.isDrawingMode = false;
    }
    document.body.classList.add('pan-mode');
    canvas.defaultCursor = 'grab';
    canvas.hoverCursor = 'grab';
    return;
  }

  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); }
    else if (e.key === 'y') { e.preventDefault(); redo(); }
    else if (e.key === 'd') { e.preventDefault(); dupSel(); }
    else if (e.key === 'c') { e.preventDefault(); copySel(); }
    // Ctrl+V não é interceptado aqui: sempre deixamos o evento 'paste' nativo do
    // navegador disparar, que lê diretamente do clipboard do sistema (ver listener
    // de 'paste' mais abaixo, que trata tanto objetos do board quanto imagens/URLs).
    else if (e.key === 'a') {
      e.preventDefault();
      canvas.discardActiveObject();
      const sel = canvas.getObjects().filter(o => !o._isViewportRect && o.selectable !== false);
      if (sel.length) {
        canvas.setActiveObject(new fabric.ActiveSelection(sel, { canvas }));
        canvas.renderAll();
      }
    }
    return;
  }
  switch (e.key) {
    case 'v': setTool('select'); break; case 'h': setTool('pan'); break;
    case 'p': setTool('pen'); break;
    case 'e': setTool('eraser'); break; case 'r': setTool('rect'); break;
    case 'c': setTool('circle'); break; case 'l': setTool('line'); break;
    case 'a': setTool('arrow'); break;  case 't': setTool('text'); break;
    case 'f': case 'F': fitViewport(); break;
    case '0': resetZoom(); break;
    case '+': case '=': {
      const p = new fabric.Point(window.innerWidth/2, window.innerHeight/2);
      canvas.zoomToPoint(p, Math.min(8, canvas.getZoom() * 1.2));
      canvas.renderAll(); updateZoomInfo(); drawViewportRect();
      break;
    }
    case '-': {
      const p = new fabric.Point(window.innerWidth/2, window.innerHeight/2);
      canvas.zoomToPoint(p, Math.max(0.05, canvas.getZoom() / 1.2));
      canvas.renderAll(); updateZoomInfo(); drawViewportRect();
      break;
    }
    case 'Delete': case 'Backspace': if (canvas.getActiveObjects().length) delSel(); break;
  }
});

window.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    spaceHeld = false;
    isPanning = false;
    document.body.classList.remove('pan-mode');
    document.body.classList.remove('panning');
    canvas.defaultCursor = 'default';
    canvas.hoverCursor = 'move';
    // Restaura o modo de desenho se a ferramenta ativa é caneta
    if (tool === 'pen') {
      canvas.isDrawingMode = true;
    }
  }
});

// dupSel() vem de ui/selection-toolbar.js; copySel() vem de
// features/clipboard/clipboard.js (ambas importadas no topo deste arquivo) —
// chamadas pelos atalhos Ctrl+D/Ctrl+C acima.

// ── Tooltip flutuante da toolbar ────────────────────────────────────────────
// Substitui o .tb-tip antigo (que ficava preso dentro do overflow do #toolbar,
// exigindo scroll pra aparecer). Este vive em <body>, com position:fixed,
// então nunca é cortado por overflow/transform de nenhum ancestral. A posição
// é recalculada a cada hover via getBoundingClientRect do botão.

// Init
setTool('select');
// openViewUrl/initHeaderButtons vêm de ui/room-controls.js (importadas no
// topo deste arquivo) — liga os botões do painel superior direito (ver ao
// vivo / ajuda).
initHeaderButtons();


// ═══════════════════════════════════════════════════════════════════════════════
// PONTE DE COMPATIBILIDADE COM ATRIBUTOS INLINE DO HTML (onclick/onchange/...)
// ═══════════════════════════════════════════════════════════════════════════════
// setTool/setColor/setSz/setOp/setFillShape vêm de
// features/drawing-tools/drawing-tools.js (importadas no topo deste arquivo).

// Cada nome abaixo corresponde a um atributo onclick/onchange/oninput
// encontrado em board.html. Se um atributo inline novo for adicionado ao HTML
// referenciando uma função/objeto daqui, ele precisa ser adicionado nesta
// lista também — senão o clique falha silenciosamente (function is not
// defined) porque o módulo não vaza identificadores pro escopo global.
Object.assign(window, {
  setTool, setColor, setSz, setOp, setFillShape,
  insertImg, exportSelectionOrBoardAsPNG,
  undo, redo, fitViewport, resetZoom, clearAll, changeRoom,
  setSelColor, setSelFill, toggleSelFill, setSelStroke, resizeSel, setSelOp,
  sendBackFront, delSel,
  toggleVpPanel, updateViewport,
  toggleLayersPanel, addLayer, groupSelected, ungroupSelected, ungroupByIds,
  scheduleLayersUpdate, toggleLayerVisibility, moveLayer, deleteLayer,
  toggleObjVisibility, deleteObjById, togglePathGroup, deletePathGroup,
  toggleObjLock, toggleLayerLock, toggleGroupLock,
  toggleObjViewVisibility, toggleViewPathGroup, toggleLayerViewVisibility, toggleGroupViewVisibility,
  closeBoardTutorial, btutNav,
  toggleLiveBg, toggleLiveBgInteract, applyLiveBg, setLiveBgOpacity,
});
// `collapsedLayers`/`collapsedGroups` são Sets referenciados diretamente por
// identificador em atributos inline (ex: collapsedLayers.has(...)) — por
// serem objetos (tipo referência), expor a MESMA instância aqui é suficiente
// pra inline e módulo lerem/escreverem o mesmo Set.
window.collapsedLayers = collapsedLayers;
window.collapsedGroups = collapsedGroups;
