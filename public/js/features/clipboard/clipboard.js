// ─── Clipboard: paste, drag-and-drop e copiar/colar interno ──────────────────
// Tudo passa pelo clipboard do sistema (evento 'paste' nativo do navegador),
// não existe clipboard interno próprio do board. Ao copiar (copySel), grava no
// clipboard do sistema tanto uma imagem PNG da seleção (para colar em qualquer
// outro app) quanto os dados originais dos objetos, escondidos dentro do
// text/html sob o marcador BOARD_CLIPBOARD_MARKER. Ao colar, se esse marcador
// estiver presente, reconstruímos os objetos originais (editáveis); caso
// contrário, tratamos como imagem/URL externa normalmente (drop tem a mesma
// lógica de resolução de URL/arquivo).
import { canvas } from '../../core/canvas-manager.js';
import { ser } from '../../core/serialization.js';
import { renderObjectsAsDataURL } from '../export/png-exporter.js';
import { isGifUrl, placeGif, placeImageFromUrl } from '../media/gif-service.js';
import { activeLayerId, assignDefaultName, scheduleLayersUpdate, isLayerLocked } from '../layers/layers-panel.js';
import { imageSpawnMode, placeStagingGroup, stagingRect } from '../spawn-area/staging-area.js';
// Import circular com board-app.js — bindings usados só dentro de corpo de
// função (nunca no nível superior do módulo), ver regra em CLAUDE.md.
import {
  socket, vpRect, deser, genId,
  emitFull, addToCanvas, showToast, hideToast, uploadFile,
} from '../../board-app.js';

// ── Helpers de inserção de imagem externa ─────────────────────────────────────
async function insertFromExternalUrl(rawUrl, dropPos) {
  const url = rawUrl.trim();
  const imgUrlRe = /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i;
  if (!imgUrlRe.test(url) && !dropPos) return false; // só exige extensão no paste; drop tenta qualquer src
  if (isLayerLocked(activeLayerId)) {
    showToast('Camada travada — destrave para criar objetos aqui.', 2500);
    return false;
  }

  showToast('Carregando imagem...');
  try {
    const proxyUrl = '/api/img-proxy?url=' + encodeURIComponent(url);
    if (isGifUrl(url)) {
      const gif = await placeGif(proxyUrl, dropPos || null);
      if (dropPos) {
        gif.set({ left: dropPos.x - gif.getScaledWidth()/2, top: dropPos.y - gif.getScaledHeight()/2 });
        gif.setCoords();
      }
      addToCanvas(gif);
      canvas.setActiveObject(gif); canvas.renderAll(); emitFull(gif); hideToast();
    } else {
      const r = await fetch(proxyUrl);
      if (!r.ok) throw new Error('Status ' + r.status);
      const blob = await r.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Não é uma imagem');
      const ext  = url.split('?')[0].split('.').pop().toLowerCase() || 'png';
      const file = new File([blob], 'imagem.' + ext, { type: blob.type });
      const uploadUrl = await uploadFile(file);
      const img = await placeImageFromUrl(uploadUrl);
      if (dropPos) {
        img.set({ left: dropPos.x - img.getScaledWidth()/2, top: dropPos.y - img.getScaledHeight()/2 });
        img.setCoords();
      }
      addToCanvas(img);
      canvas.setActiveObject(img); canvas.renderAll(); emitFull(img); hideToast();
    }
    return true;
  } catch (err) {
    hideToast();
    alert('Erro ao carregar imagem: ' + err.message);
    return false;
  }
}

// ── Paste ─────────────────────────────────────────────────────────────────────
window.addEventListener('paste', async e => {
  // Não intercepta colagem de texto normal em campos de edição (inputs,
  // textarea, contentEditable — inclui a textarea oculta que o Fabric usa
  // para edição de texto no board).
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

  // 1. Dados de objetos do board colados via clipboard do sistema (copiados
  //    dentro do próprio LiveBoard, nesta ou em outra sessão/aba). Tem
  //    prioridade sobre a imagem: reconstrói os objetos originais e editáveis.
  const html = e.clipboardData?.getData('text/html') || '';
  const boardMatch = html.match(BOARD_CLIPBOARD_RE);
  if (boardMatch) {
    e.preventDefault();
    try {
      const data = JSON.parse(b64DecodeUtf8(boardMatch[1]));
      await pasteBoardObjects(data);
    } catch (err) {
      console.error('Falha ao colar objetos do board:', err);
    }
    return;
  }

  const items = Array.from(e.clipboardData?.items || []);

  // 2. Arquivo de imagem no clipboard (screenshot, Ctrl+C de imagem, ou PNG
  //    copiado deste próprio board sem o marcador acima — ex: colado em outra
  //    aba/dispositivo onde o texto/html não foi preservado)
  const imgFile = items.find(i => i.type.startsWith('image/'));
  if (imgFile) {
    e.preventDefault();
    if (isLayerLocked(activeLayerId)) {
      showToast('Camada travada — destrave para criar objetos aqui.', 2500);
      return;
    }
    try {
      const url = await uploadFile(imgFile.getAsFile());
      const img = await placeImageFromUrl(url);
      addToCanvas(img);
      canvas.setActiveObject(img); canvas.renderAll(); emitFull(img); hideToast();
    } catch (err) { hideToast(); alert('Erro: ' + err.message); }
    return;
  }

  // 3. URL de imagem colada como texto (colar link)
  const imgUrlRe = /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i;
  const text = (e.clipboardData.getData('text/plain') || '').trim();
  if (imgUrlRe.test(text)) {
    e.preventDefault();
    await insertFromExternalUrl(text, null);
  }
});

// ── Drag-and-drop ─────────────────────────────────────────────────────────────
// IMPORTANTE: o Fabric.js envolve o <canvas> original num wrapperEl e cria um
// upper-canvas por cima dele — é o upper-canvas que recebe todos os eventos de
// ponteiro. Ligar dragover/drop no elemento <canvas> original nunca funciona;
// precisa ser no wrapperEl (contêiner pai comum a lower e upper canvas).
const _boardEl = canvas.wrapperEl;

// Proteção global: impede que o browser abra a imagem em nova aba/navegue caso
// o usuário solte fora da área exata do canvas (fora do wrapperEl).
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { if (e.target !== _boardEl && !_boardEl.contains(e.target)) e.preventDefault(); });

_boardEl.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

_boardEl.addEventListener('drop', async e => {
  e.preventDefault();
  e.stopPropagation();

  const rect = _boardEl.getBoundingClientRect();
  const zoom = canvas.getZoom();
  const vpt  = canvas.viewportTransform;
  const dropPos = {
    x: (e.clientX - rect.left - vpt[4]) / zoom,
    y: (e.clientY - rect.top  - vpt[5]) / zoom,
  };

  // 1. Arquivo(s) do sistema operacional
  const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
  if (files.length) {
    if (isLayerLocked(activeLayerId)) {
      showToast('Camada travada — destrave para criar objetos aqui.', 2500);
      return;
    }
    for (const file of files) {
      try {
        showToast('Enviando...');
        const url = await uploadFile(file);
        const img = await placeImageFromUrl(url);
        img.set({ left: dropPos.x - img.getScaledWidth()/2, top: dropPos.y - img.getScaledHeight()/2 });
        img.setCoords();
        addToCanvas(img); canvas.setActiveObject(img); canvas.renderAll(); emitFull(img); hideToast();
      } catch (err) { hideToast(); alert('Erro: ' + err.message); }
    }
    return;
  }

  // 2. Imagem arrastada de outra aba — extrai src do HTML ou URI
  const html    = e.dataTransfer.getData('text/html') || '';
  const srcMatch = html.match(/src=["']([^"']+)["']/i);
  const uriList  = e.dataTransfer.getData('text/uri-list') || '';
  const plainUrl = e.dataTransfer.getData('text/plain') || '';
  const srcUrl   = (srcMatch && srcMatch[1]) || uriList.split('\n')[0].trim() || plainUrl.trim();

  if (srcUrl && srcUrl.startsWith('http')) {
    await insertFromExternalUrl(srcUrl, dropPos);
  }
});

// ── Copiar / Colar ──────────────────────────────────────────────────────────────
// Usa exclusivamente o clipboard do sistema (navigator.clipboard / evento
// 'paste'), sem clipboard interno próprio. Ao copiar, grava no clipboard do
// sistema DUAS representações da mesma seleção:
//   - image/png  → a seleção renderizada como imagem (igual ao "Exportar PNG"),
//                   para colar em qualquer outro app (Word, WhatsApp, etc.)
//   - text/html  → os dados originais dos objetos (serializados), escondidos
//                   sob o marcador BOARD_CLIPBOARD_MARKER dentro de um
//                   comentário HTML. Ao colar de volta no board, esses dados
//                   têm prioridade e reconstroem os objetos originais,
//                   editáveis — não apenas a imagem.
const BOARD_CLIPBOARD_MARKER = 'LOUSA_BOARD_DATA';
const BOARD_CLIPBOARD_RE = new RegExp(`<!--${BOARD_CLIPBOARD_MARKER}:([A-Za-z0-9+/=]+)-->`);

let _pasteCount = 0; // incrementa a cada colagem para o offset não empilhar no mesmo lugar

// ── Clipboard INTERNO do app ─────────────────────────────────────────────────
// O clipboard do sistema não serve no mobile: `navigator.clipboard.write` com
// ClipboardItem de imagem falha/é bloqueado em boa parte dos navegadores de
// celular, e o evento 'paste' (que é o único caminho de colagem aqui) depende
// de Ctrl+V — que não existe no toque. Sem isto, copiar/colar simplesmente não
// existia no celular.
//
// Então guardamos SEMPRE uma cópia interna dos objetos serializados: em memória
// (rápido) e espelhada em localStorage (sobrevive a reload e funciona entre
// abas/salas). O clipboard do sistema continua sendo alimentado em paralelo,
// best-effort, pra manter a interoperabilidade com outros apps no desktop.
const CLIPBOARD_KEY = 'lb_clipboard';
const CLIPBOARD_MAX_PERSIST = 2 * 1024 * 1024; // acima disso só em memória (cota do localStorage)
let _memClipboard = null;

function setInternalClipboard(serialized) {
  _memClipboard = serialized;
  try {
    const json = JSON.stringify(serialized);
    if (json.length <= CLIPBOARD_MAX_PERSIST) localStorage.setItem(CLIPBOARD_KEY, json);
    else localStorage.removeItem(CLIPBOARD_KEY); // não deixa um recorte antigo/menor mascarar este
  } catch (_) { /* cota estourada ou modo privado — segue só em memória */ }
  updatePasteButton();
}

// Memória tem prioridade; o localStorage é o fallback (outra aba / após reload).
export function getInternalClipboard() {
  if (_memClipboard && _memClipboard.length) return _memClipboard;
  try {
    const raw = localStorage.getItem(CLIPBOARD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (_) {}
  return null;
}

export function hasClipboardContent() { return !!getInternalClipboard(); }

// Habilita/desabilita o botão "Colar" da toolbar conforme há ou não conteúdo.
// Só mexe no DOM — nenhum binding circular é lido aqui, então pode rodar no
// nível superior do módulo (ver regra em CLAUDE.md).
function updatePasteButton() {
  const btn = document.getElementById('t-paste');
  if (!btn) return;
  const has = hasClipboardContent();
  btn.disabled = !has;
  btn.style.opacity = has ? '1' : '0.35';
}
updatePasteButton();

// Colar acionado por BOTÃO (toque ou clique) — lê do clipboard interno, não do
// sistema. É o caminho de colagem do mobile, e um atalho conveniente no desktop.
export async function pasteFromClipboard() {
  const data = getInternalClipboard();
  if (!data) { showToast('Nada para colar.', 2000); return; }
  await pasteBoardObjects(data);
}

// Codifica/decodifica JSON (com acentos etc.) em base64 com segurança de UTF-8.
function b64EncodeUtf8(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64DecodeUtf8(str) { return decodeURIComponent(escape(atob(str))); }

// Converte um data URL (ex: "data:image/png;base64,...") em Blob, para poder
// ser gravado no clipboard do sistema via ClipboardItem.
function dataURLToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = (header.match(/data:(.*?);base64/) || [])[1] || 'image/png';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function copySel() {
  const objs = canvas.getActiveObjects().filter(o => !o._isViewportRect);
  if (!objs.length) return;

  const serialized = objs.map(o => ser(o)).filter(Boolean);
  if (!serialized.length) return;

  _pasteCount = 0;

  // 1. Clipboard INTERNO — sempre. É o que garante que colar funcione em
  //    qualquer dispositivo (ver comentário em setInternalClipboard).
  setInternalClipboard(serialized);
  showToast(`${serialized.length} objeto(s) copiado(s)`, 2000);

  // 2. Clipboard do SISTEMA — best-effort, pra poder colar em outros apps
  //    (Word, WhatsApp...) e em outra aba do board via Ctrl+V. Falha esperada
  //    em vários navegadores mobile: não é erro do ponto de vista do usuário,
  //    porque o passo 1 já garantiu a cópia. Por isso só logamos.
  try {
    // Mesma renderização usada pelo "Exportar como PNG" (bounding box exata da seleção).
    const dataUrl = renderObjectsAsDataURL(objs);
    const html = `<!--${BOARD_CLIPBOARD_MARKER}:${b64EncodeUtf8(JSON.stringify(serialized))}-->`;
    const clipboardData = { 'text/html': new Blob([html], { type: 'text/html' }) };
    if (dataUrl) clipboardData['image/png'] = dataURLToBlob(dataUrl);
    await navigator.clipboard.write([new ClipboardItem(clipboardData)]);
  } catch (err) {
    console.warn('Clipboard do sistema indisponível (a cópia interna do board funcionou):', err);
  }
}

// Reconstrói objetos do board a partir de dados serializados vindos do clipboard
// do sistema (ver BOARD_CLIPBOARD_MARKER acima). Sempre gera objetos 100% novos,
// com novos ids/elementos — nunca reaproveita referências de objetos vivos.
async function pasteBoardObjects(dataArray) {
  if (!dataArray || !dataArray.length) return;
  if (isLayerLocked(activeLayerId)) {
    showToast('Camada travada — destrave para colar objetos aqui.', 2500);
    return;
  }

  canvas.discardActiveObject();
  const pasted = [];

  // Cópia profunda de tudo primeiro (nunca reaproveita refs dos dados originais).
  const items = dataArray.map(d => JSON.parse(JSON.stringify(d)));

  // Onde o conjunto colado (1 objeto, vários soltos ou grupos) vai nascer:
  //  - 'staging' → todo o conjunto é traduzido (e, se preciso, encolhido) pra
  //    dentro da área reservada, preservando o arranjo relativo entre as peças,
  //    em cascata pra não empilhar exatamente sobre a colagem anterior.
  //  - padrão ('view') → comportamento de sempre: cada colagem sucessiva sai
  //    um pouco deslocada da posição original copiada.
  if (imageSpawnMode === 'staging') {
    placeStagingGroup(items);
  } else {
    _pasteCount++;
    const offset = 24 * _pasteCount;
    for (const data of items) {
      data.left = (data.left || 0) + offset;
      data.top  = (data.top  || 0) + offset;
    }
  }

  for (const data of items) {
    const newId = genId();

    if (data.type === 'image' && data._isGif) {
      // GIFs precisam passar por placeGif() para entrar no _gifRegistry
      // e animar corretamente — clone() não registra o loop de animação.
      data.id = newId;
      data.layerId = activeLayerId;
      try {
        const gifObj = await placeGif(data._gifUrl || data.src, data);
        addToCanvas(gifObj);
        pasted.push(gifObj);
      } catch (_) { /* ignora gif que falhou ao colar */ }
      continue;
    }

    // Demais tipos (imagem comum, formas, texto, traços, grupos): deser() já
    // resolve cada caso (inclusive grupos recursivamente e imagens via cache).
    data.id = newId;
    data.layerId = activeLayerId;
    assignDefaultName(data);

    await new Promise(resolve => {
      deser(data, obj => {
        addToCanvas(obj);
        pasted.push(obj);
        resolve();
      });
    });
    hideToast();
  }

  if (vpRect) canvas.bringToFront(vpRect);
  if (stagingRect) canvas.bringToFront(stagingRect);

  // IMPORTANTE: serializa (captura left/top absolutos) ANTES de agrupar numa
  // ActiveSelection. O Fabric recalcula left/top de cada objeto pra relativo
  // ao CENTRO da seleção assim que ela é criada — se a gente serializasse
  // depois, os outros clientes receberiam essas coordenadas relativas como
  // se fossem absolutas, e o conjunto colado apareceria deslocado pra perto
  // da origem do board (era exatamente o bug: só quem colou via a posição
  // certa — os próprios objetos locais já tinham sido adicionados com a
  // posição absoluta correta — mas o payload enviado pra rede é que saía
  // errado).
  const serialized = pasted.map(ser).filter(Boolean);

  canvas.setActiveObject(pasted.length > 1
    ? new fabric.ActiveSelection(pasted, { canvas })
    : pasted[0]);
  canvas.renderAll();

  // objects:batch → applyFull no destino trata cada tipo corretamente,
  // inclusive _isGif (decodifica via Worker e registra no _gifRegistry).
  socket.emit('objects:batch', serialized);
  scheduleLayersUpdate();
}
