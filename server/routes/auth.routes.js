const express = require('express');
const { v4: uuidv4 } = require('uuid');

const { PASSWORD } = require('../config');
const { isAuth, createSession } = require('../services/auth.service');

const router = express.Router();

router.post('/auth', (req, res) => {
  if ((req.body || {}).password === PASSWORD) {
    const token = uuidv4();
    createSession(token);
    res.setHeader('Set-Cookie', `lb_session=${token}; Path=/; HttpOnly; SameSite=Strict`);
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
});

router.get('/check', (req, res) => (
  isAuth(req) ? res.json({ ok: true }) : res.status(401).json({ ok: false })
));

module.exports = router;
