// ─── Área reservada de spawn (staging area) ──────────────────────────────────
// Extraído de board-app.js: onde novas imagens/gifs/objetos colados "nascem"
// no board (centralizado na tela de quem insere, ou numa área reservada fora
// do viewport oficial do OBS), a posição dessa área por cliente, e as áreas
// dos OUTROS usuários mostradas no board. Import circular controlado com
// board-app.js (ver ARCHITECTURE.md) — o dispatcher central de mouse
// (mouse:move/down) em board-app.js precisa de `stagingRect` e
// `_stagingPlacementMode` pra saber quando está em modo "mira" de
// reposicionamento; isso continua lá porque é o mesmo hub que decide entre
// pan/desenho/seleção/reposicionar-área.
import { canvas } from '../../core/canvas-manager.js';
import { socket, showToast, myRoomId, myClientId, vpW, vpH, vpRect } from '../../board-app.js';

// ── Retângulo tracejado da área reservada de spawn ────────────────────────────
// Mesmo estilo visual do retângulo do viewport, só que amarelo (mesma cor do
// botão "Spawn: área reservada" quando ativo) e só fica visível quando o modo
// 'staging' está ativo — reaproveita a mesma flag _isViewportRect pra ficar
// automaticamente fora de seleção, export, serialização e z-order (é só um
// guia visual local). A POSIÇÃO dele é sincronizada com os outros usuários
// (não em tempo real, só quando confirmada — ver staging:sync), mas o próprio
// retângulo amarelo é sempre só o meu; o de cada outro usuário aparece como
// um retângulo separado, na cor dele (ver renderOtherStagingArea, mais abaixo).
let stagingRect = null;
const STAGING_RECT_W = 900, STAGING_RECT_H = 700;

function createStagingRect() {
  if (stagingRect) { canvas.remove(stagingRect); }
  stagingRect = new fabric.Rect({
    left: 0, top: 0,
    width: STAGING_RECT_W, height: STAGING_RECT_H,
    fill: 'transparent',
    stroke: '#fbbf24',
    strokeWidth: 2,
    strokeDashArray: [12, 6],
    selectable: false,
    evented: false,
    hasControls: false,
    hasBorders: false,
    lockMovementX: true,
    lockMovementY: true,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
    excludeFromExport: true,
    _isViewportRect: true,
  });
  canvas.add(stagingRect);
  drawStagingRect();
  // canvas.clear() (board:clear/board:sync) remove os grupos das áreas dos
  // outros usuários junto com tudo mais — como createStagingRect() é sempre
  // chamado depois de recriar o board, é o ponto certo pra recriá-los também.
  if (typeof renderAllOtherStagingAreas === 'function') renderAllOtherStagingAreas();
}

function drawStagingRect() {
  if (!stagingRect) return;
  const origin = getStagingOrigin();
  stagingRect.set({
    left: origin.left, top: origin.top,
    width: STAGING_RECT_W, height: STAGING_RECT_H,
    visible: imageSpawnMode === 'staging' || _stagingPlacementMode,
    strokeDashArray: [12, 6],
    stroke: '#fbbf24',
    opacity: _stagingPlacementMode ? 0.65 : 1,
  });
  stagingRect.setCoords();
  canvas.bringToFront(stagingRect);
  canvas.renderAll();
}

// ── Posiciona imagem no centro do viewport ────────────────────────────────────
function centerImgOnViewport(img) {
  const s   = img.width > canvas.width * .5 ? canvas.width * .5 / img.width : 1;
  const zoom = canvas.getZoom(), vpt = canvas.viewportTransform;
  const cx = (-vpt[4] + window.innerWidth  / 2) / zoom;
  const cy = (-vpt[5] + window.innerHeight / 2) / zoom;
  img.scale(s);
  img.set({ left: cx - img.getScaledWidth() / 2, top: cy - img.getScaledHeight() / 2 });
}

// ── Preferência local de onde novas imagens/gifs "nascem" no board ──────────
// 'view'    → centralizada na tela que EU (localmente) estou olhando agora
//             (padrão, comportamento de sempre).
// 'staging' → sempre numa área reservada, fora do viewport oficial do OBS
//             (que é sempre fixo em 0,0 → vpW×vpH) — assim ela não "pipoca"
//             no meio da tela de quem está olhando em tempo real; a pessoa
//             arrasta pra posição final depois.
// É uma preferência POR NAVEGADOR (localStorage), não por sala nem por
// objeto — cada pessoa escolhe pra si, sem afetar o que os outros veem.
let imageSpawnMode = localStorage.getItem('lb_imageSpawnMode') || 'view';

const STAGING_MARGIN  = 160; // distância padrão da borda direita do viewport oficial
const STAGING_MAX_W   = 480; // largura máxima de uma imagem avulsa (em coords do canvas)
let _stagingCascade = 0;

// ── Posição da área reservada (configurável POR CLIENTE) ────────────────────
// Por padrão a área fica a STAGING_MARGIN px à direita do viewport oficial
// (comportamento de sempre). Mas cada pessoa pode clicar em "Mover área
// reservada" e escolher, só pra si, onde a SUA área deve ficar (nunca move a
// de ninguém mais). A posição fica salva localmente (localStorage, por sala)
// pra persistir entre recarregamentos, e também é enviada ao servidor —
// não em tempo real (nunca segue o mouse pela rede) — nestes momentos:
// ligar o modo "área reservada" (sincroniza na posição atual), mover/resetar
// a posição enquanto o modo está ativo, e ao reconectar/recarregar a página
// já com o modo ativo. Desligar o modo remove a área do board dos outros.
// É assim que ela aparece, com meu nome e cor, no board de todo mundo (ver
// "Áreas reservadas de outros usuários" mais abaixo).
//
// `_stagingPosKey` é uma FUNÇÃO, não uma const — precisa ler `myRoomId`, que
// vem de um import circular com board-app.js. Calculá-la no nível superior do
// módulo (fora de função) daria erro: os imports de um módulo são avaliados
// antes do corpo do próprio módulo rodar, então `myRoomId` ainda não teria
// sido inicializado por board-app.js nesse momento (TDZ do `const`). Por isso
// `_stagingPos` também é carregado de forma preguiçosa, no primeiro uso real
// (dentro de `getStagingOrigin()`), quando todos os módulos já terminaram de
// avaliar e `myRoomId` já existe.
function _stagingPosKey() { return `lb_stagingPos_${myRoomId}`; }
let _stagingPos; // undefined = ainda não carregado do localStorage; null = carregado, sem posição salva

function _loadStagingPosIfNeeded() {
  if (_stagingPos !== undefined) return;
  try {
    const raw = localStorage.getItem(_stagingPosKey());
    _stagingPos = raw ? JSON.parse(raw) : null;
  } catch (_) { _stagingPos = null; }
}

let _stagingPlacementMode = false; // true enquanto a pessoa está escolhendo a nova posição
let _stagingPlacementInvalid = false; // true quando a posição atual do "mira" cai em cima do viewport

// Testa sobreposição entre dois retângulos axis-aligned (left, top, w, h).
function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function getStagingOrigin() {
  _loadStagingPosIfNeeded();
  return _stagingPos || { left: vpW + STAGING_MARGIN, top: 0 };
}

function saveStagingPos(pos) {
  _stagingPos = pos;
  try { localStorage.setItem(_stagingPosKey(), JSON.stringify(pos)); } catch (_) {}
}

function resetStagingPos() {
  _stagingPos = null;
  try { localStorage.removeItem(_stagingPosKey()); } catch (_) {}
  drawStagingRect();
  // Se o modo área reservada ainda está ativo, a área continua existindo pros
  // outros verem — só que agora na posição padrão. Só remove de vez (some pra
  // todo mundo) se o modo já estiver desligado.
  if (imageSpawnMode === 'staging') emitStagingSync(getStagingOrigin());
  else emitStagingRemove();
  showToast('Área reservada voltou pra posição padrão', 2000);
}

// Próximo deslocamento em cascata dentro da área reservada, compartilhado por
// imagens avulsas e por grupos de objetos colados, pra nada nascer exatamente
// empilhado em cima do que já estava lá.
function nextStagingOffset() {
  const off = (_stagingCascade % 8) * 40;
  _stagingCascade++;
  return off;
}

// Posiciona uma imagem/gif na área reservada, em cascata simples pra novas
// imagens não empilharem exatamente uma em cima da outra.
function placeInStagingArea(img) {
  const s = img.width > STAGING_MAX_W ? STAGING_MAX_W / img.width : 1;
  img.scale(s);
  const offset = nextStagingOffset();
  const origin = getStagingOrigin();
  img.set({ left: origin.left + offset, top: origin.top + offset });
}

// Reposiciona (in-place, nos dados serializados ainda não instanciados) um
// conjunto de objetos — um só, vários soltos ou grupos — pra dentro da área
// reservada, preservando o arranjo relativo entre eles (só translada e, se
// necessário, encolhe tudo proporcionalmente pra caber). Usado pelo paste de
// objetos do próprio board (pasteBoardObjects) quando o modo staging tá ativo.
function placeStagingGroup(items) {
  let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
  for (const d of items) {
    const w = (d.width  || 0) * (d.scaleX ?? 1);
    const h = (d.height || 0) * (d.scaleY ?? 1);
    const l = d.left || 0, t = d.top || 0;
    if (l < minLeft) minLeft = l;
    if (t < minTop) minTop = t;
    if (l + w > maxRight) maxRight = l + w;
    if (t + h > maxBottom) maxBottom = t + h;
  }
  if (!isFinite(minLeft)) return; // segurança, não deveria acontecer

  const bboxW = Math.max(1, maxRight - minLeft);
  const bboxH = Math.max(1, maxBottom - minTop);
  // Só encolhe (nunca aumenta) o suficiente pra caber na área reservada.
  const scale = Math.min(1, STAGING_RECT_W / bboxW, STAGING_RECT_H / bboxH);

  const offset = nextStagingOffset();
  const origin = getStagingOrigin();
  const targetLeft = origin.left + offset;
  const targetTop  = origin.top  + offset;

  for (const d of items) {
    const l = d.left || 0, t = d.top || 0;
    d.left = targetLeft + (l - minLeft) * scale;
    d.top  = targetTop  + (t - minTop) * scale;
    if (scale !== 1) {
      d.scaleX = (d.scaleX ?? 1) * scale;
      d.scaleY = (d.scaleY ?? 1) * scale;
    }
  }
}

// Ponto único de posicionamento pra qualquer imagem/gif recém-inserido
// (upload, colar arquivo, colar URL externa) — respeita a preferência acima.
// NÃO é usado para: restaurar um objeto já existente (existingData), colar um
// objeto do próprio board (pasteBoardObjects, tem sua própria lógica — ver
// placeStagingGroup acima) ou drag-and-drop (a posição já é escolhida
// explicitamente por onde a pessoa soltou o arquivo).
export function placeNewImage(img) {
  if (imageSpawnMode === 'staging') placeInStagingArea(img);
  else centerImgOnViewport(img);
}

function updateSpawnBtnUI() {
  const label = document.getElementById('spawn-btn-label');
  const btn   = document.getElementById('trp-spawn');
  const moveBtn = document.getElementById('trp-spawn-move');
  if (imageSpawnMode === 'staging') {
    label.textContent = 'Spawn: área reservada';
    btn.dataset.tip = 'Novas imagens/gifs e objetos colados (Ctrl+V) aparecem numa área reservada, fora do viewport do OBS — arraste pra posição depois. Clique pra mudar.';
    btn.classList.add('staging');
    moveBtn.disabled = false;
  } else {
    label.textContent = 'Spawn: minha tela';
    btn.dataset.tip = 'Novas imagens/gifs e objetos colados (Ctrl+V) aparecem centralizados na tela que você está olhando agora. Clique pra mudar.';
    btn.classList.remove('staging');
    moveBtn.disabled = true;
    if (_stagingPlacementMode) cancelStagingPlacement();
  }
}

function toggleImageSpawnMode() {
  imageSpawnMode = imageSpawnMode === 'staging' ? 'view' : 'staging';
  localStorage.setItem('lb_imageSpawnMode', imageSpawnMode);
  updateSpawnBtnUI();
  drawStagingRect();
  // Mostra/esconde a área pros outros assim que o modo muda — não precisa
  // mover pra aparecer. Ativar sincroniza a posição atual (padrão ou já
  // customizada); desativar remove o retângulo do board de todo mundo.
  if (imageSpawnMode === 'staging') emitStagingSync(getStagingOrigin());
  else emitStagingRemove();
  showToast(imageSpawnMode === 'staging'
    ? 'Novas imagens e objetos colados vão para a área reservada'
    : 'Novas imagens e objetos colados vão centralizados na sua tela', 2200);
}

document.getElementById('trp-spawn').addEventListener('click', toggleImageSpawnMode);
updateSpawnBtnUI();

// ── Escolher (por cliente) onde a área reservada fica ────────────────────────
// Clique no botão entra em "modo mira": a área reservada (localmente) segue
// o mouse e o próximo clique no board confirma a nova posição. O modo mira em
// si nunca sai da sua tela, mas a posição CONFIRMADA é enviada ao servidor
// (staging:sync) pra os outros usuários verem onde ela ficou — sem tempo
// real, só nesse momento da confirmação (ver "Áreas reservadas de outros
// usuários" mais abaixo).
function startStagingPlacement() {
  if (document.getElementById('trp-spawn-move').disabled) return;
  _stagingPlacementMode = true;
  _stagingPlacementInvalid = false;
  document.getElementById('trp-spawn-move').classList.add('active');
  drawStagingRect();
  showToast('Clique no board pra definir a posição da área reservada (Esc cancela)', 4000);
}

function cancelStagingPlacement() {
  _stagingPlacementMode = false;
  _stagingPlacementInvalid = false;
  document.getElementById('trp-spawn-move').classList.remove('active');
  drawStagingRect();
}

// Segue o ponteiro em tempo real (só localmente) enquanto o modo "mira" está
// ativo — chamado pelo dispatcher central de mouse:move em board-app.js.
// Fica vermelho quando a posição atual sobrepõe o viewport oficial (que o
// OBS captura), sinalizando que aquele clique seria recusado.
function previewStagingPlacement(p) {
  if (!stagingRect) return;
  _stagingPlacementInvalid = rectsOverlap(
    p.x, p.y, STAGING_RECT_W, STAGING_RECT_H,
    0, 0, vpW, vpH
  );
  stagingRect.set({
    left: p.x, top: p.y, visible: true,
    stroke: _stagingPlacementInvalid ? '#ff4d4d' : '#fbbf24',
  });
  stagingRect.setCoords();
  canvas.bringToFront(stagingRect);
  canvas.renderAll();
}

function confirmStagingPlacement(pointer) {
  const invalid = rectsOverlap(
    pointer.x, pointer.y, STAGING_RECT_W, STAGING_RECT_H,
    0, 0, vpW, vpH
  );
  if (invalid) {
    showToast('A área reservada não pode ficar dentro do viewport — escolha outro lugar', 2600);
    return; // permanece no modo mira pra tentar de novo
  }
  const pos = { left: pointer.x, top: pointer.y };
  saveStagingPos(pos);
  _stagingPlacementMode = false;
  _stagingPlacementInvalid = false;
  document.getElementById('trp-spawn-move').classList.remove('active');
  drawStagingRect();
  emitStagingSync(pos);
  showToast('Posição da área reservada atualizada — os outros já veem onde ela ficou', 2600);
}

document.getElementById('trp-spawn-move').addEventListener('click', () => {
  if (_stagingPlacementMode) cancelStagingPlacement();
  else startStagingPlacement();
});
// Clique direito no botão restaura a posição padrão (à direita do viewport).
document.getElementById('trp-spawn-move').addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!_stagingPlacementMode) resetStagingPos();
});

// Envia/remove a posição pro servidor, pra outros usuários verem onde a
// MINHA área reservada fica (ver bloco "Áreas reservadas de outros usuários"
// abaixo). Nunca em tempo real (nunca segue o mouse pela rede) — só nestes
// momentos: ligar/desligar o modo, mover ou resetar a posição, e reconectar
// já com o modo ativo.
function emitStagingSync(pos)  { socket.emit('staging:sync', pos); }
function emitStagingRemove()   { socket.emit('staging:remove'); }

// ── Áreas reservadas de OUTROS usuários (mostradas no board) ────────────────
// Cada cliente só sincroniza a própria posição nos momentos acima (não é
// tempo real). Guardamos aqui um cache local de {clientId → dados} recebido
// do servidor (board:init traz o estado atual de todos; staging:sync/-remove
// atualizam ao vivo depois) e desenhamos um retângulo tracejado — na cor do
// respectivo usuário — pra cada um. A MINHA própria área nunca aparece nessa
// lista (ela já é o stagingRect local, amarelo, controlado só por mim).
let _stagingAreaEntries = {};   // clientId → { clientId, name, color, left, top }

// Setter exportado — código de fora do módulo não pode reatribuir um binding
// importado diretamente (`import {x}; x = ...` é erro), só objetos internos
// mutados por função. Usado por board-app.js ao processar 'board:init'/'board:sync'.
function setStagingAreaEntries(entries) { _stagingAreaEntries = entries || {}; }
let _otherStagingRects  = {};   // clientId → objeto fabric.Group no canvas

function renderOtherStagingArea(entry) {
  if (!entry || !entry.clientId || entry.clientId === myClientId) return;
  removeOtherStagingRect(entry.clientId);

  const rect = new fabric.Rect({
    left: 0, top: 0, width: STAGING_RECT_W, height: STAGING_RECT_H,
    fill: 'transparent', stroke: entry.color || '#94a3b8', strokeWidth: 2, strokeDashArray: [10, 5],
  });
  const label = new fabric.Text(`Área de ${entry.name || 'usuário'}`, {
    left: 8, top: 8, fontSize: 13, fontFamily: 'system-ui, sans-serif',
    fill: entry.color || '#94a3b8',
  });
  const group = new fabric.Group([rect, label], {
    left: entry.left, top: entry.top,
    selectable: false, evented: false, hasControls: false, hasBorders: false,
    lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, lockRotation: true,
    excludeFromExport: true,
    _isViewportRect: true,     // reaproveita: nunca selecionável/exportável/serializável
    _isOtherStagingRect: true,
  });
  canvas.add(group);
  canvas.bringToFront(group);
  if (vpRect) canvas.bringToFront(vpRect);
  if (stagingRect) canvas.bringToFront(stagingRect);
  _otherStagingRects[entry.clientId] = group;
  canvas.renderAll();
}

function removeOtherStagingRect(clientId) {
  const g = _otherStagingRects[clientId];
  if (g) { canvas.remove(g); delete _otherStagingRects[clientId]; canvas.renderAll(); }
}

// Redesenha todas as áreas de outros usuários a partir do cache local — usado
// depois de qualquer canvas.clear() (board:clear, board:sync), já que isso
// remove os grupos junto com o resto dos objetos.
function renderAllOtherStagingAreas() {
  Object.keys(_otherStagingRects).forEach(removeOtherStagingRect);
  Object.values(_stagingAreaEntries).forEach(renderOtherStagingArea);
}

// Registra os listeners de socket relacionados à área reservada. Exportada
// como função — não pode rodar direto no nível superior do módulo porque
// `socket` vem de um import circular com board-app.js (mesma razão do
// `_stagingPosKey` acima). board-app.js chama isso explicitamente depois que
// sua própria `const socket = ...` já rodou.
function initStagingSocketListeners() {
  socket.on('staging:sync', entry => {
    if (!entry || !entry.clientId) return;
    _stagingAreaEntries[entry.clientId] = entry;
    renderOtherStagingArea(entry);
  });

  socket.on('staging:remove', ({ clientId } = {}) => {
    if (!clientId) return;
    delete _stagingAreaEntries[clientId];
    removeOtherStagingRect(clientId);
  });
}



export {
  stagingRect, STAGING_RECT_W, STAGING_RECT_H, createStagingRect, drawStagingRect,
  _stagingPlacementMode, confirmStagingPlacement, placeStagingGroup,
  initStagingSocketListeners, setStagingAreaEntries, renderAllOtherStagingAreas,
  imageSpawnMode, getStagingOrigin, emitStagingSync, cancelStagingPlacement,
  previewStagingPlacement,
};
