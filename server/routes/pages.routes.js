const express = require('express');
const path = require('path');

const { PUBLIC_DIR } = require('../config');
const { isAuth } = require('../services/auth.service');

const router = express.Router();

router.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

router.get('/board.html', (req, res) => (
  isAuth(req) ? res.sendFile(path.join(PUBLIC_DIR, 'board.html')) : res.redirect('/')
));

router.get('/view', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'view.html')));
router.get('/view/:roomId', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'view.html')));

// Arquivos estáticos (CSS/JS/imagens do próprio app) — fica por último porque
// as rotas acima têm regras específicas (ex: auth) que o static não conhece.
router.use(express.static(PUBLIC_DIR));

module.exports = router;
