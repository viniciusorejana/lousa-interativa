// Ferramentas de desenho: estado da ferramenta ativa (seleção/pan/caneta/
// formas/borracha/texto) e a lógica de pointer down/move/up que decide o que
// cada ferramenta faz a cada evento (a "Strategy" de cada uma, hoje ainda
// dentro de um único módulo — ver ARCHITECTURE.md sobre o alvo de separar
// select/pan/pen/shape/text em arquivos próprios numa fase futura).
//
// O registro bruto dos listeners de mouse/touch (wheel, mousedown/move/up,
// touchstart/move/end, canvas.on('mouse:move'/'down'/'up')) continua em
// board-app.js de propósito: é um hub compartilhado também por pan e pela
// área reservada (staging), que decide qual dessas features trata cada
// evento antes de chamar as funções deste módulo.
import { canvas } from '../../core/canvas-manager.js';
import { ser } from '../../core/serialization.js';
import { isLayerLocked } from '../layers/layers-panel.js';
import {
  socket, vpRect, findById, genId, mkShape, addToCanvas, emitFull,
  throttle60, addText, isPanMode, spaceHeld, enterPanMode, exitPanMode,
  layoutSidePanels, scheduleLayersUpdate, activeLayerId,
} from '../../board-app.js';

export let tool = 'select', color = '#ffffff', sz = 4, op = 1, fillShape = false;
export let isDrawing = false, drawStart = null;
let tmpShapeId = null;
export let penActive = false;

// ── Borracha real (estilo Photoshop) ───────────────────────────────────────────
// Em vez de remover o objeto inteiro sob o cursor, arrasta continuamente e
// "recorta" só a área sob o traço em cada objeto tocado (eraseStrokes, ver
// fabric-erase-patch.js). Um traço pode tocar vários objetos sobrepostos —
// tudo isso vira UM único commit/undo quando o mouse é solto.
export let eraserActive = false;
let eraserLastPoint = null;
let eraserTouchedIds = new Set();
let eraserActiveStrokeObjs = new Set(); // objetos com traço "aberto" no ponto anterior

// Igual às demais formas, apagar aqui é só "pintar por cima" com
// destination-out (fabric-erase-patch.js) — não depende do tipo do objeto,
// então imagens/gifs e textos também entram na lista de candidatos.
function eraserCandidates() {
  const shapeTypes = [
    'path', 'rect', 'circle', 'ellipse', 'triangle', 'line', 'polyline', 'polygon',
    'image', 'text', 'i-text', 'textbox',
  ];
  return canvas.getObjects().filter(o =>
    !o._isViewportRect && o.id && !o.locked && o.visible !== false &&
    shapeTypes.includes(o.type) && !isLayerLocked(o.layerId)
  );
}

// Distância de um ponto a um segmento — usado pra testar o traço real de um
// fabric.Path (sua bounding box é enganosamente maior que o desenho fino).
function distPointToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Metade da espessura do TRAÇO do próprio objeto, em espaço de canvas (ex.: um
// path desenhado com espessura 20 tem strokeWidth=20 em unidades locais —
// convertido pela escala atual do objeto). Sem isso, uma borracha fina (ex.
// 8) arrastada sobre um traço grosso (ex. 20) só teria alcance/corte de 8,
// deixando as "bordas" do traço grosso intocadas dos dois lados do traçado
// central — visualmente parecia apagar só o "miolo" do desenho.
function objStrokeHalfWidthCanvas(obj) {
  if (!obj.stroke || obj.stroke === 'transparent' || !obj.strokeWidth) return 0;
  const avgScale = (Math.abs(obj.scaleX || 1) + Math.abs(obj.scaleY || 1)) / 2;
  return (obj.strokeWidth * avgScale) / 2;
}

// Mesma técnica de amostragem de pontos do path (via calcTransformMatrix) já
// usada pela seleção por retângulo em canvas-manager.js (touchesMarqueeRect).
// Para as demais formas vetoriais, a bounding box já é ~ a geometria visível
// (mesmo critério usado lá), então containsPoint (com recalculo) já é preciso
// o bastante.
function objectTouchedByEraser(obj, pt, radius) {
  if (obj.type === 'path' && Array.isArray(obj.path)) {
    const effRadius = radius + objStrokeHalfWidthCanvas(obj);
    const m = obj.calcTransformMatrix();
    const off = obj.pathOffset || { x: 0, y: 0 };
    let prev = null;
    for (const cmd of obj.path) {
      for (let i = 1; i < cmd.length; i += 2) {
        const abs = fabric.util.transformPoint({ x: cmd[i] - off.x, y: cmd[i + 1] - off.y }, m);
        if (prev && distPointToSegment(pt, prev, abs) <= effRadius) return true;
        if (!prev && Math.hypot(pt.x - abs.x, pt.y - abs.y) <= effRadius) return true;
        prev = abs;
      }
    }
    return false;
  }
  return obj.containsPoint(pt, null, true);
}

// Converte um ponto em coordenadas do canvas (mesmo espaço de obj.left/top)
// para o referencial LOCAL do objeto — mesma origem (centro) e mesma escala
// (des-escalado) que o Fabric usa dentro de _render/_renderPathCommands.
// Verificado direto no fabric.js: toLocalPoint(p,'center','center') já
// rotaciona e centraliza, só falta desfazer a escala do próprio objeto.
function toEraseLocal(obj, canvasPt) {
  const p = obj.toLocalPoint(new fabric.Point(canvasPt.x, canvasPt.y), 'center', 'center');
  return { x: p.x / (obj.scaleX || 1), y: p.y / (obj.scaleY || 1) };
}
// Espessura do traço de apagar, em unidades LOCAIS do objeto (mesmo
// referencial de toEraseLocal). Usa só o tamanho escolhido da borracha —
// NÃO soma o strokeWidth do objeto aqui: isso forçaria um corte sempre tão
// largo quanto o traço original, impedindo uma borracha pequena/precisa
// (ex.: querer tirar só um pedacinho fino de um traço grosso). O alcance do
// hit-test (objectTouchedByEraser/effRadius) continua ampliado pelo
// strokeWidth pra detectar toque perto da borda do traço grosso — só a
// largura do corte em si fica sob controle total do usuário.
function eraseLocalWidth(obj, canvasWidth) {
  const avgScale = (Math.abs(obj.scaleX || 1) + Math.abs(obj.scaleY || 1)) / 2 || 1;
  return canvasWidth / avgScale;
}

function eraseAtPoint(p) {
  const radius = Math.max(2, sz) / 2;
  const touchedNow = new Set();
  eraserCandidates().forEach(o => {
    if (!objectTouchedByEraser(o, p, radius)) return;
    touchedNow.add(o);
    if (!o.eraseStrokes) o.eraseStrokes = [];
    if (!o._currentEraseStroke) {
      o._currentEraseStroke = { points: [], width: eraseLocalWidth(o, sz) };
      o.eraseStrokes.push(o._currentEraseStroke);
    }
    o._currentEraseStroke.points.push(toEraseLocal(o, p));
    o.dirty = true;
    eraserTouchedIds.add(o.id);
  });
  // Objeto que saiu de baixo do cursor encerra o traço corrente — evita que
  // uma futura reentrada no mesmo objeto "teleporte" uma linha reta ligando
  // dois pontos distantes do arraste.
  eraserActiveStrokeObjs.forEach(o => { if (!touchedNow.has(o)) o._currentEraseStroke = null; });
  eraserActiveStrokeObjs = touchedNow;
  // Preview ao vivo pros outros clientes/view verem o buraco aparecer durante
  // o próprio arraste, não só depois de soltar o mouse (objects:modify:commit
  // em finishEraserDrag só roda no fim, senão o Ctrl/Z perderia a granularidade
  // de "uma borrachada = uma ação").
  if (touchedNow.size) {
    throttle60(() => {
      // Emissão normal (não-volátil): em testes, o preview ao vivo via
      // socket.volatile.emit era descartado silenciosamente pelo transporte
      // real do navegador em boa parte das vezes (confirmado só chegando ao
      // vivo raramente/nunca na view, mesmo com o relay do servidor
      // comprovadamente correto em teste isolado). Como já é throttled a
      // ~60/s, o volume é baixo o bastante pra não precisar ser descartável.
      socket.emit('erase:live', [...touchedNow].map(o => ({ id: o.id, eraseStrokes: o.eraseStrokes })));
    });
  }
}

export function startEraserDrag(p) {
  eraserActive = true;
  eraserLastPoint = null;
  eraserTouchedIds = new Set();
  eraserActiveStrokeObjs = new Set();
  eraseAtPoint(p);
  eraserLastPoint = p;
  canvas.requestRenderAll();
}

// Chamada a cada mouse:move/touchmove enquanto a borracha está em arraste.
// Interpola entre o último ponto e o atual pra não deixar buracos no
// hit-test quando o mouse se move rápido (a linha entre os pontos já
// desenhada por objeto cobre o traço visual; o que falta é garantir que
// objetos finos no meio do caminho também sejam testados).
export function updateEraserDrag(p) {
  if (!eraserActive) return;
  if (eraserLastPoint) {
    const dx = p.x - eraserLastPoint.x, dy = p.y - eraserLastPoint.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(2, sz / 3);
    const steps = Math.min(64, Math.ceil(dist / step));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      eraseAtPoint({ x: eraserLastPoint.x + dx * t, y: eraserLastPoint.y + dy * t });
    }
  } else {
    eraseAtPoint(p);
  }
  eraserLastPoint = p;
  canvas.requestRenderAll();
}

// Fecha o arraste e emite UM único commit com todos os objetos tocados —
// assim o Ctrl+Z desfaz a borrachada inteira, não objeto por objeto.
export function finishEraserDrag() {
  if (!eraserActive) return;
  eraserActive = false;
  eraserLastPoint = null;
  eraserActiveStrokeObjs.forEach(o => { o._currentEraseStroke = null; });
  eraserActiveStrokeObjs = new Set();
  canvas.requestRenderAll();
  const updates = [...eraserTouchedIds].map(findById).filter(Boolean).map(ser).filter(Boolean);
  eraserTouchedIds = new Set();
  if (updates.length) {
    socket.emit('objects:modify:commit', updates);
    scheduleLayersUpdate();
  }
}
// Handlers de mouse/touch que ficaram em board-app.js (pan/staging) só leem
// `penActive` (nunca reatribuem) — precisam desse setter porque um binding
// importado só pode ser mutado por quem o exporta.
export function setPenActive(v) { penActive = v; }

export function getCanvasPoint(e) {
  const rect = canvas.upperCanvasEl.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches && e.touches.length > 0) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
  else if (e.changedTouches && e.changedTouches.length > 0) { clientX = e.changedTouches[0].clientX; clientY = e.changedTouches[0].clientY; }
  else { clientX = e.clientX; clientY = e.clientY; }
  const zoom = canvas.getZoom();
  const vpt  = canvas.viewportTransform;
  return {
    x: (clientX - rect.left - vpt[4]) / zoom,
    y: (clientY - rect.top  - vpt[5]) / zoom,
    clientX, clientY
  };
}

export function handlePointerDown(p, target) {
  if (isPanMode || spaceHeld) return;
  if (tool === 'eraser') {
    startEraserDrag(p);
    return;
  }
  if (tool === 'text') { addText(p); return; }
  if (tool === 'pen') {
    penActive = true;
    socket.emit('draw:start', { x: p.x, y: p.y, color, width: sz, opacity: op, layerId: activeLayerId });
    return;
  }
  if (['rect','circle','line','arrow'].includes(tool)) {
    isDrawing = true;
    drawStart = { x: p.x, y: p.y };
    tmpShapeId = genId();
    // Notifica outros clientes que uma forma começou a ser desenhada — eles vão
    // criar um preview local que acompanha o arraste em tempo real (mesmo
    // mecanismo do draw:start/move/end usado pela caneta livre).
    socket.emit('shape:start', {
      shapeId: tmpShapeId, tool, x: p.x, y: p.y,
      color, width: sz, opacity: op, fillShape, layerId: activeLayerId,
    });
  }
}

export function updateTmpShape(p) {
  if (!isDrawing || !drawStart) return;
  const prev = findById(tmpShapeId);
  if (prev) canvas.remove(prev);
  const sh = mkShape(tool, drawStart, p, tmpShapeId);
  if (!sh) return;
  canvas.add(sh);
  if (vpRect) canvas.bringToFront(vpRect);
  canvas.requestRenderAll();
  throttle60(() => {
    socket.emit('shape:move', { shapeId: tmpShapeId, x: p.x, y: p.y });
  });
}

export function handlePointerUp(p) {
  penActive = false;
  if (tool === 'eraser') { finishEraserDrag(); return; }
  if (!isDrawing) return;
  isDrawing = false;
  const prev = findById(tmpShapeId);
  if (prev) canvas.remove(prev);
  const dx = Math.abs(p.x - drawStart.x), dy = Math.abs(p.y - drawStart.y);
  if (dx > 3 || dy > 3) {
    const sh = mkShape(tool, drawStart, p, tmpShapeId);
    if (sh) {
      addToCanvas(sh);
      canvas.renderAll();
      emitFull(sh);
      // Avisa os outros clientes para removerem o preview temporário e mostra
      // o objeto final (mesmo padrão do draw:end da caneta livre).
      socket.emit('shape:end', { shapeId: tmpShapeId, object: ser(sh) });
    }
  } else {
    socket.emit('shape:cancel', { shapeId: tmpShapeId });
  }
  drawStart = null; tmpShapeId = null;
}

export function setTool(t) {
  // Sai do pan mode se estava nele
  if (isPanMode && t !== 'pan') exitPanMode();

  // Troca de ferramenta no meio de um arraste de borracha: fecha o traço
  // corrente em vez de deixar o estado "preso" (senão um mouse:move futuro
  // com outra ferramenta ativa nunca mais chamaria finishEraserDrag).
  if (eraserActive && t !== 'eraser') finishEraserDrag();

  tool = t;
  document.querySelectorAll('.tb-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('t-' + t); if (btn) btn.classList.add('active');
  const opts = document.getElementById('opts');
  isDrawing = false; drawStart = null;
  const prev = findById(tmpShapeId);
  if (prev) { canvas.remove(prev); canvas.renderAll(); socket.emit('shape:cancel', { shapeId: tmpShapeId }); }
  tmpShapeId = null;

  // Uma seleção que ficou "presa" de uma ação anterior bloqueia silenciosamente
  // o mouse:down de qualquer ferramenta de desenho (o guard abaixo checa
  // getActiveObjects().length > 0). Ao trocar para qualquer ferramenta que não
  // seja "select", garante que não sobrou nada selecionado.
  if (t !== 'select' && canvas.getActiveObjects().length > 0) {
    canvas.discardActiveObject();
    canvas.renderAll();
  }

  if (t === 'pan') {
    enterPanMode();
    opts.classList.add('hidden');
    layoutSidePanels();
    return;
  }
  if (t === 'select') {
    canvas.isDrawingMode = false; canvas.selection = true;
    canvas.skipTargetFind = false;
    canvas.defaultCursor = 'default'; opts.classList.add('hidden');
  } else if (t === 'pen') {
    canvas.isDrawingMode = true; canvas.selection = false;
    canvas.skipTargetFind = true;
    canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.freeDrawingBrush.color = color; canvas.freeDrawingBrush.width = sz;
    opts.classList.remove('hidden');
  } else {
    canvas.isDrawingMode = false; canvas.selection = false;
    // skipTargetFind impede que o Fabric selecione/arraste um objeto já
    // existente ao clicar em cima dele com uma ferramenta de desenho — o
    // clique deve sempre iniciar uma forma/texto novo (ou, no caso da
    // borracha, apagar), nunca selecionar/mover o que já está no board. A
    // borracha faz seu próprio hit-test (ver eraseAtPoint), não precisa mais
    // que o Fabric resolva um target — então também fica com
    // skipTargetFind:true, senão dava pra arrastar o objeto sendo apagado ao
    // mesmo tempo.
    canvas.skipTargetFind = true;
    canvas.defaultCursor = t === 'eraser' ? 'cell' : 'crosshair';
    opts.classList.remove('hidden');
  }

  // Mantém o painel de spawn, o painel view/ajuda (canto superior esquerdo),
  // o painel de propriedades do objeto selecionado (#ctx) e o painel de
  // Camadas todos coordenados entre si — ver layoutSidePanels().
  layoutSidePanels();
}

export function setColor(c, el) {
  color = c;
  document.querySelectorAll('.swatch').forEach(s => s.classList.remove('sel'));
  if (el) el.classList.add('sel');
  if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = c;
}
export function setSz(v) { sz = parseInt(v); document.getElementById('szv').textContent = v; if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.width = sz; }
export function setOp(v) { op = parseInt(v) / 100; document.getElementById('opv').textContent = v + '%'; if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.opacity = op; }
// setFillShape substitui a antiga atribuição direta `fillShape=this.checked`
// que existia inline no HTML — um handler inline não pode escrever direto
// numa variável de módulo, só chamar uma função exposta na ponte window.*
// (ver final de board-app.js).
export function setFillShape(v) { fillShape = v; }
