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
import {
  socket, vpRect, findById, genId, mkShape, addToCanvas, emitFull,
  throttle60, addText, isPanMode, spaceHeld, enterPanMode, exitPanMode,
  layoutSidePanels, scheduleLayersUpdate, activeLayerId,
} from '../../board-app.js';

export let tool = 'select', color = '#ffffff', sz = 4, op = 1, fillShape = false;
export let isDrawing = false, drawStart = null;
let tmpShapeId = null;
export let penActive = false;
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
    if (target && target.id && !target._isViewportRect) { const id = target.id; canvas.remove(target); canvas.renderAll();
      socket.emit('object:remove', [id]);
      scheduleLayersUpdate();
    }
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
    // clique deve sempre iniciar uma forma/texto novo, nunca selecionar o que
    // já está no board. A borracha é a exceção: ela precisa que o Fabric
    // identifique o objeto sob o cursor pra saber o que apagar.
    canvas.skipTargetFind = (t !== 'eraser');
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
