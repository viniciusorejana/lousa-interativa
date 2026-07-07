// ─── Tutorial interativo do board (overlay tema lousa de giz) ────────────────
// Extraído de board-app.js. Módulo autocontido — zero dependência de
// canvas/socket/estado do editor, só DOM. Sem import circular necessário.
// ── Tutorial do board — ícones de giz (SVG roughened) ──────────────────────────
const CHALK_ICONS_B = {
  tools:   `<path d="M4 20l4-1 10-10-3-3-10 10-1 4z"/><path d="M14 7l3 3"/>`,
  palette: `<path d="M12 3a9 9 0 100 18c1.5 0 2-.9 2-2 0-.6-.3-1-.6-1.4-.3-.4-.4-.7-.1-1.1.3-.4.9-.5 1.5-.5H16a4 4 0 004-4c0-5-3.6-9-8-9z"/><circle cx="8" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1" fill="currentColor" stroke="none"/>`,
  gif:     `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none"/>`,
  exportI: `<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><rect x="4" y="15" width="16" height="5" rx="1.5"/>`,
  spawn:   `<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 9v6"/><path d="M9 12h6"/>`,
  layers:  `<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>`,
  group:   `<rect x="3" y="3" width="10" height="10" rx="2"/><rect x="11" y="11" width="10" height="10" rx="2"/>`,
  history: `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M5 3l2 2M19 3l-2 2"/>`,
  link:    `<path d="M9 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-3"/><path d="M14 4h6v6"/><path d="M20 4l-9 9"/>`,
};
function chalkIconB(key) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="filter:url(#chalk-rough-b)">${CHALK_ICONS_B[key] || ''}</svg>`;
}
function spawnChalkDustB(containerId, count) {
  const c = document.getElementById(containerId);
  if (!c || c.dataset.filled) return;
  c.dataset.filled = '1';
  let html = '';
  for (let i = 0; i < count; i++) {
    const left  = (Math.random() * 100).toFixed(1);
    const dur   = (6 + Math.random() * 7).toFixed(1);
    const delay = (Math.random() * 7).toFixed(1);
    const size  = (1.5 + Math.random() * 2).toFixed(1);
    const dx    = (Math.random() * 44 - 22).toFixed(0);
    html += `<span class="dust-mote-b" style="left:${left}%;width:${size}px;height:${size}px;animation-duration:${dur}s;animation-delay:${delay}s;--dx:${dx}px"></span>`;
  }
  c.innerHTML = html;
}

const BTUT = [
  { icon:'tools', title:'As ferramentas na bandeja de giz',
    body:'A toolbar no topo tem todas as ferramentas, como uma bandeja de giz e apagador. Cada uma tem um <strong>atalho de teclado</strong> para trabalhar rápido durante a live.',
    keys:['V Selecionar','H Pan','P Caneta','E Borracha','R Retângulo','C Elipse','L Linha','A Seta','T Texto'] },
  { icon:'palette', title:'Cor, espessura e opacidade do giz',
    body:'Ao selecionar uma ferramenta de desenho, aparece um painel abaixo da toolbar com <strong>paleta de cores</strong> (gizes coloridos), <strong>espessura</strong> (1–60px), <strong>opacidade</strong> e <strong>preenchimento</strong> para formas.' },
  { icon:'gif', title:'Figuras e GIFs animados na lousa',
    body:'Clique no ícone de imagem para fazer upload ou <strong>Ctrl+V</strong> para colar da área de transferência. GIFs ficam <strong>totalmente animados</strong> no canvas e na view do OBS. Suporte a JPG, PNG, GIF, WebP e SVG.' },
  { icon:'exportI', title:'Copiar, colar e duplicar',
    body:'Selecione qualquer objeto (ou vários, ou um grupo inteiro) e use:',
    keys:['Ctrl+C Copiar','Ctrl+V Colar','Ctrl+D Duplicar','Ctrl+A Selecionar tudo','Del Excluir'] },
  { icon:'spawn', title:'O canto reservado da sala de aula',
    body:'O painel <strong>Spawn</strong> (centro, abaixo da toolbar) controla onde as coisas novas nascem. No modo <strong>"área reservada"</strong>, imagens, GIFs e tudo que você colar com Ctrl+V — um objeto, vários soltos ou um grupo inteiro — aparece numa área tracejada fora do viewport oficial, em vez de "pipocar" no meio da tela de quem está assistindo ao vivo. Depois é só arrastar pra posição final com calma.<br><br>Use <strong>"Mover área reservada"</strong> pra escolher onde ela fica — é uma preferência sua, cada pessoa tem a própria, e o board mostra a área de todo mundo (com nome e cor de cada um) pra ninguém colidir.' },
  { icon:'layers', title:'Camadas: lousas empilhadas',
    body:'O <strong>painel de Camadas</strong> fica na direita. Crie quantas camadas quiser, reordene por drag-and-drop e oculte camadas inteiras. Novos objetos vão sempre para a <strong>camada ativa</strong>.' },
  { icon:'group', title:'Agrupar e desagrupar',
    body:'Selecione 2+ objetos e use o botão <strong>Grupo</strong> no painel de camadas. Grupos se movem e escalam juntos. <em>GIFs animados não podem ser agrupados</em> — o botão fica desabilitado automaticamente.' },
  { icon:'exportI', title:'Tirar uma foto do quadro (Exportar PNG)',
    body:'O botão <strong>Exportar PNG</strong> gera uma imagem com fundo transparente:<br><br>• <strong>Nada selecionado</strong> → board inteiro no tamanho do viewport<br>• <strong>1 objeto</strong> → aquele objeto<br>• <strong>2+ objetos ou grupo</strong> → bounding box da seleção' },
  { icon:'history', title:'Apagar, refazer e sincronização',
    body:'Tudo é sincronizado em tempo real para todos. O <strong>Ctrl+Z / Ctrl+Y</strong> desfaz e refaz para todos ao mesmo tempo.',
    keys:['Ctrl+Z Desfazer','Ctrl+Y Refazer','F Centralizar viewport','0 Zoom 100%'] },
  { icon:'link', title:'Ver ao vivo (OBS)',
    body:'Clique em <strong>"Ver ao vivo"</strong> no canto superior esquerdo para abrir a URL desta sala em nova aba. Configure no OBS como source <strong>Browser</strong> com o tamanho do stream — fundo transparente, pronto para overlay.' },
];

let btutIdx = 0;

function openBoardTutorial() {
  btutIdx = 0; renderBtut();
  document.getElementById('board-tutorial-overlay').style.display = 'flex';
  spawnChalkDustB('btut-dust', 16);
}
function closeBoardTutorial() {
  const card = document.getElementById('btut-card');
  card.classList.add('wiping');
  setTimeout(() => {
    document.getElementById('board-tutorial-overlay').style.display = 'none';
    card.classList.remove('wiping');
  }, 370);
}
function btutNav(dir) {
  btutIdx = Math.max(0, Math.min(BTUT.length - 1, btutIdx + dir));
  renderBtut();
}
function renderBtut() {
  const s = BTUT[btutIdx], total = BTUT.length;
  document.getElementById('btut-progress').innerHTML =
    BTUT.map((_, i) => `<div class="btut-dot ${i < btutIdx ? 'done' : i === btutIdx ? 'active' : ''}"></div>`).join('');
  const keysHtml = s.keys
    ? `<div class="btut-keys">${s.keys.map(k => {
        const [key, ...rest] = k.split(' ');
        return `<div class="btut-key"><b>${key}</b> ${rest.join(' ')}</div>`;
      }).join('')}</div>` : '';
  document.getElementById('btut-body').innerHTML = `
    <div class="btut-anim">
      <div class="btut-icon">${chalkIconB(s.icon)}</div>
      <p class="btut-h">${s.title}</p>
      <p class="btut-p">${s.body}</p>
      ${keysHtml}
    </div>`;
  document.getElementById('btut-counter').textContent = `${btutIdx + 1} de ${total}`;
  document.getElementById('btut-prev').style.display = btutIdx === 0 ? 'none' : '';
  const next = document.getElementById('btut-next');
  if (btutIdx === total - 1) {
    next.textContent = 'Apagar e fechar ✓'; next.onclick = closeBoardTutorial;
  } else {
    next.textContent = 'Próximo →'; next.onclick = () => btutNav(1);
  }
}

document.getElementById('board-tutorial-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeBoardTutorial();
});
document.addEventListener('keydown', e => {
  if (document.getElementById('board-tutorial-overlay').style.display === 'none') return;
  if (e.key === 'Escape')      closeBoardTutorial();
  if (e.key === 'ArrowRight')  btutNav(1);
  if (e.key === 'ArrowLeft')   btutNav(-1);
});

export { openBoardTutorial, closeBoardTutorial, btutNav };
