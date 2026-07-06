// ─── Configuração central do servidor ─────────────────────────────────────────
// Único lugar com constantes de ambiente/limites. Nada de lógica aqui — só
// valores e a criação dos diretórios que o resto do server assume que existem.
const path = require('path');
const fs   = require('fs');

const PORT     = process.env.PORT;
const PASSWORD = process.env.BOARD_PASSWORD;

const ROOT_DIR = path.join(__dirname, '..');
const UPLOADS  = path.join(ROOT_DIR, 'uploads');
const DATA_DIR = path.join(ROOT_DIR, 'data/rooms');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

[UPLOADS, DATA_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ─── Upload / compressão de imagem ────────────────────────────────────────────
// Imagens estáticas (jpg/png/webp/bmp) são recomprimidas pra WebP no upload —
// costuma cortar 70-90% do peso de uma foto normal sem perda visível. GIFs e
// SVGs NÃO passam por essa recompressão (GIF perderia a animação; SVG
// perderia a escalabilidade vetorial virando raster), então têm um teto de
// tamanho mais restrito, já que não há como reduzir o peso deles aqui.
const MAX_IMAGE_DIMENSION = 2400;              // maior lado, em px, após redimensionar
const WEBP_QUALITY        = 84;                // 0-100, 84 é visualmente ~idêntico ao original
const GIF_MAX_SIZE        = 8 * 1024 * 1024;   // 8MB — GIF não é recomprimido, teto mais rígido
const UPLOADS_MAX_MB      = parseInt(process.env.UPLOADS_MAX_MB || '2048', 10); // teto de /uploads (2GB por padrão)
const UPLOAD_SWEEP_INTERVAL = 5  * 60 * 1000;  // varredura de órfãos a cada 5min
const UPLOAD_GRACE_MS       = 10 * 60 * 1000;  // nunca apaga upload com menos de 10min (evita corrida com upload recém-chegado)
const STORAGE_LOG_INTERVAL  = 15 * 60 * 1000;  // log periódico de uso de disco a cada 15min

// ─── Salas / histórico ────────────────────────────────────────────────────────
const MAX_HISTORY   = 30;
const EVICT_MS      = 30 * 60 * 1000;   // salas vazias há mais de 30min são removidas
const SAVE_DEBOUNCE = 2000;             // salva no disco 2s após a última alteração

module.exports = {
  PORT, PASSWORD,
  ROOT_DIR, UPLOADS, DATA_DIR, PUBLIC_DIR,
  MAX_IMAGE_DIMENSION, WEBP_QUALITY, GIF_MAX_SIZE, UPLOADS_MAX_MB,
  UPLOAD_SWEEP_INTERVAL, UPLOAD_GRACE_MS, STORAGE_LOG_INTERVAL,
  MAX_HISTORY, EVICT_MS, SAVE_DEBOUNCE,
};
