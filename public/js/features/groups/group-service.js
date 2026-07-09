// ─── Agrupar / Desagrupar objetos ─────────────────────────────────────────────
// Grupo é só uma etiqueta (`groupId`) em cada objeto, igual à camada
// (`layerId`) — não existe mais um `fabric.Group` real envolvendo os filhos.
// Isso significa que membros de um grupo continuam individualmente
// selecionáveis/editáveis no canvas (Fabric 5.3.1 não suporta edição
// "interactive" de grupo real — essa é a alternativa). Selecionar o grupo
// inteiro de uma vez acontece pelo painel (clique no cabeçalho do grupo monta
// uma ActiveSelection com todos os membros — ver layers-panel.js).
import { canvas } from '../../core/canvas-manager.js';
import { ser, serTransformAbsolute } from '../../core/serialization.js';
import {
  activeLayerId, genId, typeCounters, socket, scheduleLayersUpdate,
} from '../../board-app.js';
import { boardGroups } from '../layers/layers-panel.js';

// ── Toolbar: habilita botões ──────────────────────────────────────────────────
function updateLayerToolbar() {
  const btnG = document.getElementById('lt-group');
  const btnU = document.getElementById('lt-ungroup');
  if (!btnG) return;
  const selObjs = canvas.getActiveObjects().filter(o => !o._isViewportRect);
  // Já é exatamente um grupo existente (mesmo groupId em todos os selecionados
  // E nenhum outro membro daquele grupo ficou de fora) — "Agrupar" de novo
  // não faria nada, então mantém o botão desabilitado.
  const gid = selObjs.length >= 2 ? selObjs[0].groupId : null;
  const isExactExistingGroup = !!gid
    && selObjs.every(o => o.groupId === gid)
    && canvas.getObjects().filter(o => o.groupId === gid).length === selObjs.length;
  btnG.disabled = selObjs.length < 2 || isExactExistingGroup;
  btnU.disabled = !selObjs.some(o => o.groupId);
}

// Serializa uma lista de objetos respeitando o caso de estarem dentro de uma
// activeSelection: nesse período o Fabric converte left/top dos filhos para
// coordenadas relativas ao grupo de seleção, não ao canvas (mesmo problema já
// tratado em ui/selection-toolbar.js -> emitModifyWithAbsPos). Serializar
// direto com `ser()` aqui gravaria essas coordenadas relativas no histórico
// de undo/redo — um Ctrl+Z/Y que restaurasse esse snapshot reposicionaria os
// objetos pertinho da origem (canto superior esquerdo da viewport).
function serAbsList(targets) {
  const active = canvas.getActiveObject();
  if (active && active.type === 'activeSelection') {
    const gm = active.calcTransformMatrix();
    return targets.map(o => {
      const data = ser(o); if (!data) return null;
      Object.assign(data, serTransformAbsolute(o, gm));
      return data;
    }).filter(Boolean);
  }
  return targets.map(ser).filter(Boolean);
}

// Remove groupId de uma lista de objetos e limpa da boardGroups qualquer
// grupo que tenha ficado sem membros. Reaproveitada tanto por ungroupSelected()
// (toolbar, opera na seleção atual) quanto por ungroupByIds() (painel, opera
// numa lista explícita de ids vinda do cabeçalho do grupo).
function ungroupObjects(targets) {
  if (!targets.length) return;
  const groupIds = new Set(targets.map(o => o.groupId).filter(Boolean));
  targets.forEach(o => { o.groupId = null; });
  canvas.renderAll();

  groupIds.forEach(gid => {
    const stillUsed = canvas.getObjects().some(o => o.groupId === gid);
    if (!stillUsed) {
      const idx = boardGroups.findIndex(g => g.id === gid);
      if (idx !== -1) boardGroups.splice(idx, 1);
    }
  });
  socket.emit('groups:update', boardGroups);
  const updates = serAbsList(targets);
  if (updates.length) socket.emit('objects:modify:commit', updates);
  scheduleLayersUpdate();
}

// ── Agrupar / Desagrupar ──────────────────────────────────────────────────────
function groupSelected() {
  const targets = canvas.getActiveObjects().filter(o => !o._isViewportRect);
  if (targets.length < 2) return;

  const layId = targets[0].layerId || activeLayerId;
  const id    = 'group-' + genId();
  typeCounters['Grupo'] = (typeCounters['Grupo'] || 0) + 1;
  boardGroups.push({ id, name: `Grupo ${typeCounters['Grupo']}`, locked: false, viewHidden: false });

  targets.forEach(o => { o.groupId = id; o.layerId = layId; });
  canvas.renderAll();

  socket.emit('groups:update', boardGroups);
  const updates = serAbsList(targets);
  if (updates.length) socket.emit('objects:modify:commit', updates);
  scheduleLayersUpdate();
}

function ungroupSelected() {
  const targets = canvas.getActiveObjects().filter(o => !o._isViewportRect && o.groupId);
  ungroupObjects(targets);
}

// Chamada pelo botão "Desagrupar" do cabeçalho do grupo no painel — opera
// direto nos ids do grupo, sem depender da seleção atual do canvas.
function ungroupByIds(ids) {
  ungroupObjects(ids.map(id => canvas.getObjects().find(o => o.id === id)).filter(Boolean));
}

export { updateLayerToolbar, groupSelected, ungroupSelected, ungroupByIds };
