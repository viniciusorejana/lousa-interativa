// ─── Live de fundo (referência local da transmissão ao vivo) ─────────────────
// Mostra a live (YouTube/Twitch/Kick) como fundo, posicionada exatamente atrás
// do retângulo do viewport (a área que o OBS captura), só que:
//  • é um <iframe> comum no DOM do editor — nunca passa pelo socket.io;
//  • view.html é uma página totalmente separada e nunca inclui este elemento;
// ou seja, é 100% local para quem está editando, e nunca aparece na
// transmissão/overlay do OBS.
import { canvas } from '../../core/canvas-manager.js';
import { myRoomId, vpW, vpH } from '../../board-app.js';

let liveBgEnabled = false;
let liveBgInteractive = false;

export function isLiveBgEnabled() { return liveBgEnabled; }

function _liveBgStorageKey() {
  return `lb_liveBg_${myRoomId || 'default'}`;
}

function parseLiveStreamUrl(raw, platformHint) {
  const input = (raw || '').trim();
  if (!input) return null;

  const detect = () => {
    if (/youtube\.com|youtu\.be/i.test(input)) return 'youtube';
    if (/twitch\.tv/i.test(input)) return 'twitch';
    if (/kick\.com/i.test(input)) return 'kick';
    return null;
  };

  const platform = (platformHint && platformHint !== 'auto') ? platformHint : detect();
  if (!platform) return null;

  if (platform === 'youtube') {
    let m = input.match(/[?&]v=([^&/?]+)/) || input.match(/youtu\.be\/([^?&/]+)/) || input.match(/embed\/([^?&/]+)/);
    if (m) return { platform, embed: `https://www.youtube.com/embed/${m[1]}?autoplay=1&mute=1&playsinline=1` };
    m = input.match(/youtube\.com\/(?:channel\/|c\/|@)([^/?&]+)/);
    const channel = m ? m[1] : input.replace(/^@/, '');
    return { platform, embed: `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channel)}&autoplay=1&mute=1&playsinline=1` };
  }

  if (platform === 'twitch') {
    let m = input.match(/twitch\.tv\/([^/?&]+)/);
    const channel = m ? m[1] : input;
    const parents = [...new Set([location.hostname, 'localhost', '127.0.0.1'].filter(Boolean))]
      .map(h => `&parent=${encodeURIComponent(h)}`).join('');
    return { platform, embed: `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}${parents}&autoplay=true&muted=true` };
  }

  if (platform === 'kick') {
    let m = input.match(/kick\.com\/([^/?&]+)/);
    const channel = m ? m[1] : input;
    return { platform, embed: `https://player.kick.com/${encodeURIComponent(channel)}?autoplay=true&muted=true` };
  }

  return null;
}

function positionLiveBgLayer() {
  const iframe = document.getElementById('live-bg-iframe');
  if (!iframe) return;
  const vpt = canvas.viewportTransform;
  const zoom = vpt[0];
  iframe.style.left   = vpt[4] + 'px';
  iframe.style.top    = vpt[5] + 'px';
  iframe.style.width  = (vpW * zoom) + 'px';
  iframe.style.height = (vpH * zoom) + 'px';
}

export function setLiveBgOpacity(v) {
  const layer = document.getElementById('live-bg-layer');
  const lbl = document.getElementById('live-bg-opacity-v');
  if (layer) layer.style.opacity = (parseInt(v) / 100);
  if (lbl) lbl.textContent = v + '%';
  try {
    const saved = JSON.parse(localStorage.getItem(_liveBgStorageKey()) || '{}');
    saved.opacity = parseInt(v);
    localStorage.setItem(_liveBgStorageKey(), JSON.stringify(saved));
  } catch (e) {}
}

export function applyLiveBg() {
  const urlInput = document.getElementById('live-bg-url');
  const platformSel = document.getElementById('live-bg-platform');
  const statusEl = document.getElementById('live-bg-status');
  const parsed = parseLiveStreamUrl(urlInput.value, platformSel.value);

  if (!parsed) {
    statusEl.textContent = 'Não consegui reconhecer a URL/canal. Tente colar o link completo (YouTube, Twitch ou Kick).';
    statusEl.style.color = '#ff6b6b';
    return false;
  }

  const iframe = document.getElementById('live-bg-iframe');
  iframe.src = parsed.embed;
  const layerEl = document.getElementById('live-bg-layer');
  layerEl.style.display = 'block';
  const opacityInput = document.getElementById('live-bg-opacity');
  layerEl.style.opacity = (parseInt(opacityInput.value) / 100);
  liveBgEnabled = true;
  // O Fabric pinta o backgroundColor DENTRO dos pixels do <canvas> — não é uma
  // camada CSS por trás, então nenhum z-index resolve isso. Precisa zerar o
  // fundo do canvas pra deixar o iframe (que fica atrás no DOM) aparecer.
  canvas.backgroundColor = 'transparent';
  canvas.renderAll();
  positionLiveBgLayer();

  const btn = document.getElementById('live-bg-toggle-btn');
  btn.textContent = '⏸ Ocultar transmissão';
  btn.classList.add('accent');
  statusEl.style.color = '';
  statusEl.textContent = 'Visível só para você, enquanto edita — não aparece na view do OBS.';
  const interactBtn = document.getElementById('live-bg-interact-btn');
  if (interactBtn) interactBtn.disabled = false;

  try {
    localStorage.setItem(_liveBgStorageKey(), JSON.stringify({
      url: urlInput.value, platform: platformSel.value, enabled: true,
      opacity: parseInt(opacityInput.value),
    }));
  } catch (e) {}
  return true;
}

function hideLiveBg(persist = true) {
  liveBgEnabled = false;
  setLiveBgInteractive(false);
  const layer = document.getElementById('live-bg-layer');
  const iframe = document.getElementById('live-bg-iframe');
  if (layer) layer.style.display = 'none';
  if (iframe) iframe.src = 'about:blank';
  canvas.backgroundColor = '#1e1e2a';
  canvas.renderAll();
  const btn = document.getElementById('live-bg-toggle-btn');
  if (btn) { btn.textContent = '▶ Mostrar transmissão'; btn.classList.remove('accent'); }
  const interactBtn = document.getElementById('live-bg-interact-btn');
  if (interactBtn) interactBtn.disabled = true;
  if (persist) {
    try {
      const saved = JSON.parse(localStorage.getItem(_liveBgStorageKey()) || '{}');
      saved.enabled = false;
      localStorage.setItem(_liveBgStorageKey(), JSON.stringify(saved));
    } catch (e) {}
  }
}

// Alterna entre "desenhar no board" (padrão) e "interagir com a live" — o
// iframe fica com pointer-events:none o tempo todo pra não roubar cliques do
// desenho; nesse modo, invertemos isso (canvas para de receber clique, o
// iframe passa a receber) só enquanto o usuário precisa clicar em play/mudo
// no player embutido. Funciona igual pras três plataformas, já que é só
// passthrough de clique — não depende de API específica de cada uma.
function setLiveBgInteractive(on) {
  liveBgInteractive = on && liveBgEnabled;
  const wrapper = canvas.wrapperEl;
  if (wrapper) wrapper.style.pointerEvents = liveBgInteractive ? 'none' : '';
  const layer = document.getElementById('live-bg-layer');
  if (layer) layer.style.pointerEvents = liveBgInteractive ? 'auto' : 'none';
  const btn = document.getElementById('live-bg-interact-btn');
  if (btn) {
    btn.textContent = liveBgInteractive ? '✏️ Voltar a desenhar' : '🖱️ Interagir com a live';
    btn.classList.toggle('accent', liveBgInteractive);
  }
}
export function toggleLiveBgInteract() {
  if (!liveBgEnabled) return;
  setLiveBgInteractive(!liveBgInteractive);
}

export function toggleLiveBg() {
  if (liveBgEnabled) { hideLiveBg(); return; }
  applyLiveBg();
}

// Restaura a última live configurada nesta sala (se havia uma ativa)
function restoreLiveBg() {
  try {
    const saved = JSON.parse(localStorage.getItem(_liveBgStorageKey()) || 'null');
    if (!saved || !saved.url) return;
    document.getElementById('live-bg-url').value = saved.url;
    document.getElementById('live-bg-platform').value = saved.platform || 'auto';
    const op = (saved.opacity !== undefined) ? saved.opacity : 100;
    document.getElementById('live-bg-opacity').value = op;
    document.getElementById('live-bg-opacity-v').textContent = op + '%';
    if (saved.enabled) applyLiveBg();
  } catch (e) {}
}

// Ponto único de inicialização — chamado por board-app.js depois que o
// socket/myRoomId já existem. Mantém o iframe alinhado ao retângulo do
// viewport durante pan/zoom/resize e restaura o estado salvo desta sala.
export function initLiveBg() {
  canvas.on('after:render', () => { if (liveBgEnabled) positionLiveBgLayer(); });
  restoreLiveBg();
}
