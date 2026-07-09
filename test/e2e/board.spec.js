// E2E do fluxo principal do board — automatiza os itens do roteiro manual de
// CHECKLIST.md que rodam numa única aba (login, desenho, seleção, camadas,
// grupo, upload via input de arquivo, undo/redo, exportar PNG). Itens que
// precisam de múltiplas abas ou da rota /view ficam em collaboration.spec.js.
const path = require('path');
const { test, expect } = require('@playwright/test');
const { login, drawRect } = require('./helpers');

test.describe('board: fluxo principal numa aba', () => {
  let consoleErrors;

  test.beforeEach(({ page }) => {
    consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(err.message));
  });

  test('login: senha -> sala -> nome chega no board conectado, sem erros de console', async ({ page }) => {
    await login(page);
    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('desenhar: as 4 formas de toolbar criam objetos selecionáveis no board', async ({ page }) => {
    await login(page);

    const shapes = [
      { key: 'r', from: { x: 250, y: 200 }, to: { x: 350, y: 300 } },
      { key: 'c', from: { x: 400, y: 200 }, to: { x: 500, y: 300 } },
      { key: 'l', from: { x: 250, y: 350 }, to: { x: 350, y: 450 } },
      { key: 'a', from: { x: 400, y: 350 }, to: { x: 500, y: 450 } },
    ];

    for (const s of shapes) {
      await page.keyboard.press(s.key);
      await page.mouse.move(s.from.x, s.from.y);
      await page.mouse.down();
      await page.mouse.move(s.to.x, s.to.y, { steps: 5 });
      await page.mouse.up();
    }
    await page.keyboard.press('v');

    // As 4 formas devem aparecer como itens individuais no painel de camadas.
    await expect(page.locator('.layer-item')).toHaveCount(4);

    // Marquee (arrasto) em vez de clique no centro: as formas são desenhadas
    // sem preenchimento (só contorno), e o canvas usa hit-test por pixel real
    // (perPixelTargetFind, ver canvas-manager.js) — um clique no centro
    // "vazio" da forma não a seleciona. Um arrasto cobrindo a bounding box
    // funciona independente de preenchimento.
    await page.mouse.move(240, 190);
    await page.mouse.down();
    await page.mouse.move(360, 310, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('#ctx')).toBeVisible();

    expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('camadas: criar, renomear e ocultar/mostrar', async ({ page }) => {
    await login(page);

    await expect(page.locator('.layer-section-header')).toHaveCount(1);
    await page.click('#layers-toolbar button:has-text("Nova")');
    await expect(page.locator('.layer-section-header')).toHaveCount(2);

    // addLayer() coloca a camada nova no topo (primeira seção do painel).
    const newLayerName = page.locator('.layer-section-name').first();
    await expect(newLayerName).toHaveText('Camada 2');

    await newLayerName.dblclick();
    const renameInput = page.locator('.layer-section-name-input');
    await renameInput.fill('Camada de Teste');
    await renameInput.press('Enter');
    await expect(page.locator('.layer-section-name').first()).toHaveText('Camada de Teste');

    const eyeBtn = page.locator('.layer-section-header').first().locator('button[title="Ocultar do board"]');
    await eyeBtn.click();
    await expect(page.locator('.layer-section-header').first().locator('button.hidden-layer')).toHaveCount(1);
  });

  test('grupo: agrupar e desagrupar 2 objetos selecionados', async ({ page }) => {
    await login(page);

    await drawRect(page, { from: { x: 250, y: 200 }, to: { x: 320, y: 270 } });
    await drawRect(page, { from: { x: 400, y: 200 }, to: { x: 470, y: 270 } });

    // Marquee (retângulo de seleção) cobrindo as duas formas.
    await page.mouse.move(200, 150);
    await page.mouse.down();
    await page.mouse.move(520, 320, { steps: 5 });
    await page.mouse.up();

    const groupBtn = page.locator('#lt-group');
    await expect(groupBtn).toBeEnabled();
    await groupBtn.click();

    await expect(page.locator('.layer-item.is-group')).toHaveCount(1);

    const ungroupBtn = page.locator('#lt-ungroup');
    await expect(ungroupBtn).toBeEnabled();
    await ungroupBtn.click();
    await expect(page.locator('.layer-item.is-group')).toHaveCount(0);
  });

  test('upload de imagem: aparece como objeto de imagem no painel de camadas', async ({ page }) => {
    await login(page);

    const fixture = path.join(__dirname, 'fixtures', 'tiny.png');
    await page.setInputFiles('#img-inp', fixture);

    // Upload real (grava em UPLOADS temporário + recomprime pra WebP no
    // servidor) — dá tempo de completar antes de checar o painel.
    await expect(page.locator('.layer-item')).toHaveCount(1, { timeout: 10000 });
  });

  test('undo/redo: desfaz e refaz a criação de um objeto', async ({ page }) => {
    await login(page);
    await drawRect(page);

    const countBadge = page.locator('.layer-section-header').first().locator('span').nth(1);
    await expect(countBadge).toHaveText('1');

    await page.keyboard.press('Control+z');
    await expect(countBadge).toHaveText('0');

    await page.keyboard.press('Control+y');
    await expect(countBadge).toHaveText('1');
  });

  test('exportar PNG: dispara um download', async ({ page }) => {
    await login(page);
    await drawRect(page);
    await page.mouse.click(360, 310); // seleciona a forma desenhada

    const exportBtn = page.locator('#toolbar button[onclick="exportSelectionOrBoardAsPNG()"]');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportBtn.click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.png$/);
  });
});
