// ─── Tooltip flutuante da toolbar ────────────────────────────────────────────
// Extraído de board-app.js. Módulo autocontido — zero dependência de
// canvas/socket/estado do editor, só DOM. Sem import circular necessário.
// Substitui o .tb-tip antigo (que ficava preso dentro do overflow do #toolbar,
// exigindo scroll pra aparecer). Este vive em <body>, com position:fixed,
// então nunca é cortado por overflow/transform de nenhum ancestral. A posição
// é recalculada a cada hover via getBoundingClientRect do botão.
(function initToolbarTooltip() {
  const tip = document.createElement('div');
  tip.id = 'tb-floating-tip';
  document.body.appendChild(tip);

  const canHover = window.matchMedia('(hover: hover)').matches;
  if (!canHover) return; // em touch/mobile não faz sentido mostrar tooltip de hover

  let hideTimer = null;

  function showTip(btn) {
    const span = btn.querySelector('.tb-tip');
    const text = span ? span.textContent : (btn.dataset.tip || btn.getAttribute('title') || '');
    if (!text) return;
    clearTimeout(hideTimer);

    tip.textContent = text;
    tip.classList.add('show');

    const r = btn.getBoundingClientRect();
    let left = r.left + r.width / 2;
    // Evita o balão vazar pra fora da tela nas bordas esquerda/direita
    const margin = 8;
    const half = tip.offsetWidth / 2 || 40;
    left = Math.min(Math.max(left, margin + half), window.innerWidth - margin - half);

    tip.style.left = left + 'px';
    tip.style.top  = (r.bottom + 8) + 'px';
  }

  function hideTip() { tip.classList.remove('show'); }

  document.querySelectorAll('#toolbar .tb-btn, #top-left-panel .trp-btn, #spawn-panel .trp-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => showTip(btn));
    btn.addEventListener('mouseleave', hideTip);
    btn.addEventListener('click', hideTip);
  });
})();
