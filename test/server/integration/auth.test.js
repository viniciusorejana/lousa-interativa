const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, TEST_PASSWORD } = require('./_setup');

// server/index.js não exporta a instância http/io (é bootstrap-only por
// design) e deixa timers ativos de manutenção em background (eviction sweep,
// varredura de uploads órfãos) — sem referência a eles pra dar clearInterval,
// o processo nunca sairia sozinho. Força a saída aqui em vez de usar
// `--test-force-exit` (que colide com um bug conhecido do libuv no Windows
// ao fechar handles do Socket.IO à força).
after(() => new Promise(resolve => setTimeout(() => { process.exit(0); resolve(); }, 200)));

test('integração de servidor: auth HTTP', async (t) => {
  const { baseUrl } = await startTestServer();

  await t.test('POST /auth com senha errada retorna 401', async () => {
    const res = await fetch(`${baseUrl}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'senha-errada' }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
  });

  await t.test('POST /auth com senha certa retorna 200 e cookie de sessão', async () => {
    const res = await fetch(`${baseUrl}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(res.headers.get('set-cookie') || '', /lb_session=/);
  });

  await t.test('GET /check sem cookie retorna 401', async () => {
    const res = await fetch(`${baseUrl}/check`);
    assert.equal(res.status, 401);
  });

  await t.test('GET /check com cookie de sessão válido retorna 200', async () => {
    const authRes = await fetch(`${baseUrl}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    const cookie = (authRes.headers.get('set-cookie') || '').split(';')[0];

    const checkRes = await fetch(`${baseUrl}/check`, { headers: { cookie } });
    assert.equal(checkRes.status, 200);
  });
});
