// Itens do roteiro de CHECKLIST.md que precisam de mais de uma aba/contexto,
// ou da rota /view (OBS) — não cabem em board.spec.js (uma aba só).
const { test, expect } = require('@playwright/test');
const { login, drawRect, uniqueRoomName } = require('./helpers');

test.describe('colaboração multi-aba e rota de OBS', () => {
  test('multi-usuário: objeto desenhado numa aba aparece na outra (mesma sala)', async ({ browser }) => {
    const roomName = uniqueRoomName();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await login(pageA, { roomName, userName: 'Usuário A' });
    await login(pageB, { roomName, userName: 'Usuário B' });

    await drawRect(pageA);

    await expect(pageB.locator('.layer-item')).toHaveCount(1, { timeout: 10000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('/view/:sala: carrega sem autenticação, com fundo transparente e sem controles de edição', async ({ page, request }) => {
    const roomName = uniqueRoomName();
    await login(page, { roomName });

    const slugRes = await request.get('/api/slug?name=' + encodeURIComponent(roomName));
    const { slug } = await slugRes.json();

    const viewPage = await page.context().browser().newContext().then(c => c.newPage());
    await viewPage.goto(`/view/${slug}`);

    await expect(viewPage.locator('#board')).toBeVisible();
    await expect(viewPage.locator('#toolbar')).toHaveCount(0);
    await expect(viewPage.locator('#layers-panel')).toHaveCount(0);

    const bg = await viewPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

    await viewPage.context().close();
  });

  test('trocar de sala: reaproveita a sessão sem pedir senha de novo', async ({ page }) => {
    await login(page);

    await page.click('#toolbar button[onclick="changeRoom()"]');
    await page.waitForURL('**/');

    // changeRoom() seta lb_skip_pw e o index.html deveria pular direto pro
    // passo 2 (escolha de sala) em vez de pedir a senha de novo.
    await expect(page.locator('#step2')).toBeVisible();
    await expect(page.locator('#step1')).toBeHidden();
  });
});
