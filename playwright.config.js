// Config do Playwright (E2E de navegador) — cobre os itens do roteiro manual
// de CHECKLIST.md que exigem DOM real (upload, multi-aba, rota /view do OBS),
// algo que test-harness/ (mocks) não alcança.
//
// Sobe uma instância REAL de server/index.js via webServer, apontando
// UPLOADS/DATA_DIR pra um diretório temporário via LB_TEST_UPLOADS_DIR/
// LB_TEST_DATA_DIR (mesmo mecanismo usado pelos testes de integração de
// servidor, ver test/server/integration/_setup.js) — nunca os diretórios
// reais de dev, pelo mesmo motivo documentado lá (cleanOnStartup apaga tudo).
const path = require('path');
const os = require('os');
const fs = require('fs');
const { defineConfig } = require('@playwright/test');

const PORT = 4173;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'liveboard-e2e-'));

module.exports = defineConfig({
  testDir: './test/e2e',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/index.js',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 20000,
    env: {
      PORT: String(PORT),
      BOARD_PASSWORD: require('./test/e2e/constants').TEST_PASSWORD,
      LB_TEST_UPLOADS_DIR: path.join(tmpRoot, 'uploads'),
      LB_TEST_DATA_DIR: path.join(tmpRoot, 'data-rooms'),
    },
  },
});
