// ─── Agrupar / Desagrupar objetos ─────────────────────────────────────────────
// Extraído de board-app.js. Import circular controlado com board-app.js (só
// usado dentro de corpo de função — ver ARCHITECTURE.md).
import { canvas } from '../../core/canvas-manager.js';
import {
  showToast, activeLayerId, genId, typeCounters, objectNames, vpRect,
  socket, ser, assignDefaultName, scheduleLayersUpdate,
} from '../../board-app.js';

// ── Toolbar: habilita botões ──────────────────────────────────────────────────
function updateLayerToolbar() {
  const btnG = document.getElementById('lt-group');
  const btnU = document.getElementById('lt-ungroup');
  if (!btnG) return;
  const selObjs = canvas.getActiveObjects().filter(o => !o._isViewportRect);
  const hasGif  = selObjs.some(o => o._isGif);
  btnG.disabled = selObjs.length < 2 || hasGif;
  const single = canvas.getActiveObject();
  btnU.disabled = !(single?.type === 'group');
}

// ── Agrupar / Desagrupar ──────────────────────────────────────────────────────
function groupSelected() {
  let targets = canvas.getActiveObjects().filter(o => !o._isViewportRect);
  if (targets.length < 2) return;

  // GIFs não podem ser agrupados
  if (targets.some(o => o._isGif)) {
    showToast('GIFs animados não podem ser agrupados.', 2500);
    return;
  }

  const layId  = targets[0].layerId || activeLayerId;
  const oldIds = targets.map(o => o.id).filter(Boolean);

  canvas.discardActiveObject();
  const sel = new fabric.ActiveSelection(targets, { canvas });
  canvas.setActiveObject(sel);
  const group = sel.toGroup();
  group.id      = genId();
  group.layerId = layId;
  typeCounters['Grupo'] = (typeCounters['Grupo'] || 0) + 1;
  objectNames[group.id] = `Grupo ${typeCounters['Grupo']}`;
  if (vpRect) canvas.bringToFront(vpRect);
  canvas.discardActiveObject();
  canvas.setActiveObject(group);
  canvas.renderAll();

  const zorder = canvas.getObjects().filter(o => o.id && !o._isViewportRect).map(o => o.id);
  // Operação atômica — 1 único pushUndo no servidor
  socket.emit('group:commit', { group: ser(group), childIds: oldIds, zorder });
  scheduleLayersUpdate();
}

function ungroupSelected() {
  const groupObj = canvas.getActiveObject();
  if (!groupObj || groupObj.type !== 'group') return;
  const groupId = groupObj.id;
  const layId   = groupObj.layerId || activeLayerId;

  const groupMatrix    = groupObj.calcTransformMatrix();
  const childSnapshots = (groupObj.getObjects ? groupObj.getObjects() : []).map(ch => {
    const localMatrix = ch.calcOwnMatrix();
    const absMatrix   = fabric.util.multiplyTransformMatrices(groupMatrix, localMatrix);
    const decomp      = fabric.util.qrDecompose(absMatrix);
    return { obj: ch, left: decomp.translateX, top: decomp.translateY,
      scaleX: Math.abs(decomp.scaleX), scaleY: Math.abs(decomp.scaleY),
      angle: decomp.angle, flipX: decomp.scaleX < 0, flipY: decomp.scaleY < 0 };
  });

  canvas.discardActiveObject();
  canvas.setActiveObject(groupObj);
  groupObj.toActiveSelection();
  canvas.discardActiveObject();

  const serializedChildren = [];
  childSnapshots.forEach(snap => {
    const ch = snap.obj;
    if (!ch.id) ch.id = genId();
    ch.layerId = layId;

    const rad    = (snap.angle || 0) * Math.PI / 180;
    const sw     = (ch.width  || 0) * snap.scaleX;
    const sh     = (ch.height || 0) * snap.scaleY;
    const leftTL = snap.left - (Math.cos(rad) * sw / 2 - Math.sin(rad) * sh / 2);
    const topTL  = snap.top  - (Math.sin(rad) * sw / 2 + Math.cos(rad) * sh / 2);

    ch.set({ originX: 'left', originY: 'top', left: leftTL, top: topTL,
      scaleX: snap.scaleX, scaleY: snap.scaleY, angle: snap.angle,
      flipX: snap.flipX, flipY: snap.flipY });
    ch.setCoords();
    assignDefaultName(ch);
    const s = ser(ch);
    if (s) serializedChildren.push(s);
  });

  if (vpRect) canvas.bringToFront(vpRect);
  canvas.renderAll();

  const zorder = canvas.getObjects().filter(o => o.id && !o._isViewportRect).map(o => o.id);
  // Operação atômica — 1 único pushUndo no servidor
  socket.emit('ungroup:commit', { groupId, children: serializedChildren, zorder });
  scheduleLayersUpdate();
}

export { updateLayerToolbar, groupSelected, ungroupSelected };
