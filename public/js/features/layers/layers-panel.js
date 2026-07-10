// ─── Painel de camadas (estilo Photoshop) ─────────────────────────────────────
// Extraído de board-app.js: estado de camadas, gerenciamento (criar/mover/
// excluir/visibilidade), renderização do painel, ações sobre objetos vindas do
// painel (mostrar/ocultar, excluir), e o drag-and-drop de objetos entre
// camadas. Import circular controlado com board-app.js — só usado dentro de
// corpo de função (ver ARCHITECTURE.md).
import { canvas } from '../../core/canvas-manager.js';
import { escapeHtml } from '../../shared/escape-html.js';
import { ser } from '../../core/serialization.js';
import { activeGifs } from '../media/gif-service.js';
import { updateLayerToolbar } from '../groups/group-service.js';
import { socket, genId, showToast, findById, vpRect } from '../../board-app.js';
import { syncDrawingMode } from '../drawing-tools/drawing-tools.js';

// ── Sistema de camadas ────────────────────────────────────────────────────────
export const boardLayers = [{ id: 'layer-default', name: 'Camada 1', visible: true, viewVisible: true }];
export let activeLayerId  = 'layer-default';
// ── Sistema de grupos (etiqueta, não fabric.Group) ────────────────────────────
// boardGroups = [ { id, name, locked } ] — cada objeto agrupado carrega
// obj.groupId apontando pra um destes, exatamente como obj.layerId aponta pra
// boardLayers. Sem container real: objetos de um grupo continuam individual-
// mente selecionáveis/editáveis no canvas (ver group-service.js).
export const boardGroups = [];
// ── PAINEL DE CAMADAS (estilo Photoshop) ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// boardLayers = [ { id, name, visible } ]  — cada camada é um "grupo lógico"
// Traços/paths vão para a camada ativa automaticamente.
// Objetos (imagens, textos, formas) têm seu próprio item dentro da camada.
// O z-order real do canvas é: todos os objetos da camada 0 (fundo), depois
// todos da camada 1, etc.

let layersUpdateTimer = null;
const hiddenObjects   = new Set();
const panelSelected   = new Set();
export const objectNames     = {};
const collapsedLayers = new Set();
export const typeCounters    = {};

// ── Seleção múltipla pelo painel (shift/ctrl+click) ───────────────────────────
// clickableEntries: lista, na ordem visual (topo→fundo, cruzando camadas), de
// cada item clicável do painel → array de ids de objetos fabric que ele representa
// (1 id para um objeto normal, N ids para um grupo de traços "N traços").
// selectionAnchor: ids da última entrada clicada sem shift, usada como âncora do range.
let clickableEntries = [];
let selectionAnchor  = null;

function objectsFromIds(ids) { return ids.map(id => findById(id)).filter(Boolean); }

function applyPanelSelection(objs) {
  if (!objs.length) { canvas.discardActiveObject(); }
  else if (objs.length === 1) { canvas.setActiveObject(objs[0]); }
  else {
    canvas.discardActiveObject();
    canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas }));
  }
  canvas.renderAll();
  scheduleLayersUpdate();
}

// Trata o clique num item do painel considerando shift (range) e ctrl/cmd (toggle).
// entryIds = ids representados por esse item específico.
function handlePanelItemClick(e, entryIds) {
  if (e.shiftKey && selectionAnchor) {
    const anchorIdx  = clickableEntries.findIndex(ids => ids[0] === selectionAnchor[0]);
    const currentIdx = clickableEntries.findIndex(ids => ids[0] === entryIds[0]);
    if (anchorIdx !== -1 && currentIdx !== -1) {
      const [from, to] = anchorIdx < currentIdx ? [anchorIdx, currentIdx] : [currentIdx, anchorIdx];
      const rangeIds = clickableEntries.slice(from, to + 1).flat();
      applyPanelSelection(objectsFromIds(rangeIds));
      return;
    }
  }
  if (e.ctrlKey || e.metaKey) {
    const current = new Set(canvas.getActiveObjects().map(o => o.id));
    const allPresent = entryIds.every(id => current.has(id));
    entryIds.forEach(id => allPresent ? current.delete(id) : current.add(id));
    applyPanelSelection(objectsFromIds([...current]));
    selectionAnchor = entryIds;
    return;
  }
  applyPanelSelection(objectsFromIds(entryIds));
  selectionAnchor = entryIds;
}

export function scheduleLayersUpdate()  { clearTimeout(layersUpdateTimer); layersUpdateTimer = setTimeout(updateLayersPanel, 80); }
function scheduleLayersPanel()   { scheduleLayersUpdate(); }

// ── Nome fixo por objeto ──────────────────────────────────────────────────────
export function assignDefaultName(obj) {
  if (objectNames[obj.id]) return;
  const typeKey = obj._isArrow ? 'Seta' : ({
    'path':'Traço','rect':'Retângulo','ellipse':'Elipse','circle':'Elipse',
    'line':'Linha','group':'Grupo','i-text':'Texto','text':'Texto','image':'Imagem',
  }[obj.type] || 'Objeto');
  typeCounters[typeKey] = (typeCounters[typeKey] || 0) + 1;
  objectNames[obj.id] = `${typeKey} ${typeCounters[typeKey]}`;
}
// Retorna o nome já escapado para HTML: o resultado é sempre interpolado em
// innerHTML, e tanto objectNames[id] (rename do usuário) quanto obj.text
// (conteúdo de um texto, possivelmente de outro cliente) são controláveis.
function getDisplayName(obj) {
  if (obj.type === 'i-text' || obj.type === 'text') {
    const t = (obj.text || '').trim().slice(0, 18);
    return escapeHtml(objectNames[obj.id] || (t ? `"${t}"` : 'Texto'));
  }
  return escapeHtml(objectNames[obj.id] || (obj._isArrow ? 'Seta' : obj.type));
}

// ── Ícones ────────────────────────────────────────────────────────────────────
function getLayerIcon(type, obj) {
  if (obj && obj._isArrow) return `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/></svg>`;
  const icons = {
    'path':   `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 17c3-3 5-7 9-7s6 4 9 7" stroke-linecap="round"/></svg>`,
    'rect':   `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`,
    'ellipse':`<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="10" ry="7"/></svg>`,
    'circle': `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`,
    'line':   `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5" stroke-linecap="round"/></svg>`,
    'group':  `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="8" height="8" rx="1"/><rect x="14" y="8" width="8" height="8" rx="1"/><rect x="8" y="2" width="8" height="8" rx="1"/></svg>`,
    'i-text': `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    'text':   `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    'image':  `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  };
  return icons[type] || icons['rect'];
}

// ── Rename inline ─────────────────────────────────────────────────────────────
function startRename(id, nameEl) {
  const current = nameEl.textContent;
  const input = document.createElement('input');
  input.className = nameEl.className.includes('section') ? 'layer-section-name-input' : 'layer-name-input';
  input.value = current;
  nameEl.replaceWith(input);
  input.focus(); input.select();
  const commit = () => {
    const val = input.value.trim() || current;
    if (id.startsWith('layer-')) {
      const l = boardLayers.find(x => x.id === id);
      if (l) { l.name = val; socket.emit('layers:update', boardLayers); }
    } else if (id.startsWith('group-')) {
      const g = boardGroups.find(x => x.id === id);
      if (g) { g.name = val; socket.emit('groups:update', boardGroups); }
    } else {
      objectNames[id] = val;
    }
    scheduleLayersUpdate();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = current; input.blur(); }
    e.stopPropagation();
  });
}

// ── Trava (lock) ──────────────────────────────────────────────────────────────
// Um objeto é considerado travado se ele mesmo, sua camada OU seu grupo
// estiverem marcados como locked. Travado = não selecionável/editável/movível/
// redimensionável/rotacionável e sem mudança de visibilidade — por isso a
// trava se resume a zerar `selectable`/`evented` (quase toda ação de edição do
// app opera em cima de canvas.getActiveObject(s)()), mais guards explícitos
// nos botões do painel (excluir/ocultar/arrastar), que são DOM e não passam
// pelo Fabric.
export function isLocked(obj) {
  if (!obj) return false;
  if (obj.locked) return true;
  const layer = boardLayers.find(l => l.id === obj.layerId);
  if (layer && layer.locked) return true;
  const group = obj.groupId ? boardGroups.find(g => g.id === obj.groupId) : null;
  if (group && group.locked) return true;
  return false;
}

// ── Visibilidade na view (ao vivo) ────────────────────────────────────────────
// Independente da visibilidade no board (hiddenObjects/layer.visible, que
// esconde dos dois lados): controla só o que aparece na tela da live (OBS).
// Mesmo padrão hierárquico do lock — objeto, camada OU grupo podem esconder.
// Habilitado por padrão: `undefined` conta como visível em todos os níveis.
export function isViewHidden(obj) {
  if (!obj) return false;
  if (obj.viewHidden) return true;
  const layer = boardLayers.find(l => l.id === obj.layerId);
  if (layer && layer.viewVisible === false) return true;
  const group = obj.groupId ? boardGroups.find(g => g.id === obj.groupId) : null;
  if (group && group.viewHidden) return true;
  return false;
}

// Recalcula selectable/evented de todo objeto a partir do estado atual de
// boardLayers/boardGroups — chamado a cada updateLayersPanel(), então qualquer
// mudança de lock (objeto, camada ou grupo) se propaga automaticamente no
// próximo render, sem precisar carimbar flags derivadas em cada objeto.
function refreshLockStates() {
  canvas.getObjects().forEach(o => {
    if (o._isViewportRect) return;
    const locked = isLocked(o);
    o.selectable = !locked;
    o.evented = !locked;
  });
  if (canvas.getActiveObjects().some(o => isLocked(o))) {
    canvas.discardActiveObject();
  }
}

function toggleObjLock(id) {
  const obj = findById(id); if (!obj) return;
  obj.locked = !obj.locked;
  const s = ser(obj);
  if (s) socket.emit('object:modify:commit', s);
  canvas.renderAll();
  scheduleLayersUpdate();
}

function toggleLayerLock(layerId, e) {
  if (e) e.stopPropagation();
  const layer = boardLayers.find(l => l.id === layerId);
  if (!layer) return;
  layer.locked = !layer.locked;
  if (layer.locked && activeLayerId === layerId) {
    const alt = boardLayers.find(l => l.id !== layerId && !l.locked);
    if (alt) activeLayerId = alt.id;
  }
  socket.emit('layers:update', boardLayers);
  scheduleLayersUpdate();
  syncDrawingMode();
}

function toggleGroupLock(groupId, e) {
  if (e) e.stopPropagation();
  const group = boardGroups.find(g => g.id === groupId);
  if (!group) return;
  group.locked = !group.locked;
  socket.emit('groups:update', boardGroups);
  scheduleLayersUpdate();
}

function lockIcon(locked) {
  return locked
    ? `<svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>`
    : `<svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.75-1.5"/></svg>`;
}

// Ícone de "monitor" (visibilidade na view/live) — distinto do olho (visibilidade
// no board), pra não confundir as duas travas de visibilidade independentes.
function viewIcon(hidden, size = 11) {
  return hidden
    ? `<svg width="${size}" height="${size}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg width="${size}" height="${size}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
}

// ── Visibilidade na view (toggle) ─────────────────────────────────────────────
// Objeto: própria flag, sincronizada via object:modify:commit (mesmo canal do
// lock) — entra no histórico de undo, consistente com toggleObjLock.
function toggleObjViewVisibility(id) {
  const obj = findById(id); if (!obj || isLocked(obj)) return;
  obj.viewHidden = !obj.viewHidden;
  const s = ser(obj);
  if (s) socket.emit('object:modify:commit', s);
  scheduleLayersUpdate();
}

// Traços agrupados no painel ("N traços") — aplica a mesma flag a todos de uma vez.
function toggleViewPathGroup(ids) {
  const allHidden = ids.every(id => { const o = findById(id); return o && o.viewHidden; });
  const objs = ids.map(id => findById(id)).filter(Boolean);
  objs.forEach(o => { o.viewHidden = !allHidden; });
  const updates = objs.map(ser).filter(Boolean);
  if (updates.length) socket.emit('objects:modify:commit', updates);
  scheduleLayersUpdate();
}

function toggleLayerViewVisibility(layerId, e) {
  if (e) e.stopPropagation();
  const layer = boardLayers.find(l => l.id === layerId);
  if (!layer) return;
  layer.viewVisible = layer.viewVisible === false ? true : false;
  socket.emit('layers:update', boardLayers);
  scheduleLayersUpdate();
}

function toggleGroupViewVisibility(groupId, e) {
  if (e) e.stopPropagation();
  const group = boardGroups.find(g => g.id === groupId);
  if (!group) return;
  group.viewHidden = !group.viewHidden;
  socket.emit('groups:update', boardGroups);
  scheduleLayersUpdate();
}

// ── Gerenciar camadas ─────────────────────────────────────────────────────────
// Garante que activeLayerId aponta para uma camada que existe (e não travada).
// Chamado após F5 (board:init), após deleteLayer, e antes de qualquer new object.
function ensureActiveLayer() {
  if (!boardLayers.length) {
    // Caso extremo: não há nenhuma camada — cria uma
    boardLayers.length = 0;
    boardLayers.push({ id: 'layer-default-' + genId(), name: 'Camada 1', visible: true, viewVisible: true });
    socket.emit('layers:update', boardLayers);
  }
  const valid = boardLayers.find(l => l.id === activeLayerId);
  if (!valid || valid.locked) {
    const unlocked = boardLayers.find(l => !l.locked);
    // Se não existe NENHUMA camada destravada, activeLayerId acaba apontando
    // pra uma camada travada mesmo assim (não há pra onde ir) — quem for criar
    // conteúdo precisa checar isLayerLocked(activeLayerId) e bloquear a criação
    // nesse caso, em vez de silenciosamente desenhar na camada travada.
    activeLayerId = (unlocked || boardLayers[0]).id;
  }
  syncDrawingMode();
}

// Usado por qualquer fluxo de criação de objeto (traço, forma, imagem, gif,
// texto, colar) pra recusar criar conteúdo numa camada travada — inclusive
// quando ela é a única camada existente (ensureActiveLayer não tem pra onde
// desviar nesse caso).
function isLayerLocked(layerId) {
  const l = boardLayers.find(x => x.id === layerId);
  return !!(l && l.locked);
}

function addLayer() {
  const n    = boardLayers.length + 1;
  const newL = { id: 'layer-' + genId(), name: `Camada ${n}`, visible: true, viewVisible: true };
  boardLayers.unshift(newL);   // nova camada no topo
  activeLayerId = newL.id;
  socket.emit('layers:update', boardLayers);
  scheduleLayersUpdate();
  syncDrawingMode();
}

function deleteLayer(layerId) {
  if (boardLayers.length <= 1) return; // nunca deletar a última
  const objs = canvas.getObjects().filter(o => o.layerId === layerId && !o._isViewportRect);
  if (objs.length && !confirm(`Essa camada tem ${objs.length} objeto(s). Deletar?`)) return;
  const ids = objs.map(o => o.id).filter(Boolean);
  objs.forEach(o => canvas.remove(o));
  canvas.renderAll();
  if (ids.length) socket.emit('object:remove', ids);
  const remaining = boardLayers.filter(l => l.id !== layerId);
  boardLayers.length = 0;
  boardLayers.push(...remaining);
  ensureActiveLayer(); // revalida — não assume boardLayers[0] diretamente
  socket.emit('layers:update', boardLayers);
  scheduleLayersUpdate();
}

function toggleLayerVisibility(layerId, e) {
  if (e) e.stopPropagation();
  const layer = boardLayers.find(l => l.id === layerId);
  if (!layer) return;
  layer.visible = !layer.visible;
  socket.emit('layer:visibility', { layerId, visible: layer.visible });
  // Aplica localmente também
  canvas.getObjects().filter(o => o.layerId === layerId && !o._isViewportRect).forEach(o => {
    if (!layer.visible) {
      o._savedOpacity = o._savedOpacity ?? o.opacity;
      o.set({ opacity: 0, visible: false }); hiddenObjects.add(o.id);
    } else {
      o.set({ opacity: o._savedOpacity ?? 1, visible: true });
      delete o._savedOpacity; hiddenObjects.delete(o.id);
    }
  });
  canvas.renderAll(); scheduleLayersUpdate();
}

function moveLayer(layerId, dir) {
  const idx = boardLayers.findIndex(l => l.id === layerId);
  if (idx < 0) return;
  const swap = idx + dir;
  if (swap < 0 || swap >= boardLayers.length) return;
  [boardLayers[idx], boardLayers[swap]] = [boardLayers[swap], boardLayers[idx]];
  applyLayerZOrder();  // reordena os objetos do canvas para refletir a nova ordem
  socket.emit('layers:update', boardLayers);
  socket.emit('zorder:sync', canvas.getObjects().map(o => o.id).filter(Boolean));
  scheduleLayersUpdate();
}

// Reordena os objetos no canvas para que a ordem das camadas seja respeitada.
// boardLayers[0] = topo visual → índice mais alto no canvas.
// boardLayers[last] = fundo → índice 0 no canvas.
function applyLayerZOrder() {
  const allObjs = canvas.getObjects().filter(o => o.id && !o._isViewportRect);
  // Ordena: fundo primeiro (último em boardLayers), topo depois (primeiro em boardLayers)
  const layerOrder = [...boardLayers].reverse(); // index 0 = fundo
  let targetIdx = 0;
  layerOrder.forEach(layer => {
    const layerObjs = allObjs.filter(o => o.layerId === layer.id);
    layerObjs.forEach(obj => {
      canvas.moveTo(obj, targetIdx++);
    });
  });
  if (vpRect) canvas.bringToFront(vpRect);
  canvas.renderAll();
}



// ── Render principal ──────────────────────────────────────────────────────────
let layerDragSrcId = null;
const collapsedGroups = new Set();

function updateLayersPanel() {
  const list = document.getElementById('layers-list');
  if (!list) return;
  const allObjs = canvas.getObjects().filter(o => o.id && !o._isViewportRect);
  ensureActiveLayer();
  refreshLockStates();
  // Objetos sem camada (criados antes de ter camada, ou após F5 com camada deletada)
  // são reatribuídos à camada ativa
  allObjs.forEach(o => {
    if (!o.layerId || !boardLayers.find(l => l.id === o.layerId)) {
      o.layerId = activeLayerId;
    }
    assignDefaultName(o);
  });

  // Não reconstrói o DOM quando o painel está recolhido (fora da tela): a
  // reconstrução completa é a parte cara, e num painel invisível é puro
  // desperdício — durante uma live, com o painel recolhido, cada traço
  // disparava um rebuild de centenas de nós à toa. Marca como "sujo" e
  // reconstrói ao reabrir (ver flushLayersPanelIfDirty). A escrituração barata
  // acima (reatribuir camada/nomear objetos) já rodou e é o que importa manter.
  const panel = document.getElementById('layers-panel');
  if (panel && panel.classList.contains('collapsed')) {
    _panelDirtyWhileCollapsed = true;
    return;
  }
  _panelDirtyWhileCollapsed = false;

  if (!boardLayers.length) {
    list.innerHTML = '<div id="layers-empty">Nenhuma camada</div>';
    return;
  }

  const canvasSel = new Set(canvas.getActiveObjects().map(o => o.id));
  // Monta tudo num DocumentFragment e insere de uma vez só no fim: antes cada
  // camada era anexada direto no #layers-list (DOM ao vivo), forçando um
  // reflow por seção. Com o fragment, é um único reflow no final.
  const frag = document.createDocumentFragment();
  clickableEntries = [];

  // Renderiza do topo para o fundo (boardLayers[0] = topo)
  boardLayers.forEach(layer => {
    const layerObjs   = allObjs.filter(o => o.layerId === layer.id);
    const isActive    = layer.id === activeLayerId;
    const isCollapsed = collapsedLayers.has(layer.id);
    const paths       = layerObjs.filter(o => o.type === 'path');
    const others      = layerObjs.filter(o => o.type !== 'path');

    // layerObjs já está na ordem do canvas (allObjs = canvas.getObjects() filtrado).
    // Para o painel, precisamos do topo para baixo → reverso.
    // Traços consecutivos são agrupados em um único item "N traços" que ocupa
    // a posição correta na stack, respeitando objetos intercalados.

    // ── Cabeçalho da camada ───────────────────────────────────────────────────
    const section = document.createElement('div');
    section.className = 'layer-section' + (isCollapsed ? ' collapsed' : '');
    section.dataset.layerId = layer.id;

    const eyeIcon = layer.visible
      ? `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
      : `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

    const header = document.createElement('div');
    header.className = 'layer-section-header' + (isActive ? ' active-layer' : '');
    header.innerHTML = `
      <button class="lsa-btn" onclick="collapsedLayers.has('${layer.id}')?collapsedLayers.delete('${layer.id}'):collapsedLayers.add('${layer.id}');scheduleLayersUpdate();">
        <svg width="9" height="9" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="transform:rotate(${isCollapsed?'0':'90'}deg);transition:.15s">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
      <span class="layer-section-name" data-rename="${layer.id}">${escapeHtml(layer.name)}</span>
      <span style="font-size:9px;color:var(--muted);flex-shrink:0">${layerObjs.length}</span>
      <div class="layer-section-actions">
        <button class="lsa-btn ${layer.locked ? 'locked-layer' : ''}" onclick="toggleLayerLock('${layer.id}',event)" title="${layer.locked ? 'Destravar camada' : 'Travar camada'}">${lockIcon(layer.locked)}</button>
        <button class="lsa-btn ${layer.visible ? '' : 'hidden-layer'}" onclick="toggleLayerVisibility('${layer.id}',event)" title="${layer.visible ? 'Ocultar do board' : 'Mostrar no board'}">${eyeIcon}</button>
        <button class="lsa-btn ${layer.viewVisible === false ? 'view-hidden-layer' : ''}" onclick="toggleLayerViewVisibility('${layer.id}',event)" title="${layer.viewVisible === false ? 'Mostrar na live' : 'Ocultar da live'}">${viewIcon(layer.viewVisible === false, 12)}</button>
        <button class="lsa-btn" onclick="moveLayer('${layer.id}',-1)" title="Subir">↑</button>
        <button class="lsa-btn" onclick="moveLayer('${layer.id}',1)" title="Descer">↓</button>
        <button class="lsa-btn" onclick="deleteLayer('${layer.id}')" title="Excluir camada" style="color:#ff6060">
          <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>`;

    // Clicar no header = ativar essa camada e selecionar todos os objetos dela
    // Click simples (delay para não conflitar com dblclick de rename)
    header.addEventListener('click', e => {
      if (e.target.closest('.lsa-btn')) return;
      clearTimeout(header._clickTimer);
      header._clickTimer = setTimeout(() => {
        if (!layer.locked) activeLayerId = layer.id;
        syncDrawingMode();
        applyPanelSelection(layerObjs.filter(o => !isLocked(o)));
      }, 200);
    });
    // Duplo clique no nome = renomear camada
    header.querySelector('[data-rename]').addEventListener('dblclick', e => {
      e.stopPropagation();
      clearTimeout(header._clickTimer);
      startRename(layer.id, e.currentTarget);
    });

    // Drop no header da camada = mover objeto(s) para essa camada
    header.addEventListener('dragover', e => {
      if (!layerDragSrcId) return;
      e.preventDefault();
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      header.classList.add('drag-over');
    });
    header.addEventListener('dragleave', () => header.classList.remove('drag-over'));
    header.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      header.classList.remove('drag-over');
      if (layer.locked) { layerDragSrcId = null; return; } // camada travada não recebe conteúdo novo
      const dragData = e.dataTransfer.getData('text/plain');
      let idsToMove = [];
      if (dragData.startsWith('__pathgroup__')) {
        // Grupo de traços — move todos
        idsToMove = dragData.replace('__pathgroup__', '').split(',').filter(Boolean);
      } else if (layerDragSrcId) {
        idsToMove = [layerDragSrcId];
      }
      idsToMove.forEach(id => {
        const obj = findById(id);
        if (obj && !isLocked(obj) && obj.layerId !== layer.id) {
          obj.layerId = layer.id;
          const s = ser(obj);
          if (s) socket.emit('object:modify:commit', s);
        }
      });
      if (idsToMove.length) {
        applyLayerZOrder();
        socket.emit('zorder:sync', canvas.getObjects().map(o => o.id).filter(Boolean));
      }
      layerDragSrcId = null;
      scheduleLayersUpdate();
    });

    section.appendChild(header);

    if (!isCollapsed) {
      const objsDiv = document.createElement('div');
      objsDiv.className = 'layer-section-objects';

      // ── Helper: cria item de objeto (traço ou objeto individual) ───────────
      // Objetos de um grupo passam por aqui também (chamados por
      // renderGroupBlock) — continuam totalmente interativos (seleção, drag,
      // visibilidade, exclusão), diferente do antigo fabric.Group que só
      // mostrava os filhos como preview estático.
      function makeObjItem(obj, indent, parentDiv) {
        const isCanSel = canvasSel.has(obj.id);
        const isHid    = hiddenObjects.has(obj.id);
        const locked   = isLocked(obj);
        const accent   = obj.stroke || (obj.fill && obj.fill !== 'transparent' ? obj.fill : null) || '#7c5cff';
        const eyeSvg   = isHid
          ? `<svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
          : `<svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

        const item = document.createElement('div');
        item.className = 'layer-item' + (isCanSel ? ' selected' : '');
        item.style.paddingLeft = indent + 'px';
        item.draggable = !locked;
        item.dataset.id = obj.id;

        item.innerHTML = `
          <div class="layer-drag-handle" title="Arrastar para reordenar ou mover de camada">⋮⋮</div>
          <span style="width:14px;flex-shrink:0;display:inline-block"></span>
          <div class="layer-icon" style="color:${accent}">${getLayerIcon(obj.type, obj)}</div>
          <span class="layer-name" data-rename="${obj.id}" title="Duplo clique = renomear">${getDisplayName(obj)}</span>
          <div class="layer-actions">
            <button class="layer-action-btn ${obj.locked ? 'locked-obj' : ''}" onclick="toggleObjLock('${obj.id}')" title="${obj.locked ? 'Destravar' : 'Travar'}">${lockIcon(obj.locked)}</button>
            <button class="layer-action-btn ${isHid ? 'hidden-obj' : ''}" ${locked ? 'disabled' : ''} onclick="toggleObjVisibility('${obj.id}')" title="${isHid ? 'Mostrar no board' : 'Ocultar do board'}">${eyeSvg}</button>
            <button class="layer-action-btn ${obj.viewHidden ? 'view-hidden-obj' : ''}" ${locked ? 'disabled' : ''} onclick="toggleObjViewVisibility('${obj.id}')" title="${obj.viewHidden ? 'Mostrar na live' : 'Ocultar da live'}">${viewIcon(!!obj.viewHidden)}</button>
            <button class="layer-action-btn" ${locked ? 'disabled' : ''} onclick="deleteObjById('${obj.id}')" style="color:#ff6060" title="Excluir">
              <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
          </div>`;

        // Duplo clique no nome → renomear; cancela o select pendente do 1º clique
        item.querySelector('[data-rename]').addEventListener('dblclick', e => {
          e.stopPropagation();
          clearTimeout(item._clickTimer);
          startRename(obj.id, e.currentTarget);
        });

        clickableEntries.push([obj.id]);

        // Click simples → selecionar; shift+click = intervalo; ctrl/cmd+click = alternar
        // (delay de 200ms para não conflitar com dblclick). Objeto travado não seleciona.
        item.addEventListener('click', e => {
          if (e.target.closest('.layer-action-btn,.layer-drag-handle,.layer-expand-btn')) return;
          if (locked) return;
          clearTimeout(item._clickTimer);
          const shiftKey = e.shiftKey, ctrlKey = e.ctrlKey, metaKey = e.metaKey;
          item._clickTimer = setTimeout(() => {
            handlePanelItemClick({ shiftKey, ctrlKey, metaKey }, [obj.id]);
          }, 200);
        });

        // Drag: reorder dentro da camada OU mover para outra camada (drop no header)
        item.addEventListener('dragstart', e => {
          if (locked) { e.preventDefault(); return; }
          layerDragSrcId = obj.id;
          item.style.opacity = '.5';
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', obj.id);
        });
        item.addEventListener('dragend', () => {
          item.style.opacity = '';
          document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });
        item.addEventListener('dragover', e => {
          if (locked) return;
          e.preventDefault();
          document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
          item.classList.add('drag-over');
        });
        item.addEventListener('drop', e => {
          e.preventDefault(); e.stopPropagation();
          item.classList.remove('drag-over');
          if (locked || !layerDragSrcId || layerDragSrcId === obj.id) return;
          const src = findById(layerDragSrcId); if (!src) return;
          // Reorder dentro da camada
          canvas.moveTo(src, allObjs.indexOf(obj));
          canvas.renderAll();
          socket.emit('zorder:sync', canvas.getObjects().map(o => o.id).filter(Boolean));
          scheduleLayersUpdate(); layerDragSrcId = null;
        });

        parentDiv.appendChild(item);
      }

      // ── Helper: cabeçalho de grupo (etiqueta groupId) ──────────────────────
      // Grupo não é mais um container fabric.Group — é só um cabeçalho no
      // painel que lista seus membros, todos renderizados por makeObjItem
      // (logo continuam individualmente selecionáveis/editáveis). Clicar no
      // cabeçalho seleciona todos os membros de uma vez (ActiveSelection).
      function renderGroupBlock(groupId, members, parentDiv) {
        const group    = boardGroups.find(g => g.id === groupId);
        const name     = (group && group.name) || 'Grupo';
        const locked   = !!(group && group.locked);
        const isCollG  = collapsedGroups.has(groupId);
        const memberIds = members.map(m => m.id);
        const anySel   = members.some(m => canvasSel.has(m.id));

        const header = document.createElement('div');
        header.className = 'layer-item is-group' + (anySel ? ' selected' : '');
        header.style.paddingLeft = '18px';
        header.dataset.groupId = groupId;
        header.innerHTML = `
          <span style="width:14px;flex-shrink:0;display:inline-block"></span>
          <button class="layer-expand-btn ${isCollG?'':'open'}" onclick="collapsedGroups.has('${groupId}')?collapsedGroups.delete('${groupId}'):collapsedGroups.add('${groupId}');scheduleLayersUpdate();event.stopPropagation()">
            <svg width="9" height="9" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="layer-icon">${getLayerIcon('group')}</div>
          <span class="layer-name" data-rename="${groupId}" title="Duplo clique = renomear">${escapeHtml(name)}</span>
          <span style="font-size:9px;color:var(--muted);flex-shrink:0">${members.length}</span>
          <div class="layer-actions">
            <button class="layer-action-btn ${locked ? 'locked-obj' : ''}" onclick="toggleGroupLock('${groupId}',event)" title="${locked ? 'Destravar grupo' : 'Travar grupo'}">${lockIcon(locked)}</button>
            <button class="layer-action-btn ${group && group.viewHidden ? 'view-hidden-obj' : ''}" onclick="toggleGroupViewVisibility('${groupId}',event)" title="${group && group.viewHidden ? 'Mostrar na live' : 'Ocultar da live'}">${viewIcon(!!(group && group.viewHidden))}</button>
            <button class="layer-action-btn" onclick="ungroupByIds(['${memberIds.join("','")}'])" title="Desagrupar">
              <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="8" height="8" rx="1"/><rect x="14" y="8" width="8" height="8" rx="1"/></svg>
            </button>
          </div>`;

        header.querySelector('[data-rename]').addEventListener('dblclick', e => {
          e.stopPropagation();
          startRename(groupId, e.currentTarget);
        });

        clickableEntries.push(memberIds);
        header.addEventListener('click', e => {
          if (e.target.closest('.layer-action-btn,.layer-expand-btn')) return;
          handlePanelItemClick(e, memberIds);
        });

        parentDiv.appendChild(header);

        if (!isCollG) {
          members.forEach(m => makeObjItem(m, 32, parentDiv));
        }
      }

      // ── Renderiza em ordem real do canvas (topo → fundo) ──────────────────
      // Agrupa traços CONSECUTIVOS DA MESMA COR em um único item "N traços [cor]".
      // Traços de cores diferentes ou intercalados com objetos aparecem separados.
      const orderedDesc = [...layerObjs].reverse(); // topo do canvas primeiro
      const renderedGroupIds = new Set();
      let i = 0;
      while (i < orderedDesc.length) {
        const obj = orderedDesc[i];
        // Objeto agrupado (groupId) — renderiza (ou pula, se o grupo já foi
        // desenhado) o cabeçalho do grupo com todos os seus membros, em vez de
        // cair no agrupamento anônimo de traços ou no item individual abaixo.
        if (obj.groupId) {
          if (renderedGroupIds.has(obj.groupId)) { i++; continue; }
          renderedGroupIds.add(obj.groupId);
          const members = orderedDesc.filter(o => o.groupId === obj.groupId);
          renderGroupBlock(obj.groupId, members, objsDiv);
          i++;
          continue;
        }
        // Setas são paths mas tratadas como objetos individuais
        if (obj.type === 'path' && !obj._isArrow) {
          // Coleta traços consecutivos da mesma cor (excluindo setas e objetos agrupados)
          const groupColor = obj.stroke || '#ffffff';
          const pathGroup  = [];
          while (i < orderedDesc.length &&
                 orderedDesc[i].type === 'path' &&
                 !orderedDesc[i]._isArrow &&
                 !orderedDesc[i].groupId &&
                 (orderedDesc[i].stroke || '#ffffff') === groupColor) {
            pathGroup.push(orderedDesc[i]); i++;
          }
          const pathsHidden  = pathGroup.every(p => hiddenObjects.has(p.id));
          const pathsPartial = !pathsHidden && pathGroup.some(p => hiddenObjects.has(p.id));
          const eyeOpacity   = pathsHidden ? '0.3' : (pathsPartial ? '0.6' : '1');
          const eyeSvg = pathsHidden
            ? `<svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
            : `<svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
          const pathsViewHidden  = pathGroup.every(p => p.viewHidden);
          const pathsViewPartial = !pathsViewHidden && pathGroup.some(p => p.viewHidden);
          const viewEyeOpacity   = pathsViewHidden ? '1' : (pathsViewPartial ? '0.6' : '.6');

          const pathItemSelected = pathGroup.some(p => canvasSel.has(p.id));
          const pathItem = document.createElement('div');
          pathItem.className = 'layer-item' + (pathItemSelected ? ' selected' : '');
          pathItem.style.paddingLeft = '18px';
          pathItem.style.cursor = 'default';
          pathItem.draggable = true;
          pathItem.dataset.pathGroup = pathGroup.map(p => p.id).join(',');
          pathItem.innerHTML = `
            <div class="layer-drag-handle" title="Arrastar para mover traços para outra camada">⋮⋮</div>
            <span style="width:14px;flex-shrink:0;display:inline-block"></span>
            <div class="layer-icon">
              <svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="${groupColor}" stroke="none"/></svg>
            </div>
            <span class="layer-name" style="color:var(--muted)">
              ${pathGroup.length} traço${pathGroup.length > 1 ? 's' : ''}
            </span>
            <div class="layer-actions">
              <button class="layer-action-btn" style="opacity:${eyeOpacity}" title="${pathsHidden ? 'Mostrar no board' : 'Ocultar do board'}"
                onclick="togglePathGroup([${pathGroup.map(p => `'${p.id}'`).join(',')}])">
                ${eyeSvg}
              </button>
              <button class="layer-action-btn ${pathsViewHidden ? 'view-hidden-obj' : ''}" style="opacity:${viewEyeOpacity}" title="${pathsViewHidden ? 'Mostrar na live' : 'Ocultar da live'}"
                onclick="toggleViewPathGroup([${pathGroup.map(p => `'${p.id}'`).join(',')}])">
                ${viewIcon(pathsViewHidden)}
              </button>
              <button class="layer-action-btn" style="color:#ff6060" title="Excluir traços"
                onclick="deletePathGroup([${pathGroup.map(p => `'${p.id}'`).join(',')}])">
                <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              </button>
            </div>`;

          const pathGroupIds = pathGroup.map(p => p.id);
          clickableEntries.push(pathGroupIds);

          // Seleciona todos os traços do grupo no canvas; shift = intervalo, ctrl/cmd = alternar
          pathItem.addEventListener('click', e => {
            if (e.target.closest('.layer-action-btn,.layer-drag-handle')) return;
            handlePanelItemClick(e, pathGroupIds);
          });
          pathItem.addEventListener('dragstart', e => {
            layerDragSrcId = pathGroup[0].id;
            pathItem.style.opacity = '.5';
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', '__pathgroup__' + pathGroup.map(p => p.id).join(','));
          });
          pathItem.addEventListener('dragend', () => {
            pathItem.style.opacity = '';
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
          });
          // dragover + drop: permite reordenar entre grupos de traços E entre traços e outros objetos
          pathItem.addEventListener('dragover', e => {
            e.preventDefault();
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            pathItem.classList.add('drag-over');
          });
          pathItem.addEventListener('drop', e => {
            e.preventDefault(); e.stopPropagation();
            pathItem.classList.remove('drag-over');
            const dragData = e.dataTransfer.getData('text/plain');
            // Move o(s) objeto(s) arrastado(s) para a posição do primeiro traço deste grupo
            const targetObj = pathGroup[pathGroup.length - 1]; // mais fundo do grupo = referência
            const targetIdx = allObjs.indexOf(targetObj);
            if (dragData.startsWith('__pathgroup__')) {
              // Outro grupo de traços sendo reordenado
              const srcIds = dragData.replace('__pathgroup__', '').split(',').filter(Boolean);
              srcIds.forEach((id, k) => {
                const src = findById(id); if (!src) return;
                canvas.moveTo(src, Math.max(0, targetIdx - k));
              });
            } else if (layerDragSrcId) {
              // Objeto individual
              const src = findById(layerDragSrcId); if (src) canvas.moveTo(src, targetIdx);
            }
            canvas.renderAll();
            socket.emit('zorder:sync', canvas.getObjects().map(o => o.id).filter(Boolean));
            scheduleLayersUpdate();
            layerDragSrcId = null;
          });
          objsDiv.appendChild(pathItem);
        } else {
          makeObjItem(obj, 18, objsDiv);
          i++;
        }
      }

      if (layerObjs.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:6px 20px;font-size:10px;color:var(--muted);font-style:italic';
        empty.textContent = 'Camada vazia';
        objsDiv.appendChild(empty);
      }

      section.appendChild(objsDiv);
    }

    frag.appendChild(section);
  });

  // Troca todo o conteúdo de uma vez (um reflow em vez de um por seção).
  list.innerHTML = '';
  list.appendChild(frag);

  updateLayerToolbar();
}

// Flag: houve um pedido de atualização enquanto o painel estava recolhido, então
// o DOM não foi reconstruído. Ao reabrir, precisamos reconstruir uma vez.
let _panelDirtyWhileCollapsed = false;
export function flushLayersPanelIfDirty() {
  if (_panelDirtyWhileCollapsed) { _panelDirtyWhileCollapsed = false; scheduleLayersUpdate(); }
}

function toggleObjVisibility(id) {
  const obj = findById(id); if (!obj || isLocked(obj)) return;
  let data;
  if (hiddenObjects.has(id)) {
    hiddenObjects.delete(id);
    obj.set({ opacity: obj._savedOpacity ?? 1, visible: true }); delete obj._savedOpacity;
    data = { ...ser(obj), _visibilityChange: true };
  } else {
    const prevOpacity = obj.opacity;
    hiddenObjects.add(id); obj._savedOpacity = prevOpacity; obj.set({ opacity:0, visible:false });
    // Envia a opacidade original junto — sem isso, outros clientes que também
    // recebam este objeto não têm como saber para qual opacidade restaurar depois.
    data = { ...ser(obj), _visibilityChange: true, _prevOpacity: prevOpacity };
  }
  socket.emit('object:modify', data);
  canvas.renderAll(); scheduleLayersUpdate();
}

// Oculta/mostra um grupo de traços de uma vez
function togglePathGroup(ids) {
  const allHidden = ids.every(id => hiddenObjects.has(id));
  ids.forEach(id => {
    const obj = findById(id); if (!obj) return;
    let data;
    if (allHidden) {
      hiddenObjects.delete(id);
      obj.set({ opacity: obj._savedOpacity ?? 1, visible: true }); delete obj._savedOpacity;
      data = { ...ser(obj), _visibilityChange: true };
    } else {
      if (!hiddenObjects.has(id)) {
        const prevOpacity = obj.opacity;
        hiddenObjects.add(id); obj._savedOpacity = prevOpacity; obj.set({ opacity: 0, visible: false });
        data = { ...ser(obj), _visibilityChange: true, _prevOpacity: prevOpacity };
      } else {
        data = { ...ser(obj), _visibilityChange: true };
      }
    }
    socket.emit('object:modify', data);
  });
  canvas.renderAll(); scheduleLayersUpdate();
}

// Exclui todos os traços de um grupo de uma vez
function deletePathGroup(ids) {
  const objs = ids.map(id => findById(id)).filter(Boolean);
  if (!objs.length) return;
  objs.forEach(o => canvas.remove(o));
  canvas.discardActiveObject();
  canvas.renderAll();
  socket.emit('object:remove', ids);
  scheduleLayersUpdate();
}

function deleteObjById(id) {
  const obj = findById(id); if (!obj || isLocked(obj)) return;
  canvas.remove(obj); canvas.discardActiveObject(); canvas.renderAll();
  socket.emit('object:remove', [id]);
  panelSelected.delete(id); scheduleLayersUpdate();
}

canvas.on('object:added',      scheduleLayersUpdate);
canvas.on('object:removed',    e => {
  // Para o loop de animação e libera os frames se o objeto removido era um GIF.
  // O Fabric emite este evento com { target } (não o objeto direto) — a versão
  // anterior lia `obj._isGif` do wrapper do evento, que é sempre undefined, e
  // por isso o cleanup NUNCA rodava (GIFs deletados seguiam animando e seus
  // ImageBitmaps vazavam). Como todo caminho de remoção passa por canvas.remove
  // (Delete, object:remove remoto, deletePathGroup, loadState), consertar aqui
  // cobre todos eles de uma vez.
  const obj = e && e.target;
  if (obj && obj._isGif && obj.id) {
    activeGifs.delete(obj.id);
  }
  scheduleLayersUpdate();
});
canvas.on('selection:created', () => { scheduleLayersUpdate(); updateLayerToolbar(); });
canvas.on('selection:updated', () => { scheduleLayersUpdate(); updateLayerToolbar(); });
canvas.on('selection:cleared', () => { scheduleLayersUpdate(); updateLayerToolbar(); });


export {
  hiddenObjects, collapsedLayers, collapsedGroups,
  scheduleLayersPanel,
  ensureActiveLayer, addLayer, deleteLayer, toggleLayerVisibility, moveLayer,
  applyLayerZOrder, updateLayersPanel, isLayerLocked,
  toggleObjVisibility, togglePathGroup, deletePathGroup, deleteObjById,
  toggleObjLock, toggleLayerLock, toggleGroupLock, lockIcon,
  toggleObjViewVisibility, toggleViewPathGroup, toggleLayerViewVisibility, toggleGroupViewVisibility,
};
