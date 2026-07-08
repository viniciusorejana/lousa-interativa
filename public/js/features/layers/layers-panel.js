// ─── Painel de camadas (estilo Photoshop) ─────────────────────────────────────
// Extraído de board-app.js: estado de camadas, gerenciamento (criar/mover/
// excluir/visibilidade), renderização do painel, ações sobre objetos vindas do
// painel (mostrar/ocultar, excluir), e o drag-and-drop de objetos entre
// camadas. Import circular controlado com board-app.js — só usado dentro de
// corpo de função (ver ARCHITECTURE.md).
import { canvas } from '../../core/canvas-manager.js';
import { ser } from '../../core/serialization.js';
import { activeGifs } from '../media/gif-service.js';
import { updateLayerToolbar } from '../groups/group-service.js';
import { socket, genId, showToast, findById, vpRect } from '../../board-app.js';

// ── Sistema de camadas ────────────────────────────────────────────────────────
export const boardLayers = [{ id: 'layer-default', name: 'Camada 1', visible: true }];
export let activeLayerId  = 'layer-default';
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
function getDisplayName(obj) {
  if (obj.type === 'i-text' || obj.type === 'text') {
    const t = (obj.text || '').trim().slice(0, 18);
    return objectNames[obj.id] || (t ? `"${t}"` : 'Texto');
  }
  return objectNames[obj.id] || (obj._isArrow ? 'Seta' : obj.type);
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

// ── Gerenciar camadas ─────────────────────────────────────────────────────────
// Garante que activeLayerId aponta para uma camada que existe.
// Chamado após F5 (board:init), após deleteLayer, e antes de qualquer new object.
function ensureActiveLayer() {
  if (!boardLayers.length) {
    // Caso extremo: não há nenhuma camada — cria uma
    boardLayers.length = 0;
    boardLayers.push({ id: 'layer-default-' + genId(), name: 'Camada 1', visible: true });
    socket.emit('layers:update', boardLayers);
  }
  const valid = boardLayers.find(l => l.id === activeLayerId);
  if (!valid) {
    activeLayerId = boardLayers[0].id;
  }
}

function addLayer() {
  const n    = boardLayers.length + 1;
  const newL = { id: 'layer-' + genId(), name: `Camada ${n}`, visible: true };
  boardLayers.unshift(newL);   // nova camada no topo
  activeLayerId = newL.id;
  socket.emit('layers:update', boardLayers);
  scheduleLayersUpdate();
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
  // Objetos sem camada (criados antes de ter camada, ou após F5 com camada deletada)
  // são reatribuídos à camada ativa
  allObjs.forEach(o => {
    if (!o.layerId || !boardLayers.find(l => l.id === o.layerId)) {
      o.layerId = activeLayerId;
    }
    assignDefaultName(o);
  });

  if (!boardLayers.length) {
    list.innerHTML = '<div id="layers-empty">Nenhuma camada</div>';
    return;
  }

  const canvasSel = new Set(canvas.getActiveObjects().map(o => o.id));
  list.innerHTML = '';

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
      <span class="layer-section-name" data-rename="${layer.id}">${layer.name}</span>
      <span style="font-size:9px;color:var(--muted);flex-shrink:0">${layerObjs.length}</span>
      <div class="layer-section-actions">
        <button class="lsa-btn ${layer.visible ? '' : 'hidden-layer'}" onclick="toggleLayerVisibility('${layer.id}',event)">${eyeIcon}</button>
        <button class="lsa-btn" onclick="moveLayer('${layer.id}',-1)" title="Subir">↑</button>
        <button class="lsa-btn" onclick="moveLayer('${layer.id}',1)" title="Descer">↓</button>
        <button class="lsa-btn" onclick="deleteLayer('${layer.id}')" title="Excluir camada" style="color:#ff6060">
          <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>`;

    // Clicar no header = ativar essa camada
    // Click simples = ativar camada (delay para não conflitar com dblclick de rename)
    header.addEventListener('click', e => {
      if (e.target.closest('.lsa-btn')) return;
      clearTimeout(header._clickTimer);
      header._clickTimer = setTimeout(() => {
        activeLayerId = layer.id;
        scheduleLayersUpdate();
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
        if (obj && obj.layerId !== layer.id) {
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

      // ── Helper: cria item de objeto (traço ou objeto) ──────────────────────
      function makeObjItem(obj, indent, parentDiv) {
        const isCanSel = canvasSel.has(obj.id);
        const isGroup  = obj.type === 'group';
        const isCollG  = collapsedGroups.has(obj.id);
        const isHid    = hiddenObjects.has(obj.id);
        const accent   = obj.stroke || (obj.fill && obj.fill !== 'transparent' ? obj.fill : null) || '#7c5cff';
        const eyeSvg   = isHid
          ? `<svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
          : `<svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

        const item = document.createElement('div');
        item.className = 'layer-item' + (isCanSel ? ' selected' : '') + (isGroup ? ' is-group' : '');
        item.style.paddingLeft = indent + 'px';
        item.draggable = true;
        item.dataset.id = obj.id;

        const expandHtml = isGroup
          ? `<button class="layer-expand-btn ${isCollG?'':'open'}" onclick="collapsedGroups.has('${obj.id}')?collapsedGroups.delete('${obj.id}'):collapsedGroups.add('${obj.id}');scheduleLayersUpdate();event.stopPropagation()">
              <svg width="9" height="9" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>`
          : `<span style="width:14px;flex-shrink:0;display:inline-block"></span>`;

        item.innerHTML = `
          <div class="layer-drag-handle" title="Arrastar para reordenar ou mover de camada">⋮⋮</div>
          ${expandHtml}
          <div class="layer-icon" style="color:${accent}">${getLayerIcon(obj.type, obj)}</div>
          <span class="layer-name" data-rename="${obj.id}" title="Duplo clique = renomear">${getDisplayName(obj)}</span>
          <div class="layer-actions">
            <button class="layer-action-btn ${isHid ? 'hidden-obj' : ''}" onclick="toggleObjVisibility('${obj.id}')" title="${isHid ? 'Mostrar' : 'Ocultar'}">${eyeSvg}</button>
            <button class="layer-action-btn" onclick="deleteObjById('${obj.id}')" style="color:#ff6060" title="Excluir">
              <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
          </div>`;

        // Duplo clique no nome → renomear; cancela o select pendente do 1º clique
        item.querySelector('[data-rename]').addEventListener('dblclick', e => {
          e.stopPropagation();
          clearTimeout(item._clickTimer);
          startRename(obj.id, e.currentTarget);
        });

        // Click simples → selecionar (delay de 200ms para não conflitar com dblclick)
        item.addEventListener('click', e => {
          if (e.target.closest('.layer-action-btn,.layer-drag-handle,.layer-expand-btn')) return;
          clearTimeout(item._clickTimer);
          item._clickTimer = setTimeout(() => {
            canvas.setActiveObject(obj); canvas.renderAll(); scheduleLayersUpdate();
          }, 200);
        });

        // Drag: reorder dentro da camada OU mover para outra camada (drop no header)
        item.addEventListener('dragstart', e => {
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
          e.preventDefault();
          document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
          item.classList.add('drag-over');
        });
        item.addEventListener('drop', e => {
          e.preventDefault(); e.stopPropagation();
          item.classList.remove('drag-over');
          if (!layerDragSrcId || layerDragSrcId === obj.id) return;
          const src = findById(layerDragSrcId); if (!src) return;
          // Reorder dentro da camada
          canvas.moveTo(src, allObjs.indexOf(obj));
          canvas.renderAll();
          socket.emit('zorder:sync', canvas.getObjects().map(o => o.id).filter(Boolean));
          scheduleLayersUpdate(); layerDragSrcId = null;
        });

        parentDiv.appendChild(item);

        // Filhos do grupo — apenas exibição (sem drag nem visibilidade individual)
        if (isGroup && !isCollG) {
          const children = obj.getObjects ? obj.getObjects() : [];
          [...children].reverse().forEach(ch => {
            if (!ch.id) ch.id = genId(); assignDefaultName(ch);
            const ci = document.createElement('div');
            ci.className = 'layer-item is-group-child';
            ci.style.paddingLeft = (indent + 14) + 'px';
            ci.innerHTML = `
              <div class="layer-icon" style="color:var(--muted);opacity:.6">${getLayerIcon(ch.type, ch)}</div>
              <span class="layer-name" style="font-size:10px;color:var(--muted)">${getDisplayName(ch)}</span>`;
            parentDiv.appendChild(ci);
          });
        }
      }

      // ── Renderiza em ordem real do canvas (topo → fundo) ──────────────────
      // Agrupa traços CONSECUTIVOS DA MESMA COR em um único item "N traços [cor]".
      // Traços de cores diferentes ou intercalados com objetos aparecem separados.
      const orderedDesc = [...layerObjs].reverse(); // topo do canvas primeiro
      let i = 0;
      while (i < orderedDesc.length) {
        const obj = orderedDesc[i];
        // Setas são paths mas tratadas como objetos individuais
        if (obj.type === 'path' && !obj._isArrow) {
          // Coleta traços consecutivos da mesma cor (excluindo setas)
          const groupColor = obj.stroke || '#ffffff';
          const pathGroup  = [];
          while (i < orderedDesc.length &&
                 orderedDesc[i].type === 'path' &&
                 !orderedDesc[i]._isArrow &&
                 (orderedDesc[i].stroke || '#ffffff') === groupColor) {
            pathGroup.push(orderedDesc[i]); i++;
          }
          const pathsHidden  = pathGroup.every(p => hiddenObjects.has(p.id));
          const pathsPartial = !pathsHidden && pathGroup.some(p => hiddenObjects.has(p.id));
          const eyeOpacity   = pathsHidden ? '0.3' : (pathsPartial ? '0.6' : '1');
          const eyeSvg = pathsHidden
            ? `<svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
            : `<svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

          const pathItem = document.createElement('div');
          pathItem.className = 'layer-item';
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
              <button class="layer-action-btn" style="opacity:${eyeOpacity}" title="${pathsHidden ? 'Mostrar' : 'Ocultar'}"
                onclick="togglePathGroup([${pathGroup.map(p => `'${p.id}'`).join(',')}])">
                ${eyeSvg}
              </button>
              <button class="layer-action-btn" style="color:#ff6060" title="Excluir traços"
                onclick="deletePathGroup([${pathGroup.map(p => `'${p.id}'`).join(',')}])">
                <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              </button>
            </div>`;

          pathItem.addEventListener('click', e => {
            if (e.target.closest('.layer-action-btn,.layer-drag-handle')) return;
            // Seleciona todos os traços do grupo no canvas
            const pathObjs = pathGroup.map(p => findById(p.id)).filter(Boolean);
            if (pathObjs.length === 1) {
              canvas.setActiveObject(pathObjs[0]);
            } else if (pathObjs.length > 1) {
              const sel = new fabric.ActiveSelection(pathObjs, { canvas });
              canvas.setActiveObject(sel);
            }
            canvas.renderAll();
            scheduleLayersUpdate();
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

    list.appendChild(section);
  });

  updateLayerToolbar();
}

function toggleObjVisibility(id) {
  const obj = findById(id); if (!obj) return;
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
  const obj = findById(id); if (!obj) return;
  canvas.remove(obj); canvas.discardActiveObject(); canvas.renderAll();
  socket.emit('object:remove', [id]);
  panelSelected.delete(id); scheduleLayersUpdate();
}

canvas.on('object:added',      scheduleLayersUpdate);
canvas.on('object:removed',    obj => {
  // Para o loop de animação se o objeto removido era um GIF
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
  applyLayerZOrder, updateLayersPanel,
  toggleObjVisibility, togglePathGroup, deletePathGroup, deleteObjById,
};
