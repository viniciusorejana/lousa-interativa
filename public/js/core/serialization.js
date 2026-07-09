// ─── Serialização de objetos do canvas ────────────────────────────────────────
// Extraído de board-app.js. Módulo de baixo nível, quase sem dependências
// circulares — só precisa do `canvas` (pra calcular zIndex), importado
// diretamente de canvas-manager.js. Usado por praticamente todo o resto do
// editor (grupos, camadas, clipboard, streaming de formas) pra converter
// objetos Fabric em dados serializáveis (enviados por socket, salvos no
// histórico de undo/redo).
import { canvas } from './canvas-manager.js';

// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// SERIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

// Converte qualquer URL de imagem para path relativo (/uploads/arquivo.jpg).
// O estado compartilhado nunca deve conter localhost ou IP de quem fez upload.
function relativeImgPath(src) {
  if (!src || src.startsWith('blob:')) return '';
  // Já é relativo
  if (src.startsWith('/uploads/')) return src;
  // Absoluto (http://qualquer-host:porta/uploads/arquivo.jpg) → extrai só o path
  try {
    const u = new URL(src);
    if (u.pathname.startsWith('/uploads/')) return u.pathname;
  } catch (_) {}
  // Fallback: se contém /uploads/ em qualquer forma
  const idx = src.indexOf('/uploads/');
  if (idx !== -1) return src.slice(idx);
  return src;
}

// Converte path relativo para URL absoluta usando a origem do cliente atual.
// Chamado APENAS na hora de carregar — nunca no estado salvo.
export function absoluteImgUrl(src) {
  if (!src) return '';
  if (src.startsWith('blob:')) return '';
  if (src.startsWith('http://') || src.startsWith('https://')) {
    // Já absoluto mas com host diferente → reescreve com origem atual
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

function normalizeSerializedObj(j, fabricObj) {
  // Normaliza src de imagens (topo ou dentro de grupo)
  if (j.type === 'image') {
    if (j._isGif && (j._gifUrl || j.src)) {
      j.src     = relativeImgPath(j._gifUrl || j.src);
      j._gifUrl = j.src;
    } else if (fabricObj && fabricObj.getElement) {
      const el  = fabricObj.getElement();
      const raw = el ? el.src : (j.src || '');
      j.src = relativeImgPath(raw);
    } else {
      j.src = relativeImgPath(j.src || '');
    }
  }
  // Normaliza recursivamente os filhos de grupos
  if (j.type === 'group' && Array.isArray(j.objects)) {
    const children = fabricObj && fabricObj.getObjects ? fabricObj.getObjects() : [];
    j.objects = j.objects.map((childJ, i) => {
      normalizeSerializedObj(childJ, children[i] || null);
      return childJ;
    });
  }
  if (j.scaleX < 0) { j.flipX = !j.flipX; j.scaleX = Math.abs(j.scaleX); }
  if (j.scaleY < 0) { j.flipY = !j.flipY; j.scaleY = Math.abs(j.scaleY); }
  return j;
}

export function ser(obj) {
  if (obj._isViewportRect) return null;
  const j = obj.toJSON(['id', 'layerId', 'groupId', 'locked', 'viewHidden', '_isArrow', '_isGif', '_gifUrl']);
  normalizeSerializedObj(j, obj);
  j.zIndex = canvas.getObjects().filter(o => !o._isViewportRect).indexOf(obj);
  return j;
}

export function serTransform(obj) {
  return {
    id:     obj.id,
    type:   obj.type,
    left:   obj.left,
    top:    obj.top,
    scaleX: Math.abs(obj.scaleX || 1),
    scaleY: Math.abs(obj.scaleY || 1),
    angle:  obj.angle || 0,
    flipX:  obj.flipX || false,
    flipY:  obj.flipY || false,
    opacity: obj.opacity,
    zIndex: canvas.getObjects().filter(o => !o._isViewportRect).indexOf(obj),
  };
}

export function serTransformAbsolute(obj, groupMatrix) {
  const localMatrix = obj.calcOwnMatrix();
  const absMatrix   = fabric.util.multiplyTransformMatrices(groupMatrix, localMatrix);
  const d           = fabric.util.qrDecompose(absMatrix);
  const w   = (obj.width  || 0) * Math.abs(d.scaleX);
  const h   = (obj.height || 0) * Math.abs(d.scaleY);
  const rad = d.angle * Math.PI / 180;
  const left = d.translateX - (Math.cos(rad) * w / 2 - Math.sin(rad) * h / 2);
  const top  = d.translateY - (Math.sin(rad) * w / 2 + Math.cos(rad) * h / 2);
  return {
    id:     obj.id, type: obj.type, left, top,
    scaleX: Math.abs(d.scaleX), scaleY: Math.abs(d.scaleY),
    angle:  d.angle, flipX: d.scaleX < 0, flipY: d.scaleY < 0,
    opacity: obj.opacity,
    zIndex: canvas.getObjects().filter(o => !o._isViewportRect).indexOf(obj),
  };
}

