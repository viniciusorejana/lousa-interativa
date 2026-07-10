// E2E de responsividade: garante que o layout MUDA DE NATUREZA no mobile
// (toolbar no rodapé, #ctx como bottom-sheet, painéis laterais como drawers)
// e que copiar/colar/duplicar funcionam SÓ POR BOTÃO — o caminho do toque,
// onde não existem Ctrl+C / Ctrl+V / Ctrl+D. Também trava o desktop contra
// regressões da mesma refatoração.
const { test, expect } = require('@playwright/test');
const { login, drawRect } = require('./helpers');


// Seleciona por marquee (arrasto), não por clique no centro: as formas são só
// contorno e o canvas usa perPixelTargetFind — ver comentário em board.spec.js.
async function marquee(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

// No mobile o painel de camadas é um drawer fechado, e updateLayersPanel pula a
// reconstrução do DOM enquanto ele está recolhido (otimização em layers-panel.js).
// Abrir, contar e fechar valida as duas coisas de uma vez.
async function countObjectsViaDrawer(page, { mobile }) {
  if (mobile) {
    await page.click('#t-layers');
    await page.waitForTimeout(300);
  }
  const n = await page.locator('.layer-item').count();
  if (mobile) {
    await page.click('#drawer-backdrop', { position: { x: 20, y: 400 } });
    await page.waitForTimeout(300);
  }
  return n;
}

test.describe('verificação de layout responsivo', () => {
  test('mobile 375x812: toolbar no rodapé, bottom-sheet, drawers, copiar/colar/duplicar', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);

    // ── Toolbar ancorada no rodapé, largura total ──
    const tb = await page.locator('#toolbar').boundingBox();
    expect(tb.y + tb.height, 'toolbar deve terminar no rodapé').toBeGreaterThan(812 - 80);
    expect(tb.x, 'toolbar deve ocupar a largura toda').toBeLessThanOrEqual(1);

    // ── Painéis laterais começam fora da tela ──
    const layersBox = await page.locator('#layers-panel').boundingBox();
    expect(layersBox.x, 'camadas deve começar fora da tela (drawer fechado)').toBeGreaterThanOrEqual(374);
    await expect(page.locator('#drawer-backdrop')).toBeHidden();

    // ── Desenhar + selecionar → #ctx vira bottom-sheet acima da toolbar ──
    await drawRect(page, { from: { x: 110, y: 300 }, to: { x: 240, y: 420 } });
    await marquee(page, { x: 80, y: 270 }, { x: 280, y: 450 });
    await expect(page.locator('#ctx')).toBeVisible();

    const ctx = await page.locator('#ctx').boundingBox();
    expect(ctx.x, 'sheet deve ser full-width').toBeLessThanOrEqual(1);
    expect(Math.round(ctx.width), 'sheet deve ser full-width').toBeGreaterThan(360);
    expect(ctx.y + ctx.height, 'sheet deve ficar acima da toolbar').toBeLessThanOrEqual(tb.y + 2);

    // Recolhido: propriedades escondidas, ações visíveis com alvo grande
    await expect(page.locator('#ctx-props')).toBeHidden();
    const dupBtn = await page.locator('#ctx-actions .ca-btn').first().boundingBox();
    expect(dupBtn.height, 'ação deve ter alvo de toque ≥44px').toBeGreaterThanOrEqual(44);

    // ── Expandir revela as propriedades ──
    await page.click('#ctx-grabber');
    await expect(page.locator('#ctx-props')).toBeVisible();
    await page.click('#ctx-grabber');
    await expect(page.locator('#ctx-props')).toBeHidden();

    // ── COPIAR por botão (sem teclado) habilita o COLAR da toolbar ──
    await expect(page.locator('#t-paste')).toBeDisabled();
    await page.locator('#ctx-actions .ca-btn').nth(1).click(); // Copiar
    await expect(page.locator('#t-paste')).toBeEnabled();

    expect(await countObjectsViaDrawer(page, { mobile: true })).toBe(1);

    // ── COLAR por botão ──
    await page.click('#t-paste');
    await page.waitForTimeout(500);
    expect(await countObjectsViaDrawer(page, { mobile: true }),
      'colar deve adicionar um objeto').toBe(2);

    // ── DUPLICAR por botão (precisa de seleção ativa) ──
    await marquee(page, { x: 80, y: 270 }, { x: 340, y: 500 });
    await expect(page.locator('#ctx')).toBeVisible();
    await page.locator('#ctx-actions .ca-btn').nth(0).click(); // Duplicar
    await page.waitForTimeout(500);
    const afterDup = await countObjectsViaDrawer(page, { mobile: true });
    expect(afterDup, 'duplicar deve adicionar objetos').toBeGreaterThan(2);

    // ── Drawer de camadas: entra na tela, mostra backdrop, backdrop fecha ──
    await page.click('#t-layers');
    await page.waitForTimeout(350);
    const layersOpen = await page.locator('#layers-panel').boundingBox();
    expect(layersOpen.x, 'drawer de camadas deve entrar na tela').toBeLessThan(375);
    await expect(page.locator('#drawer-backdrop')).toBeVisible();
    await page.click('#drawer-backdrop', { position: { x: 20, y: 400 } });
    await page.waitForTimeout(350);
    await expect(page.locator('#drawer-backdrop')).toBeHidden();

    // ── Drawer de viewport (esquerda) ──
    await page.click('#t-vp');
    await page.waitForTimeout(350);
    const vpOpen = await page.locator('#vp-panel').boundingBox();
    expect(vpOpen.x, 'drawer de viewport deve entrar pela esquerda').toBeGreaterThanOrEqual(-1);
    await expect(page.locator('#drawer-backdrop')).toBeVisible();

    expect(errors, `erros de console: ${errors.join('\n')}`).toEqual([]);
  });

  test('desktop 1440x900: painel lateral preservado, sem regressão', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    const tb = await page.locator('#toolbar').boundingBox();
    expect(tb.y, 'toolbar deve permanecer no topo no desktop').toBeLessThan(60);

    const layers = await page.locator('#layers-panel').boundingBox();
    expect(layers.x, 'camadas deve estar visível no desktop').toBeLessThan(1440);
    await expect(page.locator('#drawer-backdrop')).toBeHidden();

    await drawRect(page, { from: { x: 400, y: 300 }, to: { x: 560, y: 440 } });
    await marquee(page, { x: 370, y: 270 }, { x: 600, y: 470 });
    await expect(page.locator('#ctx')).toBeVisible();

    // Desktop mostra tudo, sem sheet
    await expect(page.locator('#ctx-props')).toBeVisible();
    await expect(page.locator('#ctx-grabber')).toBeHidden();

    const ctx = await page.locator('#ctx').boundingBox();
    expect(ctx.width, 'painel lateral deve continuar estreito').toBeLessThan(260);
    expect(ctx.x, 'painel deve ficar à direita').toBeGreaterThan(1000);

    // Copiar/colar por botão também no desktop
    await page.locator('#ctx-actions .ca-btn').nth(1).click();
    await expect(page.locator('#t-paste')).toBeEnabled();
    expect(errors, `erros de console: ${errors.join('\n')}`).toEqual([]);
  });
});

// ─── Cascata de posicionamento dos painéis (desktop) ─────────────────────────
// layoutSidePanels() posiciona cada painel medindo a borda REAL do anterior.
// Isso só funciona se nenhuma dessas bordas estiver no meio de uma transição
// CSS de posição — senão getBoundingClientRect() devolve o valor ANTIGO e o
// painel seguinte é colocado onde o anterior *estava*, não onde ele vai parar.
// Era o caso de #top-left-panel e #spawn-panel (transition: top .15s), e o
// resultado eram os botões view/pincel por cima do painel de Viewport.
test.describe('cascata de painéis no desktop', () => {
  const overlap = (a, b) => !(
    a.x + a.width <= b.x || b.x + b.width <= a.x ||
    a.y + a.height <= b.y || b.y + b.height <= a.y
  );

  // Espera bem além das transições mais longas (top .2s) — o bug é justamente
  // um estado final errado, que não se conserta sozinho depois da animação.
  const settle = page => page.waitForTimeout(450);

  async function assertNoOverlap(page, label) {
    const tlp = await page.locator('#top-left-panel').boundingBox();
    const vp = await page.locator('#vp-panel').boundingBox();
    expect(overlap(tlp, vp), `${label}: botões view/pincel cobrindo o painel de Viewport`)
      .toBe(false);
  }

  test('painel view/ajuda nunca cobre o de Viewport ao redimensionar ou abrir opções', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await login(page);
    await settle(page);
    await assertNoOverlap(page, 'largo, sem opções');

    // Encolhe cruzando o breakpoint de 1200px: o #top-left-panel desce pra não
    // encostar na toolbar central, e o #vp-panel precisa descer junto.
    await page.setViewportSize({ width: 1000, height: 900 });
    await settle(page);
    await assertNoOverlap(page, 'estreito');

    // Trocar pra uma ferramenta com painel de opções (#opts) aumenta a área
    // ocupada no topo, empurrando tudo mais pra baixo de novo.
    await page.keyboard.press('c'); // elipse -> mostra #opts
    await expect(page.locator('#opts')).toBeVisible();
    await settle(page);
    await assertNoOverlap(page, 'estreito + opções abertas');

    // E de volta pro largo, garantindo que o retorno ao canto também acomoda.
    await page.setViewportSize({ width: 1400, height: 900 });
    await settle(page);
    await assertNoOverlap(page, 'largo de novo');
  });
});

// hasTouch liga a media query (pointer: coarse), onde os alvos de toque crescem
// (.trp-btn vai de 34px pra 44px). Sem isso o teste mediria o painel de spawn
// menor do que ele realmente é num celular, e passaria por sorte.
test.describe('toast no mobile com toque', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 812 } });

  // O toast foi pro topo quando o rodapé virou toolbar, mas o #spawn-panel
  // também é centralizado no topo — os dois ficavam um em cima do outro. E o
  // toast que mais aparece é justamente o disparado ao alternar o modo de
  // spawn, ou seja, sempre com o painel na tela.
  test('toast não cobre o painel de spawn', async ({ page }) => {
    await login(page);

    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    expect(coarse, 'a media query de toque precisa estar ativa').toBe(true);

    await page.click('#trp-spawn'); // alterna p/ "área reservada" e dispara o toast
    await expect(page.locator('#toast')).toBeVisible();

    const toast = await page.locator('#toast').boundingBox();
    const spawn = await page.locator('#spawn-panel').boundingBox();

    expect(toast.y, 'toast deve começar abaixo do painel de spawn')
      .toBeGreaterThanOrEqual(spawn.y + spawn.height);
    expect(toast.x, 'toast não pode vazar pela esquerda').toBeGreaterThanOrEqual(0);
    expect(toast.x + toast.width, 'toast não pode vazar pela direita').toBeLessThanOrEqual(375);
  });
});
