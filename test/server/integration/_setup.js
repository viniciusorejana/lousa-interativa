// Helper compartilhado pelos testes de integração de servidor: sobe uma
// instância REAL do server/index.js (http + Socket.IO) em porta livre,
// apontando UPLOADS/DATA_DIR para diretórios temporários — nunca os
// diretórios reais de dev (uploads/index.js limpa tudo no boot por design,
// ver cleanOnStartup em server/index.js; não podemos deixar isso apagar
// dados reais como data/rooms/lousa.json).
const net = require('net');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TEST_PASSWORD = 'test-password-liveboard';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Sobe o servidor real uma única vez por processo de teste (server/index.js
// tem efeito colateral de módulo — não pode ser exigido duas vezes no mesmo
// processo). Cada arquivo de teste roda em seu próprio processo Node (padrão
// do `node --test` com múltiplos arquivos), então isso é seguro entre arquivos.
let started = null;

async function startTestServer() {
  if (started) return started;

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'liveboard-test-'));
  const uploadsDir = path.join(tmpRoot, 'uploads');
  const dataDir = path.join(tmpRoot, 'data-rooms');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const port = await getFreePort();

  process.env.PORT = String(port);
  process.env.BOARD_PASSWORD = TEST_PASSWORD;
  process.env.LB_TEST_UPLOADS_DIR = uploadsDir;
  process.env.LB_TEST_DATA_DIR = dataDir;

  require('../../../server/index.js');

  // Trava de segurança: se ALGUM require anterior (de qualquer arquivo de
  // teste) já tiver puxado server/config.js antes das envs acima serem
  // setadas, o módulo (cacheado pelo Node) ficaria preso nos diretórios reais
  // de uploads/data/rooms — e cleanOnStartup() os apagaria. Já aconteceu uma
  // vez (apagou data/rooms/lousa.json de verdade). Falha alto e cedo em vez
  // de apagar dados de dev silenciosamente.
  const config = require('../../../server/config');
  if (config.DATA_DIR !== dataDir || config.UPLOADS !== uploadsDir) {
    throw new Error(
      'server/config.js não pegou o override de diretório de teste — ' +
      'algum módulo deve ter sido exigido antes de startTestServer() rodar. ' +
      `Esperado DATA_DIR=${dataDir}, obtido ${config.DATA_DIR}.`
    );
  }

  started = { port, baseUrl: `http://localhost:${port}`, uploadsDir, dataDir };
  return started;
}

function uniqueRoomName() {
  return 'test-room-' + crypto.randomUUID();
}

module.exports = { startTestServer, uniqueRoomName, TEST_PASSWORD };
