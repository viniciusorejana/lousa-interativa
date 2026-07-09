// Ações do painel de propriedades do objeto selecionado (#ctx): mudar cor,
// preenchimento, espessura, opacidade, redimensionar, excluir, mandar pra
// trás/frente e duplicar — tudo que atua sobre `canvas.getActiveObjects()`.
import { canvas } from '../core/canvas-manager.js';
import { ser, serTransformAbsolute } from '../core/serialization.js';
import { applyLayerZOrder } from '../features/layers/layers-panel.js';
import { socket, vpRect, scheduleLayersUpdate, emitModify, genId } from '../board-app.js';

function getSelObjs() {
  return canvas.getActiveObjects().filter(o => !o._isViewportRect);
}

// Emite modificação de objeto respeitando se está em activeSelection.
// IMPORTANTE: quando há activeSelection, o Fabric converte left/top dos filhos
// para coordenadas relativas — precisamos serializar com coordenadas absolutas.
function emitModifyWithAbsPos(o) {
  if (!o.id || o._isViewportRect) return;
  const active = canvas.getActiveObject();
  if (active && active.type === 'activeSelection') {
    // Objeto dentro de uma seleção múltipla — calcular posição absoluta
    const gm  = active.calcTransformMatrix();
    const abs = serTransformAbsolute(o, gm);
    const data = ser(o);
    if (!data) return;
    Object.assign(data, abs);
    socket.emit('object:modify:commit', data);
  } else {
    emitModify(o);
  }
}

export function setSelColor(val) {
  getSelObjs().forEach(o => {
    const isText = o.type === 'i-text' || o.type === 'text';
    if (isText) o.set({ fill: val });
    else        o.set({ stroke: val });
    emitModifyWithAbsPos(o);
  });
  canvas.renderAll();
}

export function setSelFill(val) {
  if (!document.getElementById('ctx-fill-on').checked) return;
  getSelObjs().forEach(o => { o.set({ fill: val }); emitModifyWithAbsPos(o); });
  canvas.renderAll();
}

export function toggleSelFill(checked) {
  const fillInput = document.getElementById('ctx-fill');
  fillInput.disabled = !checked;
  const fillVal = checked ? (fillInput.value || '#ffffff') : 'transparent';
  getSelObjs().forEach(o => { o.set({ fill: fillVal }); emitModifyWithAbsPos(o); });
  canvas.renderAll();
}

export function setSelStroke(val) {
  const n = parseInt(val);
  document.getElementById('ctx-sz-v').textContent = n;
  getSelObjs().forEach(o => { o.set({ strokeWidth: n }); emitModifyWithAbsPos(o); });
  canvas.renderAll();
}

export function resizeSel(d, v) {
  const o = canvas.getActiveObject(); if (!o || !v || o._isViewportRect) return;
  d === 'w' ? o.scaleToWidth(parseFloat(v)) : o.scaleToHeight(parseFloat(v));
  o.setCoords(); canvas.renderAll(); emitModifyWithAbsPos(o);
}

export function setSelOp(v) {
  document.getElementById('cop-v').textContent = v + '%';
  getSelObjs().forEach(o => { o.set({ opacity: parseInt(v) / 100 }); emitModifyWithAbsPos(o); });
  canvas.renderAll();
}

export function delSel() {
  const ids = canvas.getActiveObjects().filter(o => !o._isViewportRect).map(o => o.id).filter(Boolean);
  canvas.getActiveObjects().filter(o => !o._isViewportRect).forEach(o => canvas.remove(o));
  canvas.discardActiveObject(); canvas.renderAll();
  socket.emit('object:remove', ids);
  scheduleLayersUpdate();
}

export function sendBackFront(dir) {
  canvas.getActiveObjects().forEach(o => {
    if (o._isViewportRect) return;
    dir === 'back' ? canvas.sendToBack(o) : canvas.bringToFront(o);
  });
  if (vpRect) canvas.bringToFront(vpRect);
  canvas.renderAll();
  const order = canvas.getObjects().filter(o => o.id && !o._isViewportRect).map(o => o.id);
  socket.emit('zorder:sync', order);
  scheduleLayersUpdate();
}

export function dupSel() {
  const objs = canvas.getActiveObjects().filter(o => !o._isViewportRect); if (!objs.length) return; canvas.discardActiveObject();
  const clones = []; let done = 0;
  objs.forEach(o => o.clone(cl => {
    cl.id = genId(); cl.set({ left: o.left + 20, top: o.top + 20 });
    canvas.add(cl); clones.push(cl);
    if (++done === objs.length) {
      applyLayerZOrder();
      // Serializa ANTES de virar ActiveSelection (mesmo motivo do comentário
      // em pasteBoardObjects: o Fabric muda left/top pra relativo ao grupo
      // assim que a seleção múltipla é criada).
      const serialized = clones.map(ser).filter(Boolean);
      canvas.setActiveObject(new fabric.ActiveSelection(clones, { canvas }));
      canvas.renderAll();
      socket.emit('objects:batch', serialized);
      scheduleLayersUpdate();
    }
  }, ['id', 'layerId', '_isArrow', '_isGif', '_gifUrl', 'eraseStrokes']));
}
