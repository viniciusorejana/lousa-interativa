const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');

const { DATA_DIR, UPLOADS_MAX_MB } = require('../config');
const { isAuth } = require('../services/auth.service');
const { rooms } = require('../services/room.service');
const { getUploadsStats } = require('../services/upload.service');
const { collectImageFilenames } = require('../utils/files');
const { slugify } = require('../utils/slugify');

const router = express.Router();

// Teto do que o proxy aceita baixar (evita usar o proxy pra puxar arquivos
// enormes e estourar a memória/banda do servidor). Imagens de board são bem
// menores que isto.
const IMG_PROXY_MAX_BYTES = 25 * 1024 * 1024; // 25MB

// Um IP é "privado" se aponta pra dentro da própria infra (loopback, LAN,
// link-local, metadata de cloud como 169.254.169.254). Deixar o proxy buscar
// esses endereços é SSRF: um usuário autenticado podia usar o servidor como
// trampolim pra alcançar serviços internos não expostos à internet.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;                          // loopback
    if (p[0] === 0)   return true;
    if (p[0] === 169 && p[1] === 254) return true;          // link-local / metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const a = ip.toLowerCase();
    if (a === '::1') return true;                           // loopback
    if (a.startsWith('fe80')) return true;                  // link-local
    if (a.startsWith('fc') || a.startsWith('fd')) return true; // ULA
    // IPv4 mapeado em IPv6 (::ffff:a.b.c.d) — valida a parte IPv4
    const m = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true; // formato desconhecido → recusa por segurança
}

// Proxy de imagens externas — evita problemas de CORS ao arrastar/colar imagens da internet
router.get('/api/img-proxy', async (req, res) => {
  if (!isAuth(req)) return res.status(401).send('Não autenticado');
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).send('URL inválida');

  let parsed;
  try { parsed = new URL(url); } catch (_) { return res.status(400).send('URL inválida'); }

  // Resolve o host e recusa se QUALQUER endereço resolvido for privado. Sem
  // isto, "http://169.254.169.254/..." ou "http://192.168.0.1/..." passariam.
  try {
    const addrs = await dns.lookup(parsed.hostname, { all: true });
    if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) {
      return res.status(403).send('Destino não permitido');
    }
  } catch (_) {
    return res.status(400).send('Host inválido');
  }

  try {
    const mod = parsed.protocol === 'https:' ? https : http;
    const request = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      if (r.statusCode >= 400) { r.destroy(); return res.status(r.statusCode).send('Erro ao buscar imagem'); }
      // Só repassa conteúdo que se declara imagem — o proxy não é um túnel
      // genérico. E aplica um teto de bytes durante o streaming.
      const ctype = r.headers['content-type'] || '';
      if (!ctype.startsWith('image/')) { r.destroy(); return res.status(415).send('Conteúdo não é imagem'); }
      const declared = parseInt(r.headers['content-length'] || '0', 10);
      if (declared && declared > IMG_PROXY_MAX_BYTES) { r.destroy(); return res.status(413).send('Imagem grande demais'); }

      res.setHeader('Content-Type', ctype);
      res.setHeader('Access-Control-Allow-Origin', '*');

      let received = 0;
      r.on('data', chunk => {
        received += chunk.length;
        if (received > IMG_PROXY_MAX_BYTES) {
          r.destroy();
          if (!res.headersSent) res.status(413);
          res.end();
        }
      });
      r.pipe(res);
    });
    request.on('error', err => { if (!res.headersSent) res.status(500).send('Proxy error: ' + err.message); });
    request.setTimeout(10000, () => { request.destroy(); if (!res.headersSent) res.status(504).send('Timeout'); });
  } catch (err) {
    res.status(500).send('Proxy error: ' + err.message);
  }
});

// API: lista salas ativas (para UI de escolha de sala). Autenticado: enumerar
// salas + slugs vaza os endereços /view de todas as lives ativas pra qualquer
// visitante anônimo. O cliente não consome esta rota sem estar logado.
router.get('/api/rooms', (req, res) => {
  if (!isAuth(req)) return res.status(401).json({ error: 'Não autenticado' });
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
router.get('/api/storage', async (req, res) => {
  if (!isAuth(req)) return res.status(401).json({ error: 'Não autenticado' });

  const uploads = await getUploadsStats();

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
