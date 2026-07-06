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
  // Roda uma varredura de órfãos primeiro — se o "excesso" for só lixo
  // acumulado, isso já libera espaço e evita recusar um upload legítimo.
  sweepOrphanedUploads();
  const stats = getUploadsStats();
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
