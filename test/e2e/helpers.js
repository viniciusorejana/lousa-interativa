const { expect } = require('@playwright/test');
const crypto = require('crypto');
const { TEST_PASSWORD } = require('./constants');

function uniqueRoomName() {
  return 'E2E Room ' + crypto.randomUUID().slice(0, 8);
}

// Percorre o fluxo de login completo (senha -> escolher sala -> nome) até o
// board carregar e o socket conectar — mesmo roteiro do passo 1 do
// CHECKLIST.md. Retorna o nome da sala usado, para os specs referenciarem
// a mesma sala (ex: montar a URL de /view/:slug ou abrir uma segunda aba).
async function login(page, { roomName = uniqueRoomName(), userName = 'Tester' } = {}) {
  await page.goto('/');
  await page.fill('#pw', TEST_PASSWORD);
  await page.click('#btn1');

  await expect(page.locator('#step2')).toBeVisible();
  await page.fill('#rname', roomName);
  await page.click('#btn2');

  await expect(page.locator('#step3')).toBeVisible();
  await page.fill('#uname', userName);
  await page.click('#btn3');

  await page.waitForURL('**/board.html');
  await expect(page.locator('#stxt')).toHaveText('Conectado', { timeout: 10000 });

  return roomName;
}

// Desenha uma forma retangular arrastando o mouse na área do canvas — usado
// tanto para testar o desenho em si quanto como setup de outros testes
// (seleção, grupo, undo/redo etc) que precisam de "algum objeto no board".
async function drawRect(page, { from = { x: 300, y: 250 }, to = { x: 420, y: 370 } } = {}) {
  await page.keyboard.press('r'); // atalho da ferramenta retângulo
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('v'); // volta pra ferramenta de seleção
}

module.exports = { login, uniqueRoomName, drawRect };
