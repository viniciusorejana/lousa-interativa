const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { PASSWORD } = require('../config');
const { isAuth, createSession } = require('../services/auth.service');

const router = express.Router();

// ─── Rate-limit de /auth (anti-brute-force) ───────────────────────────────────
// Senha única compartilhada + tentativas ilimitadas = alvo fácil de força
// bruta. Contamos falhas por IP e aplicamos backoff: a partir da 5ª falha, um
// atraso crescente (limitado a 30s) antes de aceitar nova tentativa. Um acerto
// zera o contador. Estado em memória (mesmo padrão das sessões) — reinício do
// servidor limpa, o que é aceitável pro caso de uso.
const FAIL_WINDOW_MS   = 15 * 60 * 1000; // falhas mais antigas que isso não contam
const FREE_ATTEMPTS    = 5;              // tentativas sem penalidade
const MAX_BACKOFF_MS   = 30 * 1000;
const attempts = new Map(); // ip → { count, first, blockedUntil }

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

router.post('/auth', (req, res) => {
  const ip  = clientIp(req);
  const now = Date.now();
  let rec = attempts.get(ip);
  if (rec && now - rec.first > FAIL_WINDOW_MS) { attempts.delete(ip); rec = undefined; }

  if (rec && rec.blockedUntil && now < rec.blockedUntil) {
    const retryMs = rec.blockedUntil - now;
    res.setHeader('Retry-After', Math.ceil(retryMs / 1000));
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde alguns segundos.' });
  }

  if ((req.body || {}).password === PASSWORD) {
    attempts.delete(ip); // acerto zera o histórico do IP
    const token = uuidv4();
    createSession(token);
    res.setHeader('Set-Cookie', `lb_session=${token}; Path=/; HttpOnly; SameSite=Strict`);
    return res.json({ ok: true });
  }

  // Falhou: incrementa e, passando das tentativas grátis, agenda o backoff.
  if (!rec) { rec = { count: 0, first: now, blockedUntil: 0 }; attempts.set(ip, rec); }
  rec.count++;
  if (rec.count > FREE_ATTEMPTS) {
    const over  = rec.count - FREE_ATTEMPTS;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (over - 1)); // 1s,2s,4s…30s
    rec.blockedUntil = now + delay;
    res.setHeader('Retry-After', Math.ceil(delay / 1000));
  }
  res.status(401).json({ ok: false });
});

router.get('/check', (req, res) => (
  isAuth(req) ? res.json({ ok: true }) : res.status(401).json({ ok: false })
));

module.exports = router;
