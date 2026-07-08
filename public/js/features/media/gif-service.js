// ─── Subsistema de GIFs animados ──────────────────────────────────────────────
// Extraído de board-app.js. Depende de alguns helpers genéricos que ainda
// vivem no módulo de entrada (board-app.js) — import "circular" de propósito,
// e seguro aqui: nenhum desses bindings é lido no nível superior deste
// arquivo (só dentro de corpos de função, chamados depois que todos os
// módulos já terminaram de avaliar). Ver ARCHITECTURE.md para o racional
// completo desse padrão.
import { canvas } from '../../core/canvas-manager.js';
import { absoluteImgUrl } from '../../core/serialization.js';
import { placeNewImage } from '../spawn-area/staging-area.js';
import {
  genId, activeLayerId, addToCanvas, emitFull, hideToast,
  uploadFile,
} from '../../board-app.js';

// ── Imagens e GIFs animados ───────────────────────────────────────────────────
// GIFs são decodificados num WebWorker (gif.worker.js) fora da thread principal.
// O Worker retorna frames como ImageBitmap[] + delays via postMessage.
// Um único loop requestAnimationFrame global redesenha todos os GIFs ativos
// no mesmo tick, sem múltiplos rAF concorrentes.

function isGifUrl(url) {
  if (!url) return false;
  return url.toLowerCase().split('?')[0].endsWith('.gif');
}

// ── Worker singleton ──────────────────────────────────────────────────────────
const _gifWorker = new Worker('/gif.worker.js');

// Mapa de callbacks pendentes: workerRequestId → { resolve, reject }
const _gifPending = new Map();
let _gifReqId = 0;

_gifWorker.onmessage = function(e) {
  const { id, frames, canvasW, canvasH, error } = e.data;
  const cb = _gifPending.get(id);
  if (!cb) return;
  _gifPending.delete(id);
  if (error) cb.reject(new Error(error));
  else       cb.resolve({ frames, canvasW, canvasH });
};

function decodeGifInWorker(url) {
  return new Promise((resolve, reject) => {
    const id = ++_gifReqId;
    _gifPending.set(id, { resolve, reject });
    _gifWorker.postMessage({ id, url });
  });
}

// ── Registro de GIFs ativos ───────────────────────────────────────────────────
// gifId → { fabricImg, frames:[{bitmap,delay}], frameIdx, lastTime }
const _gifRegistry = new Map();

// Conjunto legado para compatibilidade com o código de remoção
const activeGifs = { add: id => {}, delete: id => { _gifRegistry.delete(id); }, size: 0 };

// Loop único global — um único rAF para TODOS os GIFs
let _rafId = null;

function _gifTick(now) {
  if (_gifRegistry.size === 0) { _rafId = null; return; }
  _rafId = requestAnimationFrame(_gifTick);

  let needsRender = false;

  _gifRegistry.forEach((state, gifId) => {
    const { fabricImg, frames } = state;
    if (!frames || frames.length === 0) return;

    const elapsed = now - state.lastTime;
    const cur     = frames[state.frameIdx];

    if (elapsed >= cur.delay) {
      // Avança para o próximo frame
      state.frameIdx = (state.frameIdx + 1) % frames.length;
      state.lastTime = now;

      // Atualiza o elemento canvas interno do Fabric com o novo bitmap
      const nextBitmap = frames[state.frameIdx].bitmap;
      fabricImg._element = nextBitmap;   // Fabric usa _element para renderizar
      if (fabricImg._originalElement !== undefined) {
        fabricImg._originalElement = nextBitmap;
      }
      needsRender = true;
    }
  });

  if (needsRender) canvas.requestRenderAll();
}

function _ensureGifLoop() {
  if (!_rafId) {
    _rafId = requestAnimationFrame(_gifTick);
  }
}

// ── Cria objeto Fabric a partir dos frames decodificados ──────────────────────
function _buildFabricGif(frames, canvasW, canvasH, existingData, relUrl) {
  return new Promise((resolve) => {
    // Cria um ImageBitmap inicial para o Fabric
    const firstBitmap = frames[0].bitmap;

    // fabric.Image aceita um CanvasImageSource (ImageBitmap é válido)
    const fabricImg = new fabric.Image(firstBitmap, {
      left:    0,
      top:     0,
      id:      existingData ? existingData.id      : genId(),
      layerId: existingData ? existingData.layerId : activeLayerId,
      _gifUrl: relUrl,
      _isGif:  true,
      // Fabric usa width/height do elemento; forçamos as dimensões do GIF
      width:   canvasW,
      height:  canvasH,
    });

    if (existingData) {
      fabricImg.set({
        left:    existingData.left    ?? 0,
        top:     existingData.top     ?? 0,
        scaleX:  existingData.scaleX  ?? 1,
        scaleY:  existingData.scaleY  ?? 1,
        angle:   existingData.angle   ?? 0,
        opacity: existingData.opacity ?? 1,
        flipX:   existingData.flipX   ?? false,
        flipY:   existingData.flipY   ?? false,
      });
    } else {
      const maxW = (window.innerWidth * 0.5) / canvas.getZoom();
      const s    = canvasW > maxW ? maxW / canvasW : 1;
      fabricImg.scale(s);
      placeNewImage(fabricImg);
    }

    fabricImg.setCoords();

    // Registra no registry de animação
    _gifRegistry.set(fabricImg.id, {
      fabricImg,
      frames,
      frameIdx: 0,
      lastTime: performance.now(),
    });
    _ensureGifLoop();

    resolve(fabricImg);
  });
}

// ── API pública ───────────────────────────────────────────────────────────────

async function placeGif(url, existingData) {
  const absUrl = absoluteImgUrl(url);
  const relUrl = url;

  // Decodifica no Worker
  let frames, canvasW, canvasH;
  try {
    ({ frames, canvasW, canvasH } = await decodeGifInWorker(absUrl));
  } catch (workerErr) {
    // Fallback: usa <img> nativa (apenas primeiro frame em alguns browsers)
    console.warn('[GIF] Worker falhou, usando fallback nativo:', workerErr);
    return _gifFallback(absUrl, relUrl, existingData);
  }

  if (!frames || frames.length === 0) {
    return _gifFallback(absUrl, relUrl, existingData);
  }

  return _buildFabricGif(frames, canvasW, canvasH, existingData, relUrl);
}

// Fallback usando <img> nativa (anima apenas se o browser suportar no canvas)
function _gifFallback(absUrl, relUrl, existingData) {
  return new Promise((resolve, reject) => {
    const imgEl = new Image();
    imgEl.crossOrigin = 'anonymous';
    imgEl.onload = () => {
      const fabricImg = new fabric.Image(imgEl, {
        left:    0, top: 0,
        id:      existingData ? existingData.id      : genId(),
        layerId: existingData ? existingData.layerId : activeLayerId,
        _gifUrl: relUrl, _isGif: true,
      });
      if (existingData) {
        fabricImg.set({
          left: existingData.left ?? 0, top: existingData.top ?? 0,
          scaleX: existingData.scaleX ?? 1, scaleY: existingData.scaleY ?? 1,
          angle: existingData.angle ?? 0, opacity: existingData.opacity ?? 1,
          flipX: existingData.flipX ?? false, flipY: existingData.flipY ?? false,
        });
      } else {
        const maxW = (window.innerWidth * 0.5) / canvas.getZoom();
        const s = imgEl.naturalWidth > maxW ? maxW / imgEl.naturalWidth : 1;
        fabricImg.scale(s);
        placeNewImage(fabricImg);
      }
      fabricImg.setCoords();
      resolve(fabricImg);
    };
    imgEl.onerror = () => reject(new Error('Falha ao carregar GIF: ' + absUrl));
    imgEl.src = absUrl;
  });
}

async function placeImageFromUrl(url) {
  if (isGifUrl(url)) {
    return placeGif(url, null);
  }
  return new Promise(resolve => {
    fabric.Image.fromURL(absoluteImgUrl(url), img => {
      img.id = genId();
      placeNewImage(img);
      resolve(img);
    }, { crossOrigin: 'anonymous' });
  });
}

async function insertImg(inp) {
  const file = inp.files[0]; if (!file) return; inp.value = '';
  try {
    const url = await uploadFile(file);
    const img = await placeImageFromUrl(url);  // placeImageFromUrl já trata GIFs
    addToCanvas(img);
    canvas.setActiveObject(img); canvas.renderAll(); emitFull(img); hideToast();
  } catch (e) { hideToast(); alert('Erro: ' + e.message); }
}

export { isGifUrl, placeGif, placeImageFromUrl, insertImg, activeGifs };
