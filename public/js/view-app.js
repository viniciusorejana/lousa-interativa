// ─── Entry point do view.html ─────────────────────────────────────────────────
// Módulo ES real (Fase 5). Mecânica idêntica à conversão de board.html na
// Fase 3: o corpo deste arquivo é o mesmo script clássico que vivia inline em
// view.html, só que agora como `<script type="module" src="/js/view-app.js">`.
// Nenhuma lógica mudou — a view não tem nenhum atributo onclick/onchange
// inline no HTML, então, diferente de board-app.js, não precisa de nenhuma
// ponte com `window`.
//
// A view é deliberadamente independente de board-app.js: é um cliente
// "somente leitura" (nenhum objeto é selecionable/evented), com sua própria
// cópia de deser/applyFull/loadState/GIF-worker — ver ARCHITECTURE.md sobre
// por que essa duplicação foi mantida em vez de compartilhar módulos com o
// editor nesta fase.

// ── Canvas ────────────────────────────────────────────────────────────────────
// O canvas da view é sempre do tamanho da janela (configurado no OBS como 1920x1080).
// O viewport transform mapeia a região do board definida pelo editor para preencher
// exatamente este canvas, sem distorção e sem offset.
const RENDER_W = window.innerWidth;
const RENDER_H = window.innerHeight;

const canvas = new fabric.Canvas('board', {
  width:  RENDER_W,
  height: RENDER_H,
  selection: false,
  renderOnAddRemove: false,
  enableRetinaScaling: true,
  backgroundColor: null,
});

function mkTransp() {
  canvas.wrapperEl.style.background    = 'transparent';
  canvas.lowerCanvasEl.style.background = 'transparent';
  canvas.upperCanvasEl.style.background = 'transparent';
  document.body.style.background = 'transparent';
}
mkTransp();

// ── Viewport state ────────────────────────────────────────────────────────────
// vpX/vpY = canto superior esquerdo do retângulo de viewport no espaço do board
// vpW/vpH = tamanho do retângulo (definido pelo editor, default 1920x1080)
// A view mapeia esse retângulo para preencher RENDER_W x RENDER_H exatamente.
let vpX = 0, vpY = 0, vpW = 1920, vpH = 1080;

// ── Visibilidade na view (ao vivo) ────────────────────────────────────────────
// Espelha boardLayers/boardGroups do editor (layers-panel.js/group-service.js) —
// só o suficiente (id, layerId/groupId, viewVisible/viewHidden) pra calcular,
// junto com obj.viewHidden de cada objeto, se ele deve aparecer na live. A view
// nunca ESCREVE nesse estado, só recebe via board:init/layers:update/groups:update
// (mesmos eventos que já chegam pro editor, já que view e editor compartilham a
// mesma Socket.IO room — só faltava a view escutar).
let viewLayers = [];
let viewGroups = [];

function isLayerViewHidden(layerId) {
  const layer = viewLayers.find(l => l.id === layerId);
  return !!(layer && layer.viewVisible === false);
}

function isObjViewHidden(o) {
  if (!o) return false;
  if (o.viewHidden) return true;
  const layer = viewLayers.find(l => l.id === o.layerId);
  if (layer && layer.viewVisible === false) return true;
  const group = o.groupId ? viewGroups.find(g => g.id === o.groupId) : null;
  if (group && group.viewHidden) return true;
  return false;
}

// Reaplica a visibilidade-na-view de TODOS os objetos já carregados a partir de
// _baseOpacity/_baseVisible (a aparência "real", sem o filtro de view) — chamado
// sempre que layers:update/groups:update chegam, já que uma mudança de camada ou
// grupo pode afetar vários objetos de uma vez sem que cada um receba seu próprio
// object:modify.
function refreshViewVisibility() {
  canvas.getObjects().forEach(o => {
    if (o._baseOpacity === undefined) o._baseOpacity = o.opacity;
    if (o._baseVisible === undefined) o._baseVisible = o.visible !== false;
    const hidden = isObjViewHidden(o);
    o.set({ opacity: hidden ? 0 : o._baseOpacity, visible: hidden ? false : o._baseVisible });
  });
  canvas.renderAll();
}

function applyViewportTransform() {
  // Escala independente em X e Y para preencher o canvas inteiro sem barras pretas.
  // Como o editor força a mesma proporção (1920x1080 por padrão), na prática
  // scaleX ≈ scaleY. Se o usuário mudar a proporção, o conteúdo estica — igual ao OBS.
  const scaleX = RENDER_W / vpW;
  const scaleY = RENDER_H / vpH;
  // Translação: o ponto (vpX, vpY) do board vai para (0, 0) da tela
  const tx = -vpX * scaleX;
  const ty = -vpY * scaleY;
  canvas.setViewportTransform([scaleX, 0, 0, scaleY, tx, ty]);
  canvas.renderAll();
}

// ── Socket ────────────────────────────────────────────────────────────────────
// ── Lê o roomId da URL: /view/lousa-1 → roomId = "lousa-1" ──────────────────
const pathParts = window.location.pathname.split('/').filter(Boolean);
// pathParts: ['view'] ou ['view','lousa-1']
const viewRoomId = pathParts.length >= 2 ? pathParts[pathParts.length - 1] : 'default';

const socket = LB.createSocket({ type: 'view', roomId: viewRoomId });

socket.on('board:init', ({ state }) => {
  if (state && state.viewport) {
    vpX = state.viewport.x || 0; vpY = state.viewport.y || 0;
    vpW = state.viewport.w || 1920; vpH = state.viewport.h || 1080;
  }
  viewLayers = (state && state.layers) || [];
  viewGroups = (state && state.groups) || [];
  loadState(state);
  applyViewportTransform();
});

socket.on('viewport:sync', vp => {
  vpX = vp.x; vpY = vp.y; vpW = vp.w; vpH = vp.h;
  applyViewportTransform();
});

// Mesmos eventos que o editor usa pra manter boardLayers/boardGroups em dia —
// a view só precisa deles pra calcular visibilidade-na-view (isObjViewHidden).
socket.on('layers:update', layers => { viewLayers = layers || []; refreshViewVisibility(); });
socket.on('groups:update', groups => { viewGroups = groups || []; refreshViewVisibility(); });

socket.on('object:add',       d           => applyFull(d));
socket.on('object:modify',    d           => applyFull(d));
socket.on('object:transform', d           => { applyTransformOnly(d); canvas.renderAll(); });
socket.on('objects:transform', updates    => { updates.forEach(d => applyTransformOnly(d)); canvas.renderAll(); });
socket.on('object:remove',    ids         => { ids.forEach(id => { const o = findById(id); if (o) canvas.remove(o); }); canvas.renderAll(); });
socket.on('objects:batch',    objs        => { objs.forEach(d => applyFull(d, false)); canvas.renderAll(); });

socket.on('board:clear',      ()    => { canvas.clear(); mkTransp(); canvas.renderAll(); });
socket.on('board:sync',       state => {
  canvas.clear(); mkTransp();
  viewLayers = (state && state.layers) || [];
  viewGroups = (state && state.groups) || [];
  loadState(state);
  applyViewportTransform();
});

// Visibilidade de camada NO BOARD (hiddenObjects/layer.visible) — esconde dos
// dois lados (board e live). Diferente de layer.viewVisible (só live) — ver
// isObjViewHidden. Guarda a intenção em _baseOpacity/_baseVisible e deixa
// refreshViewVisibility aplicar o filtro de view por cima, pra um objeto que
// também esteja marcado como oculto-na-view não reaparecer quando a camada
// voltar a ficar visível no board.
socket.on('layer:visibility', ({ layerId, visible }) => {
  canvas.getObjects()
    .filter(o => o.layerId === layerId)
    .forEach(o => {
      o._baseOpacity = visible ? (o._origOpacity ?? 1) : 0;
      o._baseVisible = visible;
    });
  refreshViewVisibility();
});
socket.on('zorder:sync',      order       => {
  order.forEach((id, idx) => { const o = findById(id); if (o) canvas.moveTo(o, idx); });
  canvas.renderAll();
});

// Stroke streaming
// Se a camada ativa de quem está desenhando está oculta-na-view, o preview
// nunca é adicionado ao canvas (liveStrokes guarda só `hidden:true` + os
// pontos, sem objeto fabric) — ele nunca deve aparecer, nem por um instante,
// até o traço terminar (draw:end sempre aplica applyFull no objeto final, que
// já recalcula a visibilidade real a partir do dado definitivo).
const liveStrokes = {};
socket.on('draw:start', ({ userId, x, y, color, width, opacity, layerId }) => {
  if (isLayerViewHidden(layerId)) { liveStrokes[userId] = { hidden: true, pts: [{ x, y }] }; return; }
  const p = new fabric.Path('M ' + x + ' ' + y, {
    stroke: color, strokeWidth: width, fill: null, opacity: opacity || 1,
    strokeLineCap: 'round', strokeLineJoin: 'round', selectable: false, evented: false
  });
  liveStrokes[userId] = { path: p, pts: [{ x, y }] };
  canvas.add(p); canvas.renderAll();
});
socket.on('draw:move', ({ userId, x, y }) => {
  const s = liveStrokes[userId]; if (!s) return;
  s.pts.push({ x, y });
  if (s.hidden) return;
  // Mesma correção do board.html: recriar o Path do zero, já que mutar
  // path.set({path:...}) num objeto existente não recalcula a posição/bbox.
  const styleOpts = {
    stroke: s.path.stroke, strokeWidth: s.path.strokeWidth, fill: null,
    opacity: s.path.opacity, strokeLineCap: 'round', strokeLineJoin: 'round',
    selectable: false, evented: false,
  };
  canvas.remove(s.path);
  s.path = new fabric.Path(pts2path(s.pts), styleOpts);
  canvas.add(s.path);
  canvas.requestRenderAll();
});
socket.on('draw:end', ({ userId, object }) => {
  const s = liveStrokes[userId];
  if (s) { if (!s.hidden) canvas.remove(s.path); delete liveStrokes[userId]; }
  if (object) applyFull(object); else canvas.renderAll();
});

// ── Streaming de formas em tempo real (retângulo, elipse, linha, seta) ───────
// Construtor de forma standalone — a view não tem estado de ferramenta/cor
// ativa, então sempre recebe o estilo explícito de quem está desenhando.
function mkShapeLive(t, s, e, style) {
  const base = {
    stroke: style.color, strokeWidth: style.sz, fill: 'transparent',
    opacity: style.op, selectable: false, evented: false,
    strokeLineCap: 'round', strokeLineJoin: 'round',
  };
  if (t === 'rect')   return new fabric.Rect({ ...base, fill: style.fillShape ? style.color : 'transparent', left: Math.min(s.x,e.x), top: Math.min(s.y,e.y), width: Math.abs(e.x-s.x)||1, height: Math.abs(e.y-s.y)||1 });
  if (t === 'circle') return new fabric.Ellipse({ ...base, fill: style.fillShape ? style.color : 'transparent', left: Math.min(s.x,e.x), top: Math.min(s.y,e.y), rx: Math.abs(e.x-s.x)/2||1, ry: Math.abs(e.y-s.y)/2||1 });
  if (t === 'line')   return new fabric.Line([s.x, s.y, e.x, e.y], { ...base, fill: null });
  if (t === 'arrow') {
    const dx = e.x - s.x, dy = e.y - s.y;
    const ang = Math.atan2(dy, dx);
    const hl = Math.max(16, style.sz * 4), hw = Math.max(10, style.sz * 2.5);
    const ex2 = e.x - Math.cos(ang) * hl * 0.6, ey2 = e.y - Math.sin(ang) * hl * 0.6;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const lx = e.x - hl*cos + hw*sin, ly = e.y - hl*sin - hw*cos;
    const rx = e.x - hl*cos - hw*sin, ry = e.y - hl*sin + hw*cos;
    const pathStr = `M ${s.x} ${s.y} L ${ex2} ${ey2} M ${e.x} ${e.y} L ${lx} ${ly} L ${rx} ${ry} Z`;
    return new fabric.Path(pathStr, { ...base, fill: style.color, stroke: style.color });
  }
}

// Mesma lógica do stroke streaming acima: forma nunca aparece na view enquanto
// a camada ativa de quem desenha estiver oculta-na-view.
const liveShapes = {};

socket.on('shape:start', ({ userId, tool: t, x, y, color: c, width: w, opacity: opa, fillShape: fs, layerId }) => {
  if (isLayerViewHidden(layerId)) {
    liveShapes[userId] = { hidden: true, tool: t, start: { x, y }, style: { color: c, sz: w, op: opa, fillShape: fs } };
    return;
  }
  const style = { color: c, sz: w, op: opa, fillShape: fs };
  const sh = mkShapeLive(t, { x, y }, { x, y }, style);
  if (!sh) return;
  liveShapes[userId] = { tool: t, start: { x, y }, style, obj: sh };
  canvas.add(sh); canvas.renderAll();
});

socket.on('shape:move', ({ userId, x, y }) => {
  const rs = liveShapes[userId]; if (!rs) return;
  if (rs.hidden) return;
  canvas.remove(rs.obj);
  const sh = mkShapeLive(rs.tool, rs.start, { x, y }, rs.style);
  if (!sh) return;
  rs.obj = sh;
  canvas.add(sh); canvas.requestRenderAll();
});

socket.on('shape:end', ({ userId, object }) => {
  const rs = liveShapes[userId];
  if (rs) { if (!rs.hidden) canvas.remove(rs.obj); delete liveShapes[userId]; }
  if (object) applyFull(object); else canvas.renderAll();
});

socket.on('shape:cancel', ({ userId }) => {
  const rs = liveShapes[userId];
  if (rs) { if (!rs.hidden) canvas.remove(rs.obj); delete liveShapes[userId]; canvas.renderAll(); }
});

// ── applyFull ─────────────────────────────────────────────────────────────────
// gifId → AbortController token — cancela aplicações pendentes do mesmo GIF
// quando um update mais novo chega antes do fetch/decode completar.
const _gifApplyGen = new Map(); // objectId → generation number

function applyFull(data, render = true) {
  const ex = findById(data.id);

  // Se é só mudança de visibilidade (no board), não precisa recarregar a imagem
  if (data._visibilityChange && ex) {
    const hidden = data.opacity === 0 || data.visible === false;
    ex._baseOpacity = hidden ? 0 : (data._prevOpacity !== undefined ? data._prevOpacity : (ex._origOpacity ?? 1));
    ex._baseVisible = !hidden;
    const viewHidden = isObjViewHidden(ex);
    ex.set({ opacity: viewHidden ? 0 : ex._baseOpacity, visible: viewHidden ? false : ex._baseVisible });
    if (render) canvas.renderAll();
    return;
  }

  if (ex) canvas.remove(ex);

  // Para GIFs: incrementa generation e cancela qualquer apply anterior pendente
  if (data._isGif) {
    const gen = (_gifApplyGen.get(data.id) || 0) + 1;
    _gifApplyGen.set(data.id, gen);

    deser(data, o => {
      // Se chegou um update mais novo enquanto decodificávamos, descarta este
      if (_gifApplyGen.get(data.id) !== gen) return;

      o.selectable = false; o.evented = false;
      o._baseOpacity = data._layerHidden ? 0 : o.opacity;
      o._baseVisible = !data._layerHidden && data.visible !== false;
      const viewHidden = isObjViewHidden(o);
      o.set({ opacity: viewHidden ? 0 : o._baseOpacity, visible: viewHidden ? false : o._baseVisible });
      canvas.add(o);
      if (data.zIndex !== undefined) {
        const tgt = Math.min(data.zIndex, canvas.getObjects().length - 1);
        canvas.moveTo(o, tgt);
      }
      if (render) canvas.renderAll();
    });
    return;
  }

  deser(data, o => {
    o.selectable = false; o.evented = false;
    o._baseOpacity = data._layerHidden ? 0 : o.opacity;
    o._baseVisible = !data._layerHidden && data.visible !== false;
    const viewHidden = isObjViewHidden(o);
    o.set({ opacity: viewHidden ? 0 : o._baseOpacity, visible: viewHidden ? false : o._baseVisible });
    canvas.add(o);
    if (data.zIndex !== undefined) {
      const tgt = Math.min(data.zIndex, canvas.getObjects().length - 1);
      canvas.moveTo(o, tgt);
    }
    if (render) canvas.renderAll();
  });
}

// ── applyTransformOnly ────────────────────────────────────────────────────────
function applyTransformOnly(data) {
  const obj = findById(data.id); if (!obj) return;
  obj._baseOpacity = data.opacity !== undefined ? data.opacity : obj._baseOpacity;
  const viewHidden = isObjViewHidden(obj);
  obj.set({
    left:    data.left,  top:     data.top,
    scaleX:  Math.abs(data.scaleX || 1), scaleY: Math.abs(data.scaleY || 1),
    angle:   data.angle  || 0,
    flipX:   data.flipX  || false, flipY: data.flipY || false,
    opacity: viewHidden ? 0 : obj._baseOpacity,
  });
  if ((data.type === 'i-text' || data.type === 'text') && data.text !== undefined) {
    obj.set({ text: data.text, fill: data.fill || obj.fill });
  }
  obj.setCoords();
}

// ── Deserialização ────────────────────────────────────────────────────────────
function getFabricType(type) {
  const map = {
    'i-text': fabric.IText, 'text': fabric.Text, 'textbox': fabric.Textbox,
    'rect': fabric.Rect, 'circle': fabric.Circle, 'ellipse': fabric.Ellipse,
    'triangle': fabric.Triangle, 'line': fabric.Line,
    'polyline': fabric.Polyline, 'polygon': fabric.Polygon,
  };
  return type in map ? map[type] : fabric[type.charAt(0).toUpperCase() + type.slice(1)];
}

function deser(data, cb) {
  if (!data || !data.type) return;
  if (data.type === 'image') {
    if (data._isGif && (data._gifUrl || data.src)) {
      const gifUrl    = absoluteImgUrl(data._gifUrl || data.src);
      const relGifUrl = data._gifUrl || data.src;

      _viewDecodeGif(gifUrl).then(({ frames, canvasW, canvasH }) => {
        const firstBitmap = frames[0].bitmap;
        const img = new fabric.Image(firstBitmap, {
          width: canvasW, height: canvasH,
        });
        img.set(data); img.id = data.id;
        if (data.layerId) img.layerId = data.layerId;
        img._isGif = true; img._gifUrl = relGifUrl;
        img.selectable = false; img.evented = false;

        _viewGifRegistry.set(img.id, {
          fabricImg: img, frames, frameIdx: 0, lastTime: performance.now(),
        });
        _viewEnsureLoop();
        cb(img);
      }).catch(() => {
        // Fallback nativo
        const imgEl = new Image();
        imgEl.crossOrigin = 'anonymous';
        imgEl.onload = () => {
          const img = new fabric.Image(imgEl, {});
          img.set(data); img.id = data.id;
          if (data.layerId) img.layerId = data.layerId;
          img._isGif = true; img.selectable = false; img.evented = false;
          cb(img);
        };
        imgEl.onerror = () => {
          fabric.Image.fromURL(gifUrl, img => { img.set(data); img.id = data.id; if (data.layerId) img.layerId = data.layerId; cb(img); }, { crossOrigin: 'anonymous' });
        };
        imgEl.src = gifUrl;
      });
      return;
    }
    fabric.Image.fromURL(absoluteImgUrl(data.src), img => { img.set(data); img.id = data.id; if (data.layerId) img.layerId = data.layerId; cb(img); }, { crossOrigin: 'anonymous' });
    return;
  }
  if (data.type === 'path') { const o = new fabric.Path(data.path, data); o.id = data.id; cb(o); return; }
  if (data.type === 'line') { const o = new fabric.Line([data.x1, data.y1, data.x2, data.y2], data); o.id = data.id; cb(o); return; }
  if (data.type === 'group') {
    fabric.Group.fromObject(data, o => {
      o.id = data.id;
      if (data.layerId) o.layerId = data.layerId;
      cb(o);
    });
    return;
  }
  const FT = getFabricType(data.type);
  if (!FT) { console.warn('Tipo desconhecido:', data.type); return; }
  FT.fromObject(data, o => { o.id = data.id; cb(o); });
}

function findById(id) { return canvas.getObjects().find(o => o.id === id); }

let _loadGen = 0;

function loadState(state) {
  const gen = ++_loadGen;
  canvas.clear(); mkTransp();
  if (!state || !state.objects) { canvas.renderAll(); return; }
  const objs = Object.values(state.objects);
  if (!objs.length) { canvas.renderAll(); return; }
  let done = 0;
  const total = objs.length;
  objs.forEach(d => deser(d, o => {
    if (gen !== _loadGen) return;
    o.selectable = false; o.evented = false;
    o._baseOpacity = d._layerHidden ? 0 : o.opacity;
    o._baseVisible = !d._layerHidden && d.visible !== false;
    const viewHidden = isObjViewHidden(o);
    o.set({ opacity: viewHidden ? 0 : o._baseOpacity, visible: viewHidden ? false : o._baseVisible });
    canvas.add(o);
    if (++done < total) return;
    if (gen !== _loadGen) return;

    if (state.zorder && state.zorder.length) {
      state.zorder.forEach((id, idx) => {
        const obj = canvas.getObjects().find(x => x.id === id);
        if (obj) canvas.moveTo(obj, idx);
      });
    }

    canvas.renderAll();
  }));
}

// ── Worker GIF para view ──────────────────────────────────────────────────────
const _viewGifWorker  = new Worker('/gif.worker.js');
const _viewGifPending = new Map();
let   _viewGifReqId   = 0;

_viewGifWorker.onmessage = function(e) {
  const { id, frames, canvasW, canvasH, error } = e.data;
  const cb = _viewGifPending.get(id);
  if (!cb) return;
  _viewGifPending.delete(id);
  if (error) cb.reject(new Error(error));
  else       cb.resolve({ frames, canvasW, canvasH });
};

function _viewDecodeGif(url) {
  return new Promise((resolve, reject) => {
    const id = ++_viewGifReqId;
    _viewGifPending.set(id, { resolve, reject });
    _viewGifWorker.postMessage({ id, url });
  });
}

const _viewGifRegistry = new Map();
// Mantido para compatibilidade
const activeGifs = { add: id => {}, delete: id => { _viewGifRegistry.delete(id); }, size: 0 };

let _viewRafId = null;
function _viewGifTick(now) {
  if (_viewGifRegistry.size === 0) { _viewRafId = null; return; }
  _viewRafId = requestAnimationFrame(_viewGifTick);
  let needsRender = false;
  _viewGifRegistry.forEach((state) => {
    const { fabricImg, frames } = state;
    if (!frames || frames.length === 0) return;
    const elapsed = now - state.lastTime;
    if (elapsed >= frames[state.frameIdx].delay) {
      state.frameIdx = (state.frameIdx + 1) % frames.length;
      state.lastTime = now;
      const nb = frames[state.frameIdx].bitmap;
      fabricImg._element = nb;
      if (fabricImg._originalElement !== undefined) fabricImg._originalElement = nb;
      needsRender = true;
    }
  });
  if (needsRender) canvas.requestRenderAll();
}
function _viewEnsureLoop() {
  if (!_viewRafId) _viewRafId = requestAnimationFrame(_viewGifTick);
}
function startGifLoop() { _viewEnsureLoop(); } // compatibilidade

function pts2path(pts) { return pts.reduce((a, p, i) => i === 0 ? 'M ' + p.x + ' ' + p.y : a + ' L ' + p.x + ' ' + p.y, ''); }

// Converte qualquer src de imagem para URL absoluta usando a origem ATUAL do cliente.
// Isso garante que localhost e IP público sempre usem seu próprio servidor,
// independente de qual host estava ativo quando a imagem foi enviada.
function absoluteImgUrl(src) {
  if (!src) return '';
  if (src.startsWith('blob:')) return '';
  if (src.startsWith('http://') || src.startsWith('https://')) {
    // Absoluto com host diferente → reescreve com origem atual
    try {
      const u = new URL(src);
      if (u.pathname.startsWith('/uploads/')) {
        return window.location.origin + u.pathname;
      }
    } catch (_) {}
    return src;
  }
  // Relativo → absoluto com origem atual
  return window.location.origin + (src.startsWith('/') ? src : '/' + src);
}
