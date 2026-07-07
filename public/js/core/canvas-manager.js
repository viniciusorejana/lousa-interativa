// ─── Canvas principal do board (Fabric.js) ────────────────────────────────────
// Módulo ES real: cria o fabric.Canvas e cuida do resize da janela. Exporta a
// instância `canvas` — é o único fabric.Canvas do board, então um módulo
// simples com export nomeado é suficiente (não precisa de uma classe/fábrica,
// já que só existe uma instância por página).
export const canvas = new fabric.Canvas('board', {
  width: window.innerWidth, height: window.innerHeight,
  selection: true, renderOnAddRemove: false,
  enableRetinaScaling: true, backgroundColor: '#1e1e2a',
  allowTouchScrolling: false,
});

// `onViewportRectRedraw` é injetado pelo board-app.js (depende de estado de
// viewport definido lá) — evita import circular entre canvas-manager e o
// módulo que desenha o retângulo de viewport.
let _onResize = null;
export function setResizeHook(fn) { _onResize = fn; }

window.addEventListener('resize', () => {
  canvas.setWidth(window.innerWidth);
  canvas.setHeight(window.innerHeight);
  canvas.renderAll();
  if (_onResize) _onResize();
});
