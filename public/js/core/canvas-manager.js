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
  // Hit-test por pixel real em vez do retângulo de bounding box — sem isso,
  // um traço fino tem uma área clicável muito maior que o próprio desenho,
  // impedindo selecionar o que está embaixo. Não afeta o retângulo de
  // transformação/handles, que continua vindo de aCoords normalmente.
  perPixelTargetFind: true,
  targetFindTolerance: 4,
});

// ── Seleção ativa: arrastar a partir de qualquer ponto do retângulo ───────────
// perPixelTargetFind (acima) deixa o CLIQUE inicial preciso (não rouba o
// traço fino que está embaixo de outra coisa). Só que o Fabric testa isso com
// um OR — `canvas.perPixelTargetFind || obj.perPixelTargetFind` (ver
// Canvas.prototype._checkTarget no fabric.js) — então ligar isso no canvas
// força pixel-perfeito pra TODO objeto, e um `obj.perPixelTargetFind = false`
// no objeto ativo não tem efeito nenhum (o OR sempre vence pro lado do
// canvas). O ajuste então precisa ser no canvas mesmo — mas não dá pra fazer
// isso reagindo ao 'mouse:down:before': o Fabric já resolve o target (chama
// findTarget, lendo perPixelTargetFind) dentro de _cacheTransformEventData,
// ANTES desse evento disparar. A única forma de ter o valor certo já pronto
// a tempo é atualizar a cada 'mouse:move' (hover), que roda a cada vez que o
// mouse passa por cima de algo — assim, quando o mousedown finalmente
// acontece, o valor computado no último hover já está setado: dentro da
// caixa do que está selecionado → bounding box (arrasta de qualquer ponto);
// fora dela → pixel-perfeito (não rouba seleção de um traço fino vizinho).
function updatePerPixelForHover(evtOpts) {
  const active = canvas.getActiveObject();
  // e.pointer já vem pronto (espaço de tela, ignora zoom/pan) nos eventos de
  // mouse:move; para selection:created/updated (sem .pointer) recalcula a
  // partir do evento nativo, se houver um (seleção programática sem clique
  // não tem — nesse caso só fica precisa até o próximo hover).
  const p = (evtOpts && evtOpts.pointer) || (evtOpts && evtOpts.e && canvas.getPointer(evtOpts.e, true));
  if (!active || !p) { canvas.perPixelTargetFind = true; return; }
  const b = active.getBoundingRect(false, true); // inclui viewportTransform (espaço de tela)
  const inBox = p.x >= b.left && p.x <= b.left + b.width && p.y >= b.top && p.y <= b.top + b.height;
  canvas.perPixelTargetFind = !inBox;
}
canvas.on('mouse:move', updatePerPixelForHover);
canvas.on('selection:created', updatePerPixelForHover);
canvas.on('selection:updated', updatePerPixelForHover);
canvas.on('selection:cleared', () => { canvas.perPixelTargetFind = true; });

// ── Seleção por retângulo (marquee): não pegar traços finos só porque a
// bounding box deles cruza o retângulo ────────────────────────────────────────
// O Fabric decide quem entra na seleção comparando o retângulo arrastado
// contra a bounding box (aCoords) de cada objeto — para um traço fino e
// comprido, essa caixa é bem maior que o desenho real, então um retângulo
// que nem chega perto do traço ainda assim o seleciona. Depois que o Fabric
// monta a ActiveSelection, refazemos a checagem amostrando os pontos reais
// do path (via calcTransformMatrix) contra o retângulo, e removemos da
// seleção quem só tinha a caixa cruzando, sem o traço em si passar por lá.
let _marqueeStart = null;
canvas.on('mouse:down', e => { _marqueeStart = e.target ? null : canvas.getPointer(e.e); });
canvas.on('mouse:up', e => {
  const start = _marqueeStart;
  _marqueeStart = null;
  if (!start) return;
  const active = canvas.getActiveObject();
  if (!active || active.type !== 'activeSelection') return;
  const end = canvas.getPointer(e.e);
  const rect = {
    left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x), bottom: Math.max(start.y, end.y),
  };
  if (rect.right - rect.left < 3 && rect.bottom - rect.top < 3) return; // clique, não arraste
  const members = active.getObjects();
  const kept = members.filter(o => touchesMarqueeRect(o, rect));
  if (kept.length === members.length) return; // nada a podar
  canvas.discardActiveObject();
  if (kept.length === 1) canvas.setActiveObject(kept[0]);
  else if (kept.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(kept, { canvas }));
  canvas.requestRenderAll();
});

// Só refina fabric.Path (o caso real do problema: traço fino). Outras formas
// (retângulo, elipse, imagem) mantêm o comportamento padrão do Fabric — a
// bounding box delas já é essencialmente a própria forma visível.
function touchesMarqueeRect(obj, rect) {
  if (obj.type !== 'path' || !Array.isArray(obj.path)) return true;
  const m   = obj.calcTransformMatrix();
  const off = obj.pathOffset || { x: 0, y: 0 };
  for (const cmd of obj.path) {
    for (let i = 1; i < cmd.length; i += 2) {
      const pt = fabric.util.transformPoint({ x: cmd[i] - off.x, y: cmd[i + 1] - off.y }, m);
      if (pt.x >= rect.left && pt.x <= rect.right && pt.y >= rect.top && pt.y <= rect.bottom) return true;
    }
  }
  return false;
}

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
