const express = require('express');
const fs = require('fs');

const {
  uploadMiddleware, getUploadsStats, sweepOrphanedUploads, processUploadedFile,
} = require('../services/upload.service');
const { UPLOADS_MAX_MB } = require('../config');

const router = express.Router();

router.post('/upload', uploadMiddleware.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo' });

  // Teto de segurança: nunca deixa a pasta de uploads crescer sem limite.
  // Caminho feliz (bem abaixo do teto) faz só UM readdir assíncrono — sem
  // varredura de órfãos, sem unlink. A varredura completa (mais cara) só roda
  // quando de fato batemos no teto: se o "excesso" for só lixo acumulado, isso
  // libera espaço e evita recusar um upload legítimo. Tudo assíncrono (fs/
  // promises) pra não travar o event loop e congelar as salas ativas.
  let stats = await getUploadsStats();
  if (stats.totalMB >= UPLOADS_MAX_MB) {
    await sweepOrphanedUploads();
    stats = await getUploadsStats();
  }
  if (stats.totalMB >= UPLOADS_MAX_MB) {
    fs.unlink(req.file.path, () => {});
    return res.status(507).json({
      error: `Armazenamento cheio (${stats.totalMB}MB / ${UPLOADS_MAX_MB}MB). Apague algumas imagens/gifs antigas do board pra liberar espaço.`,
    });
  }

  try {
    const { url } = await processUploadedFile(req.file);
    res.json({ url });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

module.exports = router;
