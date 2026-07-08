// Ações de sala/topo: trocar de lousa, limpar o quadro, abrir a view do OBS,
// e os botões do painel superior direito (ver ao vivo / ajuda).
import { canvas } from '../core/canvas-manager.js';
import { openBoardTutorial } from '../features/onboarding/tutorial.js';
import { socket, myRoomId, myRoomName, scheduleLayersUpdate } from '../board-app.js';

export function changeRoom() {
  // Volta para a tela de login direto no passo 2 (escolha de sala).
  // A senha já está válida (cookie de sessão), não precisa redigitar.
  // Guarda um flag para o index.html saber que deve pular o passo 1.
  sessionStorage.setItem('lb_skip_pw', '1');
  window.location.href = '/';
}

export function clearAll() {
  if (!confirm('Limpar todo o quadro?')) return;
  canvas.getObjects().filter(o => !o._isViewportRect).forEach(o => canvas.remove(o));
  canvas.renderAll();
  socket.emit('board:clear');
  scheduleLayersUpdate();
}

export function openViewUrl() {
  window.open(window.location.origin + '/view/' + (myRoomId || 'default'), '_blank');
}

// Liga os botões do painel superior direito — chamada uma vez pelo
// board-app.js na inicialização (depois que myRoomName/myRoomId já existem).
export function initHeaderButtons() {
  const vBtn = document.getElementById('trp-view');
  const hBtn = document.getElementById('trp-help');
  if (vBtn) vBtn.addEventListener('click', openViewUrl);
  if (hBtn) hBtn.addEventListener('click', openBoardTutorial);

  // Tooltip do botão "Ver ao vivo" inclui o nome da sala
  const name = myRoomName || myRoomId || '';
  if (vBtn && name) {
    vBtn.dataset.tip = 'Abrir view do OBS: ' + (name.length > 28 ? name.slice(0, 26) + '…' : name);
  }
}
