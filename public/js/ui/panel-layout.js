// Layout coordenado dos painéis flutuantes do board (spawn-panel → #ctx →
// #layers-panel, mais o painel superior esquerdo view/ajuda e o painel de
// Viewport) e o painel de propriedades do objeto selecionado (#ctx).
//
// Nenhuma dessas funções depende de socket/estado compartilhado — só leem
// `canvas` (pra saber a seleção ativa) e o DOM. Por isso este módulo não
// precisa do padrão de import circular usado no resto da refatoração.
import { canvas } from '../core/canvas-manager.js';

// ─────────────────────────────────────────────────────────────────────────────
// Cada painel mede a borda real do anterior via getBoundingClientRect() — nunca
// um número fixo "no chute" — e por isso funciona igual não importa o tamanho
// da tela, zoom, idioma dos textos, etc. Sempre chamar layoutSidePanels() (nunca
// as funções individuais soltas), pra garantir que rodem na ordem certa: cada
// painel só sabe se posicionar depois que o anterior já se acomodou.
// ─────────────────────────────────────────────────────────────────────────────

const LAYERS_PANEL_MIN_RESERVE = 190; // min-height do #layers-panel (180px) + folga

// ─── Modo mobile ─────────────────────────────────────────────────────────────
// Abaixo deste ponto o layout muda de natureza (não é só "encolher"): a toolbar
// vai pro rodapé, o #ctx vira bottom-sheet e os painéis laterais viram drawers
// deslizantes. Todo o posicionamento é feito por CSS (@media em board.css) —
// as funções de medição deste arquivo NÃO devem rodar, senão os estilos inline
// que elas escrevem (top/maxHeight) venceriam o CSS por especificidade.
// Mantém o mesmo breakpoint do @media.
const MOBILE_MAX_WIDTH = 768;
export function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
}

// Remove todos os estilos inline que o layout de desktop escreve. Chamado ao
// entrar em modo mobile (inclusive ao girar o aparelho / redimensionar a
// janela cruzando o breakpoint), senão sobrariam valores de `top`/`max-height`
// calculados pra tela grande grudados nos painéis.
function clearDesktopInlineLayout() {
  ['ctx', 'layers-panel', 'vp-panel', 'spawn-panel', 'top-left-panel'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.top = '';
    el.style.maxHeight = '';
  });
}

// Borda inferior da "área ocupada" no topo-centro: toolbar + painel de opções
// da ferramenta ativa (se visível) + painel de spawn (que fica sempre
// centralizado logo abaixo). Usado por quem precisa saber onde essa área
// termina pra não ficar embaixo dela (#ctx, #layers-panel).
function getTopClearArea() {
  const toolbar = document.getElementById('toolbar');
  const opts = document.getElementById('opts');
  const spawnPanel = document.getElementById('spawn-panel');
  let bottom = toolbar.getBoundingClientRect().bottom;
  if (opts && !opts.classList.contains('hidden')) {
    bottom = Math.max(bottom, opts.getBoundingClientRect().bottom);
  }
  if (spawnPanel) bottom = Math.max(bottom, spawnPanel.getBoundingClientRect().bottom);
  return bottom;
}

// Posiciona o painel de spawn logo abaixo da toolbar/opções — sempre
// centralizado, em qualquer tamanho de tela (diferente do painel view/ajuda,
// que mora num canto e só se move quando a toolbar ameaça encostar nele).
function updSpawnPanelPos() {
  const sp = document.getElementById('spawn-panel');
  if (!sp) return;
  const toolbar = document.getElementById('toolbar');
  const opts = document.getElementById('opts');
  let bottom = toolbar.getBoundingClientRect().bottom;
  if (opts && !opts.classList.contains('hidden')) {
    bottom = Math.max(bottom, opts.getBoundingClientRect().bottom);
  }
  sp.style.top = (bottom + 8) + 'px';
}

// Posiciona o painel "view do OBS / como usar" (canto superior esquerdo). Em
// telas largas ele mora fixo no canto (CSS cuida disso — só limpamos qualquer
// inline style residual). Em telas estreitas, a toolbar central (que pode
// esticar bem perto das bordas) arrisca encostar nele, então empurramos pra
// baixo da área ocupada no topo (toolbar/opções/spawn) só nesse caso.
function updTopLeftPanelPos() {
  const tlp = document.getElementById('top-left-panel');
  if (!tlp) return;

  if (window.innerWidth >= 1200) {
    tlp.style.top = '';
    return;
  }
  tlp.style.top = (getTopClearArea() + 8) + 'px';
}

// Posiciona o painel de Viewport (canto superior esquerdo, abaixo do painel
// view/ajuda) — mede a borda inferior REAL do painel view/ajuda, pra nunca
// ficar embaixo dele. Isso importa principalmente em telas estreitas, onde o
// painel view/ajuda desce (empurrado pela toolbar central, ver
// updTopLeftPanelPos) e pode chegar perto o suficiente do topo padrão do
// Viewport (top:max(130px,12vh) do CSS) pra sobrepor os dois. O valor do CSS
// continua sendo o mínimo — só sobe daqui se o painel view/ajuda precisar de
// mais espaço que isso.
//
// Além do "top", também recalcula o max-height: reserva espaço até a borda
// SUPERIOR real do #users (contador de editores, fixo no rodapé esquerdo —
// mesmo canto do vp-panel), pra ele encolher (ganha scroll interno) só
// quando estiver perto o bastante de encostar no #users, em vez de usar um
// teto fixo em vh que não sabe da existência desse painel no rodapé.
function updVpPanelPos() {
  const vp = document.getElementById('vp-panel');
  const tlp = document.getElementById('top-left-panel');
  if (!vp || !tlp) return;
  const cssMinTop = Math.max(130, window.innerHeight * 0.12); // espelha o "top:max(130px,12vh)" do CSS
  const tlpBottom = tlp.getBoundingClientRect().bottom;
  const top = Math.max(cssMinTop, tlpBottom + 10);
  vp.style.top = top + 'px';

  const users = document.getElementById('users');
  const bottomLimit = users ? users.getBoundingClientRect().top - 12 : window.innerHeight - 12;
  vp.style.maxHeight = Math.max(120, bottomLimit - top) + 'px';
}

// Posiciona o painel de propriedades do objeto selecionado (#ctx) logo abaixo
// de toda a área ocupada no topo (toolbar/opções/spawn) — nunca embaixo dela.
// E, além disso, ENCOLHE a altura máxima dele (max-height) reservando espaço
// suficiente pro painel de Camadas logo abaixo, em vez de simplesmente
// empurrá-lo pra fora da tela. Se o de Camadas estiver recolhido (.collapsed),
// a reserva de espaço é bem menor, já que ele não ocupa lugar nenhum nesse caso.
function positionCtxPanel() {
  const ctx = document.getElementById('ctx');
  if (!ctx) return;

  const top = getTopClearArea() + 12;
  ctx.style.top = top + 'px';

  const layersPanel = document.getElementById('layers-panel');
  const layersCollapsed = layersPanel && layersPanel.classList.contains('collapsed');
  const reserve = layersCollapsed ? 24 : (LAYERS_PANEL_MIN_RESERVE + 24); // +24 = folgas/gaps
  const maxH = Math.max(120, window.innerHeight - top - reserve);
  ctx.style.maxHeight = maxH + 'px';
}

// Empurra o painel de Camadas pra baixo do painel de propriedades do objeto
// selecionado (#ctx) sempre que ele estiver visível — medindo a altura REAL
// dele (getBoundingClientRect), não um número fixo. Funciona igual pra
// qualquer tipo de objeto (retângulo, texto, imagem, grupo...), já que cada
// um mostra uma quantidade diferente de campos e portanto uma altura
// diferente. Quando não há objeto selecionado, volta a usar a posição padrão
// definida em CSS (top:max(130px, 30vh)).
//
// O "top" calculado é sempre limitado (clamp) entre a área ocupada no topo
// (nunca perto demais da toolbar/spawn) e "innerHeight - 180px" (sempre sobra
// pelo menos 180px de altura utilizável pro painel de Camadas acima do
// rodapé) — isso evita depender só da resolução automática do CSS quando os
// valores ficam sobre-restringidos (top + bottom não cabem), que era o que
// deixava o painel espremido/quebrado em telas muito curtas.
function repositionLayersPanel() {
  const layersPanel = document.getElementById('layers-panel');
  const ctx = document.getElementById('ctx');
  if (!layersPanel || !ctx) return;

  if (ctx.style.display !== 'none') {
    const ctxBottom = ctx.getBoundingClientRect().bottom;
    const minTop = getTopClearArea() + 12;
    const desiredTop = Math.max(ctxBottom + 12, minTop);
    const maxTop = Math.max(window.innerHeight - 180, minTop);
    layersPanel.style.top = Math.min(desiredTop, maxTop) + 'px';
  } else {
    layersPanel.style.top = ''; // volta pro valor padrão do CSS
  }
}

// Orquestrador — sempre chamar este, nunca as funções acima isoladas: a
// ordem importa (spawn-panel precisa se acomodar antes do #ctx medir a borda
// dele, que por sua vez precisa se acomodar antes do #layers-panel medir a
// borda dele; top-left-panel depende da mesma área acomodada também; e o
// vp-panel depende do top-left-panel já estar no lugar certo).
export function layoutSidePanels() {
  // No mobile o posicionamento é 100% CSS (ver isMobileLayout acima).
  if (isMobileLayout()) { clearDesktopInlineLayout(); return; }
  updSpawnPanelPos();
  updTopLeftPanelPos();
  updVpPanelPos();
  positionCtxPanel();
  repositionLayersPanel();
}
window.addEventListener('resize', layoutSidePanels);
// A chamada inicial (via setTool('select') no início do board-app.js) roda
// antes da rede/fontes terminarem de carregar — nesse instante o toolbar/
// opts/spawn-panel podem ainda não ter o tamanho final, então o cálculo do
// top-left-panel/vp-panel sai errado (ex: vp-panel sobreposto pelos botões
// do top-left-panel). 'load' garante mais um recálculo depois que tudo
// (imagens, fontes) já assentou.
window.addEventListener('load', layoutSidePanels);

// Além dos gatilhos manuais espalhados pelo código (troca de ferramenta,
// seleção, resize), qualquer um dos painéis "de entrada" do cálculo acima
// (toolbar, opções da ferramenta ativa, spawn, top-left, users) pode mudar
// de tamanho por motivos que nenhum call-site conhece — texto do nome da
// sala/usuário que muda a largura do #users, um novo botão condicional na
// toolbar, etc. Um ResizeObserver nesses elementos cobre TODOS esses casos
// de uma vez, sem precisar caçar cada call-site que poderia ter esquecido
// de chamar layoutSidePanels(). Importante: só observamos as ENTRADAS do
// cálculo (nunca #vp-panel/#ctx/#layers-panel, que são as SAÍDAS que este
// mesmo código escreve) — senão vira loop infinito de resize→reposiciona→
// resize.
if (window.ResizeObserver) {
  const layoutInputIds = ['toolbar', 'opts', 'spawn-panel', 'top-left-panel', 'users'];
  const ro = new ResizeObserver(() => layoutSidePanels());
  layoutInputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) ro.observe(el);
  });
}

// ─── Drawers (mobile) ────────────────────────────────────────────────────────
// No mobile os painéis laterais saem inteiros da tela quando fechados, então
// ganham um fundo escurecido: tocar nele fecha o drawer aberto. Só um drawer
// fica aberto por vez — abrir um fecha o outro (a tela não comporta os dois).
function syncDrawerBackdrop() {
  const backdrop = document.getElementById('drawer-backdrop');
  if (!backdrop) return;
  const anyOpen = isMobileLayout() && ['layers-panel', 'vp-panel'].some(id => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('collapsed');
  });
  backdrop.classList.toggle('show', anyOpen);
}

function closeOtherDrawer(keepId) {
  if (!isMobileLayout()) return;
  ['layers-panel', 'vp-panel'].forEach(id => {
    if (id === keepId) return;
    const el = document.getElementById(id);
    if (el) el.classList.add('collapsed');
  });
}

export function closeAllDrawers() {
  ['layers-panel', 'vp-panel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('collapsed');
  });
  syncDrawerBackdrop();
}

export function toggleVpPanel() {
  const el = document.getElementById('vp-panel');
  el.classList.toggle('collapsed');
  if (!el.classList.contains('collapsed')) closeOtherDrawer('vp-panel');
  syncDrawerBackdrop();
}
export function toggleLayersPanel() {
  const el = document.getElementById('layers-panel');
  el.classList.toggle('collapsed');
  if (!el.classList.contains('collapsed')) closeOtherDrawer('layers-panel');
  syncDrawerBackdrop();
  // Recolher/expandir muda quanto espaço o painel de Camadas precisa — o
  // painel de seleção (#ctx) reserva menos altura quando ele está recolhido.
  layoutSidePanels();
}

// ─── Bottom-sheet do painel de seleção (mobile) ──────────────────────────────
// Recolhido: só a linha de ações (duplicar/copiar/ordem/excluir), que é o que
// se usa em 90% das vezes. Expandido: as propriedades (cor, espessura,
// opacidade, tamanho) com scroll interno. No desktop a classe não faz nada —
// o painel lateral mostra tudo sempre.
export function toggleCtxSheet() {
  const ctx = document.getElementById('ctx');
  if (ctx) ctx.classList.toggle('expanded');
}

// Estado inicial no mobile: os dois drawers fechados (no desktop o CSS manda).
// Também refaz o estado ao cruzar o breakpoint (girar o aparelho, redimensionar).
function applyInitialMobileState() {
  if (!isMobileLayout()) return;
  closeAllDrawers();
}
applyInitialMobileState();

const _mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
const _onBreakpointChange = () => { applyInitialMobileState(); syncDrawerBackdrop(); layoutSidePanels(); };
// addEventListener em MediaQueryList é o caminho moderno; addListener é o
// fallback pra WebViews antigas (algumas versões de OBS/Android).
if (_mq.addEventListener) _mq.addEventListener('change', _onBreakpointChange);
else if (_mq.addListener) _mq.addListener(_onBreakpointChange);

const _backdrop = document.getElementById('drawer-backdrop');
if (_backdrop) _backdrop.addEventListener('click', closeAllDrawers);

// Painel de propriedades do objeto selecionado (#ctx) — preenche os campos
// (dimensões, cor, preenchimento, espessura, opacidade) conforme a seleção
// ativa do canvas. Chamado pelos listeners de seleção do canvas registrados
// em board-app.js (selection:created/updated, object:modified).
export function updCtx() {
  const objs = canvas.getActiveObjects().filter(o => !o._isViewportRect);
  if (!objs.length) { document.getElementById('ctx').style.display = 'none'; layoutSidePanels(); return; }
  const ctx = document.getElementById('ctx');
  ctx.style.display = 'block';
  // Usa o primeiro objeto como referência para preencher os campos
  const o = objs[0];
  const multi = objs.length > 1;

  // Título
  const typeNames = { 'path':'Traço', 'rect':'Retângulo', 'ellipse':'Elipse', 'circle':'Elipse',
    'line':'Linha', 'i-text':'Texto', 'text':'Texto', 'image':'Imagem', 'group':'Grupo' };
  document.getElementById('ctx-title').textContent = multi
    ? `${objs.length} objetos`
    : (typeNames[o.type] || 'Objeto');

  // Dimensões (só para seleção única)
  document.getElementById('cw').value  = multi ? '' : Math.round(o.getScaledWidth());
  document.getElementById('ch').value  = multi ? '' : Math.round(o.getScaledHeight());
  document.getElementById('cop').value = Math.round((o.opacity || 1) * 100);
  document.getElementById('cop-v').textContent = Math.round((o.opacity || 1) * 100) + '%';

  // Cor de stroke/texto
  const isText = o.type === 'i-text' || o.type === 'text';
  const strokeColor = isText ? (o.fill || '#ffffff') : (o.stroke || '#ffffff');
  const colorEl = document.getElementById('ctx-color');
  colorEl.value = strokeColor.startsWith('#') ? strokeColor : '#ffffff';
  document.getElementById('ctx-color-lbl').textContent = isText ? 'texto' : 'linha';
  const hideColor = o.type === 'image' || o.type === 'group';
  document.getElementById('ctx-color-row').style.display = hideColor ? 'none' : 'flex';

  // Preenchimento
  const hasFill = !multi &&
    o.type !== 'i-text' && o.type !== 'text' &&
    o.type !== 'image' && o.type !== 'line' && o.type !== 'path';
  document.getElementById('ctx-fill-row').style.display = hasFill ? 'flex' : 'none';
  if (hasFill) {
    const fillActive = o.fill && o.fill !== 'transparent' && o.fill !== '';
    document.getElementById('ctx-fill-on').checked = !!fillActive;
    const fillEl = document.getElementById('ctx-fill');
    fillEl.value    = fillActive && o.fill.startsWith('#') ? o.fill : '#ffffff';
    fillEl.disabled = !fillActive;
  }

  // Espessura
  const hasSz = objs.every(x => x.type !== 'image' && x.type !== 'i-text' && x.type !== 'text' && x.type !== 'group');
  document.getElementById('ctx-sz-row').style.display = hasSz ? 'flex' : 'none';
  if (hasSz) {
    const sw = o.strokeWidth || 1;
    document.getElementById('ctx-sz').value = sw;
    document.getElementById('ctx-sz-v').textContent = sw;
  }

  layoutSidePanels();
}
