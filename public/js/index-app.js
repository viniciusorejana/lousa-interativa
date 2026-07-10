// ─── Entry point do index.html (tela de login) ────────────────────────────────
// Módulo ES real (Fase 5). Mecânica idêntica à conversão de board.html na
// Fase 3: o corpo deste arquivo é a fusão dos dois `<script>` clássicos que
// viviam inline em index.html (o que injeta o botão de tutorial + o que tem
// toda a lógica dos 3 passos de login e do tutorial da lousa de giz).
//
// index.html usa atributos onclick inline (checkPassword, chooseRoom, goStep,
// enterBoard, goBackToStep2, openTutorial, closeTutorial, tutNav) — mesma
// ponte via `window` explicada em board-app.js, pelo mesmo motivo: módulos ES
// não vazam declarações de nível superior pro escopo global.

// Botão de tutorial no card de login
document.querySelector('.card').insertAdjacentHTML('beforeend', `
  <button class="tutorial-btn" onclick="openTutorial()">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 20l3-1 11-11-2-2L5 17l-1 3z"/><path d="M14 7l2 2"/>
    </svg>
    Como usar (lousa)
  </button>
`);

// ── Restaura estado entre passos ─────────────────────────────────────────
let chosenRoomId   = '';
let chosenRoomName = '';

const savedName = localStorage.getItem('lb_username');
if (savedName) document.getElementById('uname').value = savedName;

const savedRoom = localStorage.getItem('lb_last_room');
if (savedRoom) document.getElementById('rname').value = savedRoom;

// Se veio do board via "Trocar de Lousa", pula direto para o passo 2
// (senha ainda válida via cookie de sessão)
if (sessionStorage.getItem('lb_skip_pw') === '1') {
  sessionStorage.removeItem('lb_skip_pw');
  fetch('/check').then(r => {
    if (r.ok) {
      goStep(2);
      // Se havia sala salva, mostra o preview do slug imediatamente
      if (savedRoom) updateSlug();
    }
  }).catch(() => {});
}

// ── Helpers de UI ─────────────────────────────────────────────────────────
function goStep(n) {
  [1,2,3].forEach(i => {
    document.getElementById('step'+i).style.display = (i===n ? 'block' : 'none');
  });
  // Atualiza indicadores
  [1,2,3].forEach(i => {
    const circle = document.getElementById('sc'+i);
    if (i < n)      circle.className = 'step-circle done',  circle.textContent = '✓';
    else if (i===n) circle.className = 'step-circle active', circle.textContent = i;
    else            circle.className = 'step-circle',        circle.textContent = i;
  });
  if (n > 1) document.getElementById('sl1').className = 'step-line done';
  if (n > 2) document.getElementById('sl2').className = 'step-line done';
  // Foca o input do passo
  setTimeout(() => {
    const inputs = document.querySelectorAll('#step'+n+' input');
    if (inputs.length) { inputs[0].focus(); if (savedName && n===3) inputs[0].select(); }
  }, 50);
}

function shake(inputId, errId, msg) {
  const inp = document.getElementById(inputId);
  document.getElementById(errId).textContent = msg;
  inp.classList.remove('error'); void inp.offsetWidth; inp.classList.add('error');
  inp.focus();
}

// ── Passo 1: Senha ────────────────────────────────────────────────────────
async function checkPassword() {
  const pw  = document.getElementById('pw').value.trim();
  const btn = document.getElementById('btn1');
  if (!pw) return;
  btn.disabled = true; btn.textContent = 'Verificando...';
  document.getElementById('err1').textContent = '';
  try {
    const res = await fetch('/auth', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) {
      goStep(2);
      updateSlug(); // atualiza o preview de slug se já havia algo salvo
    } else if (res.status === 429) {
      const retry = res.headers.get('Retry-After');
      shake('pw', 'err1', `Muitas tentativas. Aguarde ${retry || 'alguns'} segundo(s).`);
    } else {
      shake('pw', 'err1', 'Senha incorreta.');
      document.getElementById('pw').value = '';
    }
  } catch { shake('pw', 'err1', 'Erro de conexão.'); }
  finally { btn.disabled = false; btn.textContent = 'Continuar'; }
}

// ── Passo 2: Sala ─────────────────────────────────────────────────────────
let slugTimer = null;
function updateSlug() {
  clearTimeout(slugTimer);
  const val = document.getElementById('rname').value.trim();
  if (!val) { document.getElementById('slug-hint').textContent = ''; return; }
  slugTimer = setTimeout(async () => {
    try {
      const res  = await fetch('/api/slug?name=' + encodeURIComponent(val));
      const data = await res.json();
      const slug = data.slug;
      document.getElementById('slug-hint').textContent = slug ? `→ /view/${slug}` : '';
    } catch (_) {}
  }, 300);
}

document.getElementById('rname').addEventListener('input', () => {
  document.getElementById('err2').textContent = '';
  updateSlug();
});

async function chooseRoom() {
  const name = document.getElementById('rname').value.trim();
  if (!name) { shake('rname', 'err2', 'Digite um nome para a sala.'); return; }

  // Busca o slug real via API (garante consistência com o servidor)
  let slug = '';
  try {
    const res = await fetch('/api/slug?name=' + encodeURIComponent(name));
    slug = (await res.json()).slug;
  } catch { shake('rname', 'err2', 'Erro de conexão.'); return; }

  if (!slug) { shake('rname', 'err2', 'Nome inválido. Use letras e números.'); return; }

  chosenRoomId   = slug;
  chosenRoomName = name;
  localStorage.setItem('lb_last_room', name); // lembra para próxima vez

  // Atualiza o badge e link OBS
  document.getElementById('room-display').textContent = `${name}  (/${slug})`;
  const obsUrl = `/view/${slug}`;
  document.getElementById('obs-url-display').textContent = obsUrl;
  document.getElementById('obs-link-el').href = obsUrl;

  // Guarda na sessão para o board.html usar
  sessionStorage.setItem('lb_roomId',   slug);
  sessionStorage.setItem('lb_roomName', name);

  goStep(3);
}

// ── Passo 3: Nome ─────────────────────────────────────────────────────────
function enterBoard() {
  const name = document.getElementById('uname').value.trim();
  if (!name) { shake('uname', 'err3', 'Digite um nome para continuar.'); return; }
  localStorage.setItem('lb_username', name);
  sessionStorage.setItem('lb_username', name);
  window.location.href = '/board.html';
}

// ── Teclado ───────────────────────────────────────────────────────────────
document.getElementById('pw').addEventListener('keydown',    e => e.key==='Enter' && checkPassword());
document.getElementById('rname').addEventListener('keydown', e => e.key==='Enter' && chooseRoom());
document.getElementById('uname').addEventListener('keydown', e => e.key==='Enter' && enterBoard());

document.getElementById('uname').addEventListener('input', e => {
  document.getElementById('err3').textContent = '';
  e.currentTarget.classList.toggle('valid', e.currentTarget.value.trim().length > 0);
});

// ── Voltar do passo 3 para o passo 2 ─────────────────────────────────────
function goBackToStep2() {
  // Limpa a sala escolhida para forçar nova seleção
  chosenRoomId = ''; chosenRoomName = '';
  document.getElementById('err3').textContent = '';
  goStep(2);
}

// ── Tutorial — ícones desenhados a giz (SVG, roughened via filter) ────────
const CHALK_ICONS = {
  sparkle: `<path d="M4 15c2-4 5-6 8-6s6 2 8 6"/><path d="M12 3v3"/><path d="M5 6l2 2"/><path d="M19 6l-2 2"/><circle cx="12" cy="18" r="1.3" fill="currentColor" stroke="none"/>`,
  lock:    `<path d="M6 11V8a6 6 0 0112 0v3"/><rect x="4" y="11" width="16" height="9" rx="2"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none"/>`,
  board:   `<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>`,
  user:    `<circle cx="12" cy="8" r="3.4"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>`,
  tv:      `<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 17v3"/>`,
  tools:   `<path d="M4 20l4-1 10-10-3-3-10 10-1 4z"/><path d="M14 7l3 3"/>`,
  image:   `<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5.5-5.5L9 17"/>`,
  layers:  `<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>`,
  exportI: `<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><rect x="4" y="15" width="16" height="5" rx="1.5"/>`,
  spawn:   `<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 9v6"/><path d="M9 12h6"/>`,
  history: `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M5 3l2 2M19 3l-2 2"/>`,
};
function chalkIcon(key) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="filter:url(#chalk-rough)">${CHALK_ICONS[key] || ''}</svg>`;
}

// ── Poeira de giz caindo dentro da lousa ─────────────────────────────────
function spawnChalkDust(containerId, count) {
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
    html += `<span class="dust-mote" style="left:${left}%;width:${size}px;height:${size}px;animation-duration:${dur}s;animation-delay:${delay}s;--dx:${dx}px"></span>`;
  }
  c.innerHTML = html;
}

const TUT_SLIDES = [
  {
    icon: 'sparkle',
    title: 'Bem-vindo à sua Lousa Interativa',
    body: `O LiveBoard é um <strong>quadro-negro colaborativo ao vivo</strong> para streams. Tudo que você escrever ou desenhar aparece em tempo real para todos os editores e também para o OBS — como se todos segurassem o mesmo giz.`,
  },
  {
    icon: 'lock',
    title: 'Passo 1 — A senha da giz-caixa',
    body: `Digite a <strong>senha do quadro</strong> para pegar o giz e poder desenhar. Quem for só <em>assistir</em> acessa direto pela URL da view, sem precisar de senha.`,
  },
  {
    icon: 'board',
    title: 'Passo 2 — Escolha sua Lousa',
    body: `Cada lousa é um quadro independente, com seus próprios desenhos, camadas e histórico. Digite qualquer nome — a URL é gerada automaticamente e mostrada abaixo do campo. <strong>Você pode ter várias lousas penduradas ao mesmo tempo.</strong>`,
  },
  {
    icon: 'user',
    title: 'Passo 3 — Assine seu giz',
    body: `Escolha como você vai aparecer para os outros editores. Seu cursor e suas ações ficam identificados com esse nome, como uma assinatura no canto da lousa. Dá pra trocar de sala clicando em <strong>"Trocar de sala"</strong> sem redigitar a senha.`,
  },
  {
    icon: 'tv',
    title: 'Pendurando a lousa no OBS',
    body: `No OBS, adicione uma source do tipo <strong>Browser</strong> apontando para a URL da view:<br><br><code style="background:#0f0f13;padding:3px 8px;border-radius:6px;font-size:12px;color:#c8b6ff">/view/nome-da-sala</code><br><br>Defina largura e altura iguais à resolução do stream (ex: 1920×1080). O fundo é <strong>transparente</strong> — a lousa flutua direto como overlay.`,
  },
  {
    icon: 'tools',
    title: 'O giz, o apagador e companhia',
    body: `No editor você tem: caneta, borracha, retângulo, elipse, linha, seta e texto — todas as ferramentas de um quadro-negro de verdade. Cada uma tem um atalho de teclado:`,
    keys: ['V Selecionar', 'P Caneta', 'E Borracha', 'R Retângulo', 'C Elipse', 'L Linha', 'A Seta', 'T Texto'],
  },
  {
    icon: 'image',
    title: 'Colando figuras e GIFs no quadro',
    body: `Clique no ícone de imagem na toolbar para fazer upload, ou simplesmente <strong>Ctrl+V</strong> para colar da área de transferência — como fixar um recorte na lousa com fita. GIFs ficam animados no canvas, decodificados em segundo plano para não travar a live.`,
  },
  {
    icon: 'layers',
    title: 'Camadas: lousas empilhadas',
    body: `Use o <strong>painel de Camadas</strong> (direita) para organizar os desenhos como folhas de lousa sobrepostas. Reordene por drag, oculte camadas e crie quantas quiser. Selecione vários objetos e <strong>Agrupe</strong> — só GIFs não entram em grupos.`,
  },
  {
    icon: 'exportI',
    title: 'Copiar, colar e tirar uma foto do quadro',
    body: `<strong>Ctrl+C / Ctrl+V</strong> copia e cola qualquer seleção — um traço, vários ou um grupo inteiro — inclusive para outros editores. O botão <strong>Exportar PNG</strong> "fotografa" a seleção atual com fundo transparente, ou a lousa inteira se nada estiver selecionado.`,
  },
  {
    icon: 'spawn',
    title: 'O canto reservado da sala de aula',
    body: `O painel <strong>Spawn</strong> (centro, abaixo da toolbar) deixa escolher onde novas imagens, GIFs e colagens (Ctrl+V) nascem: <strong>centralizadas na sua tela</strong> ou num <strong>canto reservado</strong> fora do viewport do OBS — como uma mesa ao lado da lousa, pra nada "pipocar" no meio do stream ao vivo. Cada pessoa escolhe onde fica sua área, e todo mundo enxerga a área dos colegas.`,
  },
  {
    icon: 'history',
    title: 'Apagar, refazer e outros atalhos',
    body: `Tudo tem undo/redo sincronizado para todos os gizes ao mesmo tempo:`,
    keys: ['Ctrl+Z Desfazer', 'Ctrl+Y Refazer', 'Ctrl+D Duplicar', 'Ctrl+A Selecionar tudo', 'F Centralizar', '0 Zoom 100%', 'Del Excluir'],
  },
];

let tutIdx = 0;

function openTutorial() {
  tutIdx = 0;
  renderTutorial();
  document.getElementById('tutorial-overlay').classList.add('show');
  spawnChalkDust('tut-dust', 16);
}
function closeTutorial() {
  const card = document.getElementById('tut-card');
  card.classList.add('wiping');
  setTimeout(() => {
    document.getElementById('tutorial-overlay').classList.remove('show');
    card.classList.remove('wiping');
  }, 370);
}
function tutNav(dir) {
  tutIdx = Math.max(0, Math.min(TUT_SLIDES.length - 1, tutIdx + dir));
  renderTutorial();
}
function renderTutorial() {
  const slide = TUT_SLIDES[tutIdx];
  const total = TUT_SLIDES.length;

  // Progress dots (marcas de giz)
  const prog = document.getElementById('tut-progress');
  prog.innerHTML = TUT_SLIDES.map((_, i) =>
    `<div class="tut-dot ${i < tutIdx ? 'done' : i === tutIdx ? 'active' : ''}"></div>`
  ).join('');

  // Slide content
  const keysHtml = slide.keys
    ? `<div class="tut-keys">${slide.keys.map(k => {
        const [key, ...rest] = k.split(' ');
        return `<div class="tut-key"><span>${key}</span> ${rest.join(' ')}</div>`;
      }).join('')}</div>`
    : '';

  document.getElementById('tut-slides').innerHTML = `
    <div class="tut-slide active">
      <div class="tut-icon">${chalkIcon(slide.icon)}</div>
      <h3>${slide.title}</h3>
      <p>${slide.body}</p>
      ${keysHtml}
    </div>`;

  // Counter & buttons
  document.getElementById('tut-counter').textContent = `${tutIdx + 1} de ${total}`;
  document.getElementById('tut-prev').style.display = tutIdx === 0 ? 'none' : '';
  const nextBtn = document.getElementById('tut-next');
  if (tutIdx === total - 1) {
    nextBtn.textContent = 'Apagar e fechar ✓';
    nextBtn.onclick = closeTutorial;
  } else {
    nextBtn.textContent = 'Próximo →';
    nextBtn.onclick = () => tutNav(1);
  }
}

// Fecha com Escape ou clicando fora
document.getElementById('tutorial-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeTutorial();
});
document.addEventListener('keydown', e => {
  const ov = document.getElementById('tutorial-overlay');
  if (!ov.classList.contains('show')) return;
  if (e.key === 'Escape') closeTutorial();
  if (e.key === 'ArrowRight') tutNav(1);
  if (e.key === 'ArrowLeft')  tutNav(-1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PONTE DE COMPATIBILIDADE COM ATRIBUTOS INLINE DO HTML (onclick/onchange/...)
// ═══════════════════════════════════════════════════════════════════════════════
// Cada nome abaixo corresponde a um atributo onclick encontrado em index.html.
// Se um atributo inline novo for adicionado ao HTML referenciando uma função
// daqui, ele precisa ser adicionado nesta lista também — senão o clique falha
// silenciosamente (function is not defined) porque o módulo não vaza
// identificadores pro escopo global.
Object.assign(window, {
  checkPassword, chooseRoom, goStep, enterBoard, goBackToStep2,
  openTutorial, closeTutorial, tutNav,
});
