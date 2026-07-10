const fs     = require('fs');
const fsp    = require('fs/promises');
const path   = require('path');
const multer = require('multer');
const sharp  = require('sharp');
const { v4: uuidv4 } = require('uuid');

const {
  UPLOADS, MAX_IMAGE_DIMENSION, WEBP_QUALITY, GIF_MAX_SIZE,
  UPLOADS_MAX_MB, UPLOAD_SWEEP_INTERVAL, UPLOAD_GRACE_MS, STORAGE_LOG_INTERVAL,
} = require('../config');
const { collectReferencedFilenames } = require('./room.service');

// ─── Multer (recebe o arquivo bruto antes de qualquer processamento) ────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS),
  filename:    (_, file, cb) => cb(null, uuidv4() + (path.extname(file.originalname) || '.png')),
});

const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const mime = file.mimetype || '';
    const ext  = path.extname(file.originalname || '').toLowerCase();
    const ok   = mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext);
    ok ? cb(null, true) : cb(new Error('Apenas imagens'));
  },
});

// Estatísticas de uso da pasta de uploads. Assíncrono (fs/promises): a I/O de
// disco roda no threadpool do libuv em vez de travar o event loop — importante
// porque isto é consultado no caminho de cada /upload, e uma pasta com
// centenas de arquivos fazia readdir/stat SÍNCRONO congelar TODAS as salas
// (cursores, traços) durante a varredura. Usado no teto de segurança do
// /upload, no endpoint /api/storage e no log periódico.
async function getUploadsStats() {
  let totalBytes = 0, fileCount = 0;
  let files;
  try { files = await fsp.readdir(UPLOADS); } catch (_) { files = []; }
  for (const f of files) {
    try {
      const stat = await fsp.stat(path.join(UPLOADS, f));
      totalBytes += stat.size;
      fileCount++;
    } catch (_) {}
  }
  return { fileCount, totalBytes, totalMB: +(totalBytes / 1024 / 1024).toFixed(1) };
}

// Varredura periódica de uploads órfãos: um arquivo é órfão quando não está
// em collectReferencedFilenames() — ou seja, não é referenciado por NENHUMA
// sala conhecida, nem no estado atual, nem em nenhuma pilha de undo/redo.
//
// Não usamos "tempo desde o último uso" como critério de segurança (isso
// arriscaria apagar uma imagem parada mas visível na tela — ex: uma logo que
// fica horas sem ser tocada mas continua sendo exibida). O critério real é
// referência: existe em algum lugar ou não. O tempo (UPLOAD_GRACE_MS) entra
// só como uma folga de segurança pra uploads recém-chegados que ainda não
// foram sincronizados no estado da sala (uma corrida de milissegundos, não
// minutos) — nunca apagamos algo com menos de 10min de vida.
async function sweepOrphanedUploads() {
  let referenced;
  try { referenced = collectReferencedFilenames(); }
  catch (err) { console.error('[uploads] Erro ao coletar referências:', err.message); return; }

  let files;
  try { files = await fsp.readdir(UPLOADS); } catch (_) { return; }

  const now = Date.now();
  let removed = 0, freedBytes = 0;

  for (const filename of files) {
    if (referenced.has(filename)) continue;
    const filePath = path.join(UPLOADS, filename);
    let stat;
    try { stat = await fsp.stat(filePath); } catch (_) { continue; }
    if (now - stat.mtimeMs < UPLOAD_GRACE_MS) continue;
    try {
      await fsp.unlink(filePath);
      removed++;
      freedBytes += stat.size;
    } catch (_) {}
  }

  if (removed > 0) {
    console.log(`[uploads] Varredura de órfãos: ${removed} arquivo(s) removido(s), ${(freedBytes / 1024 / 1024).toFixed(1)}MB liberados`);
  }
}

function startUploadMaintenance() {
  setInterval(() => { sweepOrphanedUploads().catch(() => {}); }, UPLOAD_SWEEP_INTERVAL);

  // Log periódico de uso de disco — visibilidade simples sem precisar de SSH
  // durante uma live pra saber se o armazenamento está sob controle.
  setInterval(async () => {
    const stats = await getUploadsStats();
    console.log(`[uploads] Uso atual: ${stats.fileCount} arquivo(s), ${stats.totalMB}MB / ${UPLOADS_MAX_MB}MB`);
  }, STORAGE_LOG_INTERVAL);
}

// Processa um arquivo recém-enviado (req.file do multer) e devolve a URL
// pública final. GIF e SVG não são recomprimidos (ver comentário em
// config.js); os demais formatos são redimensionados e convertidos pra WebP.
async function processUploadedFile(file) {
  const cleanupTemp = () => fs.unlink(file.path, () => {});
  const ext = path.extname(file.filename).toLowerCase();

  if (ext === '.gif') {
    if (file.size > GIF_MAX_SIZE) {
      cleanupTemp();
      const err = new Error(`GIF muito grande (máx. ${GIF_MAX_SIZE / 1024 / 1024}MB).`);
      err.statusCode = 413;
      throw err;
    }
    return { url: '/uploads/' + file.filename };
  }

  // SVG também não é recomprimido: rasterizar um SVG faria ele perder a
  // escalabilidade vetorial, e SVGs já costumam ser pequenos (baseados em
  // texto) — não há ganho real em processar.
  if (ext === '.svg') {
    return { url: '/uploads/' + file.filename };
  }

  // Demais formatos (jpg/png/webp/bmp): redimensiona (se maior que o teto) e
  // recomprime pra WebP. Costuma cortar 70-90% do peso de uma foto normal sem
  // perda visível.
  try {
    const outputFilename = uuidv4() + '.webp';
    const outputPath = path.join(UPLOADS, outputFilename);

    await sharp(file.path)
      .rotate() // aplica a orientação EXIF antes de descartar os metadados
      .resize({
        width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION,
        fit: 'inside', withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toFile(outputPath);

    cleanupTemp(); // remove o arquivo original (pré-compressão)
    return { url: '/uploads/' + outputFilename };
  } catch (err) {
    console.error('[upload] Erro ao comprimir imagem, entregando original:', err.message);
    // Fallback: se a compressão falhar por algum motivo (arquivo corrompido,
    // formato inesperado, etc.), ainda entrega o arquivo original em vez de
    // quebrar o upload do usuário.
    return { url: '/uploads/' + file.filename };
  }
}

module.exports = {
  uploadMiddleware,
  getUploadsStats,
  sweepOrphanedUploads,
  startUploadMaintenance,
  processUploadedFile,
};
