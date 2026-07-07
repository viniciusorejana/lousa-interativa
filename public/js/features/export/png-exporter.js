// ─── Exportação de PNG (objeto único, seleção, ou board inteiro) ─────────────
// Extraído de board-app.js. `showToast`, `objectNames`, `vpW`, `vpH` importados
// de volta de board-app.js (import circular seguro — só usados dentro de
// corpo de função; ver ARCHITECTURE.md).
import { canvas } from '../../core/canvas-manager.js';
import { showToast, objectNames, vpW, vpH } from '../../board-app.js';

// ── Exportar PNG ──────────────────────────────────────────────────────────────
// 3 modos: objeto único, seleção/grupo (vários objetos), board inteiro (viewport).
// Sempre fundo transparente, sem incluir o retângulo guia do viewport.

function _downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Renderiza a bounding box exata de um conjunto de objetos (seleção, grupo, ou
// objeto único) para um data URL PNG, sem baixar nada — usado tanto pelo export
// para arquivo quanto pela cópia para a área de transferência do sistema.
// Usa canvas.toDataURL com left/top/width/height = bounding box absoluta dos objetos,
// e multiplier=1 para exportar no tamanho exato em que estão no board.
function renderObjectsAsDataURL(objects) {
  const targets = objects.filter(o => !o._isViewportRect);
  if (!targets.length) return null;

  // Para obter a bounding box correta no espaço lógico do canvas:
  // - 1 objeto ou grupo real → usa os aCoords do próprio objeto
  // - seleção múltipla (ActiveSelection) → o canvas.getActiveObject() É o
  //   ActiveSelection (subclasse de Group) e tem seus próprios aCoords que
  //   envolvem TODOS os filhos — exatamente como um grupo real funciona
  const activeObj = canvas.getActiveObject();
  const source = (activeObj && !activeObj._isViewportRect) ? activeObj : targets[0];
  source.setCoords();

  const coords = source.aCoords; // { tl, tr, bl, br } em coords do canvas
  let minX, minY, maxX, maxY;

  if (coords) {
    const pts = [coords.tl, coords.tr, coords.bl, coords.br];
    minX = Math.min(...pts.map(p => p.x));
    minY = Math.min(...pts.map(p => p.y));
    maxX = Math.max(...pts.map(p => p.x));
    maxY = Math.max(...pts.map(p => p.y));
  } else {
    // Fallback: itera filhos individualmente
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
    targets.forEach(o => {
      o.setCoords();
      const c = o.aCoords;
      if (c) {
        [c.tl, c.tr, c.bl, c.br].forEach(pt => {
          minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
          maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
        });
      }
    });
  }

  const w = Math.max(1, Math.ceil(maxX - minX));
  const h = Math.max(1, Math.ceil(maxY - minY));

  // Esconde objetos que não fazem parte do export
  const allObjs = canvas.getObjects();
  const prevVisible = new Map();
  allObjs.forEach(o => {
    prevVisible.set(o, o.visible);
    if (o._isViewportRect || !targets.includes(o)) o.visible = false;
  });

  const prevBg  = canvas.backgroundColor;
  const prevVpt = canvas.viewportTransform.slice();
  canvas.backgroundColor = '';
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.renderAll();

  const dataUrl = canvas.toDataURL({
    format: 'png',
    left: minX, top: minY, width: w, height: h,
    multiplier: 1,
  });

  canvas.setViewportTransform(prevVpt);
  allObjs.forEach(o => { o.visible = prevVisible.get(o); o.setCoords(); });
  canvas.backgroundColor = prevBg;
  canvas.renderAll();

  return dataUrl;
}

function exportObjectsAsPNG(objects, filename) {
  const dataUrl = renderObjectsAsDataURL(objects);
  if (!dataUrl) { showToast('Nada selecionado para exportar.', 2500); return; }
  _downloadDataUrl(dataUrl, filename);
}

// Exporta o board inteiro na área do viewport (ex: 1920×1080), com todos os
// objetos nas posições em que estão, fundo transparente, sem o retângulo guia.
function exportBoardAsPNG() {
  const allObjs = canvas.getObjects();
  const prevVisible = new Map();
  allObjs.forEach(o => {
    prevVisible.set(o, o.visible);
    if (o._isViewportRect) o.visible = false;
  });

  const prevBg = canvas.backgroundColor;
  canvas.backgroundColor = '';

  const prevVpt = canvas.viewportTransform.slice();
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.renderAll();

  const dataUrl = canvas.toDataURL({
    format: 'png',
    left: 0, top: 0, width: vpW, height: vpH,
    multiplier: 1,
  });

  canvas.setViewportTransform(prevVpt);
  allObjs.forEach(o => { o.visible = prevVisible.get(o); });
  canvas.backgroundColor = prevBg;
  canvas.renderAll();

  _downloadDataUrl(dataUrl, `lousa-${Date.now()}.png`);
}

// Decide automaticamente qual modo usar baseado na seleção atual:
// nenhuma seleção → exporta o board inteiro (viewport);
// 1 objeto selecionado → exporta aquele objeto;
// 2+ objetos selecionados (ou um grupo) → exporta a bounding box da seleção.
function exportSelectionOrBoardAsPNG() {
  const active = canvas.getActiveObjects().filter(o => !o._isViewportRect);
  if (active.length === 0) {
    exportBoardAsPNG();
  } else if (active.length === 1) {
    const name = (objectNames[active[0].id] || active[0].type || 'objeto').replace(/[^\w\-]+/g, '_');
    exportObjectsAsPNG(active, `${name}-${Date.now()}.png`);
  } else {
    exportObjectsAsPNG(active, `selecao-${Date.now()}.png`);
  }
}

export { renderObjectsAsDataURL, exportObjectsAsPNG, exportBoardAsPNG, exportSelectionOrBoardAsPNG };
