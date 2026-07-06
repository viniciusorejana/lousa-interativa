const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');

const { DATA_DIR, UPLOADS_MAX_MB } = require('../config');
const { isAuth } = require('../services/auth.service');
const { rooms } = require('../services/room.service');
const { getUploadsStats } = require('../services/upload.service');
const { collectImageFilenames } = require('../utils/files');
const { slugify } = require('../utils/slugify');

const router = express.Router();

// Proxy de imagens externas — evita problemas de CORS ao arrastar/colar imagens da internet
router.get('/api/img-proxy', (req, res) => {
  if (!isAuth(req)) return res.status(401).send('Não autenticado');
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).send('URL inválida');
  try {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const request = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      if (r.statusCode >= 400) return res.status(r.statusCode).send('Erro ao buscar imagem');
      res.setHeader('Content-Type', r.headers['content-type'] || 'image/png');
      res.setHeader('Access-Control-Allow-Origin', '*');
      r.pipe(res);
    });
    request.on('error', err => res.status(500).send('Proxy error: ' + err.message));
    request.setTimeout(10000, () => { request.destroy(); res.status(504).send('Timeout'); });
  } catch (err) {
    res.status(500).send('Proxy error: ' + err.message);
  }
});

// API: lista salas ativas (para UI de escolha de sala)
router.get('/api/rooms', (req, res) => {
  // Salas em RAM
  const inMemory = Object.entries(rooms).map(([id, r]) => ({
    id,
    users: Object.keys(r.users).length,
    active: Object.keys(r.users).length > 0,
  }));
  // Salas salvas em disco mas fora da RAM
  const onDisk = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .filter(id => !rooms[id])
    .map(id => ({ id, users: 0, active: false }));
  res.json([...inMemory, ...onDisk]);
});

// API: visão geral de uso de armazenamento (uploads + salas) — pra
// acompanhar sem precisar de SSH durante uma live.
router.get('/api/storage', (req, res) => {
  if (!isAuth(req)) return res.status(401).json({ error: 'Não autenticado' });

  const uploads = getUploadsStats();

  const roomsInfo = Object.entries(rooms).map(([id, r]) => {
    let imgCount = 0;
    for (const obj of Object.values(r.state.objects || {})) {
      const set = new Set();
      collectImageFilenames(obj, set);
      imgCount += set.size;
    }
    return {
      id,
      users:   Object.keys(r.users).length,
      objects: Object.keys(r.state.objects || {}).length,
      images:  imgCount,
    };
  });

  res.json({
    uploads: {
      fileCount:   uploads.fileCount,
      totalMB:     uploads.totalMB,
      limitMB:     UPLOADS_MAX_MB,
      percentUsed: +((uploads.totalMB / UPLOADS_MAX_MB) * 100).toFixed(1),
    },
    rooms: roomsInfo,
  });
});

// Slug preview: retorna o slug que será usado para um nome
router.get('/api/slug', (req, res) => {
  res.json({ slug: slugify(req.query.name || '') });
});

module.exports = router;
