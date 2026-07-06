// ─── Sessões de autenticação (senha única compartilhada, cookie HttpOnly) ─────
const sessions = new Set();

function getToken(req) {
  const m = (req.headers.cookie || '').match(/lb_session=([^;]+)/);
  return m ? m[1] : null;
}

function isAuth(req) {
  return sessions.has(getToken(req));
}

function createSession(token) {
  sessions.add(token);
}

module.exports = { getToken, isAuth, createSession };
