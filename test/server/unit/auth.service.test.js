const test = require('node:test');
const assert = require('node:assert/strict');

const { getToken, isAuth, createSession } = require('../../../server/services/auth.service');

function reqWithCookie(cookie) {
  return { headers: { cookie } };
}

test('getToken: extrai token do cookie lb_session', () => {
  assert.equal(getToken(reqWithCookie('lb_session=abc123; other=xyz')), 'abc123');
});

test('getToken: retorna null se não houver cookie lb_session', () => {
  assert.equal(getToken(reqWithCookie('other=xyz')), null);
  assert.equal(getToken({ headers: {} }), null);
});

test('createSession + isAuth: token criado é reconhecido como autenticado', () => {
  createSession('token-valido-1');
  assert.equal(isAuth(reqWithCookie('lb_session=token-valido-1')), true);
});

test('isAuth: token nunca criado não é autenticado', () => {
  assert.equal(isAuth(reqWithCookie('lb_session=nunca-existiu')), false);
});
