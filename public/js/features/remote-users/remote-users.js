// ─── Cursores, traços e formas em streaming de outros usuários ───────────────
// Módulo de renderização pura: recebe eventos de socket sobre o que os outros
// usuários da sala estão fazendo agora (desenhando, arrastando uma forma,
// movendo o mouse) e desenha os overlays correspondentes no canvas / DOM.
// Nenhum estado daqui é persistido — é tudo efêmero, por usuário conectado.
import { canvas } from '../../core/canvas-manager.js';
// Import circular com board-app.js — aceitável desde que os bindings só sejam
// usados dentro de corpo de função (nunca no nível superior do módulo, nem
// dentro de `initRemoteUsersSocketListeners` chamada antes da hora). Ver regra
// em CLAUDE.md / ARCHITECTURE.md.
import { socket, vpRect, myId, applyFull, mkShape, pts2path } from '../../board-app.js';

const remoteStrokes = {};
const remoteShapes  = {};
const remoteCursors = {};

// Chamar só depois que `socket` (export const em board-app.js) já existe —
// mesma exigência já documentada em staging-area.js/initStagingSocketListeners.
export function initRemoteUsersSocketListeners() {
  // ── Streaming de traço livre (pen) ─────────────────────────────────────────
  socket.on('draw:start', ({ userId, x, y, color: c, width: w, opacity: opa }) => {
    if (userId === myId) return;
    const p = new fabric.Path('M ' + x + ' ' + y, {
      stroke: c, strokeWidth: w, fill: null, opacity: opa,
      strokeLineCap: 'round', strokeLineJoin: 'round', selectable: false, evented: false
    });
    remoteStrokes[userId] = { path: p, pts: [{ x, y }] };
    canvas.add(p); canvas.renderAll();
  });
  socket.on('draw:move', ({ userId, x, y }) => {
    if (userId === myId) return;
    const s = remoteStrokes[userId];
    if (!s) return;
    s.pts.push({ x, y });
    // IMPORTANTE: mutar path.set({path: ...}) num fabric.Path já existente NÃO
    // recalcula left/top/width/height/pathOffset — o objeto fica "travado" na
    // caixa delimitadora minúscula do primeiro ponto, fazendo o traço parecer
    // comprimido numa área pequena perto do início. A correção é recriar o
    // objeto Path do zero a cada frame (mesma estratégia já usada nas formas).
    const styleOpts = {
      stroke: s.path.stroke, strokeWidth: s.path.strokeWidth, fill: null,
      opacity: s.path.opacity, strokeLineCap: 'round', strokeLineJoin: 'round',
      selectable: false, evented: false,
    };
    canvas.remove(s.path);
    s.path = new fabric.Path(pts2path(s.pts), styleOpts);
    canvas.add(s.path);
    if (vpRect) canvas.bringToFront(vpRect);
    canvas.requestRenderAll();
  });
  socket.on('draw:end', ({ userId, object }) => {
    if (userId === myId) return;
    const s = remoteStrokes[userId];
    if (s) { canvas.remove(s.path); delete remoteStrokes[userId]; }
    if (object) applyFull(object); else canvas.renderAll();
  });

  // ── Streaming de formas (retângulo, elipse, linha, seta) ───────────────────
  // Mesmo padrão do draw:start/move/end: cada usuário remoto tem no máximo um
  // preview temporário em andamento por vez, guardado em remoteShapes[userId].
  socket.on('shape:start', ({ userId, shapeId, tool: t, x, y, color: c, width: w, opacity: opa, fillShape: fs }) => {
    if (userId === myId) return;
    const style = { color: c, sz: w, op: opa, fillShape: fs };
    const sh = mkShape(t, { x, y }, { x, y }, null, style);
    if (!sh) return;
    sh.selectable = false; sh.evented = false;
    remoteShapes[userId] = { shapeId, tool: t, start: { x, y }, style, obj: sh };
    canvas.add(sh);
    if (vpRect) canvas.bringToFront(vpRect);
    canvas.renderAll();
  });
  socket.on('shape:move', ({ userId, x, y }) => {
    if (userId === myId) return;
    const rs = remoteShapes[userId];
    if (!rs) return;
    canvas.remove(rs.obj);
    const sh = mkShape(rs.tool, rs.start, { x, y }, null, rs.style);
    if (!sh) return;
    sh.selectable = false; sh.evented = false;
    rs.obj = sh;
    canvas.add(sh);
    if (vpRect) canvas.bringToFront(vpRect);
    canvas.requestRenderAll();
  });
  socket.on('shape:end', ({ userId, object }) => {
    if (userId === myId) return;
    const rs = remoteShapes[userId];
    if (rs) { canvas.remove(rs.obj); delete remoteShapes[userId]; }
    if (object) applyFull(object); else canvas.renderAll();
  });
  socket.on('shape:cancel', ({ userId }) => {
    if (userId === myId) return;
    const rs = remoteShapes[userId];
    if (rs) { canvas.remove(rs.obj); delete remoteShapes[userId]; canvas.renderAll(); }
  });

  // ── Cursores remotos — recebidos em coordenadas do board, convertidos pra tela
  socket.on('cursor:move', ({ userId, userName: uName, color: c, x, y }) => {
    if (userId === myId) return;
    if (!remoteCursors[userId]) {
      const el = document.createElement('div');
      el.className = 'rcursor';
      const label = uName || userId; // usa nome se disponível, cai para ID
      el.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="${c}"><path d="M5 2l12 7.5-6.5.5-3 6.5z"/></svg><span class="rcname" style="background:${c}">${label}</span>`;
      document.body.appendChild(el);
      remoteCursors[userId] = el;
    }
    // Converte do espaço do board para a tela, respeitando zoom e pan atuais
    const zoom = canvas.getZoom();
    const vpt  = canvas.viewportTransform;
    const sx   = x * zoom + vpt[4];
    const sy   = y * zoom + vpt[5];
    remoteCursors[userId].style.left = sx + 'px';
    remoteCursors[userId].style.top  = sy + 'px';
  });
  socket.on('cursor:remove', uid => {
    if (remoteCursors[uid]) { remoteCursors[uid].remove(); delete remoteCursors[uid]; }
  });
}
