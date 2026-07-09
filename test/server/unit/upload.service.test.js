const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const { UPLOADS, GIF_MAX_SIZE } = require('../../../server/config');
const { processUploadedFile } = require('../../../server/services/upload.service');

function tempName(ext) {
  return `test-${crypto.randomUUID()}${ext}`;
}

// Arquivos criados diretamente neste teste (fora do fluxo real de multer) —
// removidos ao final para não deixar lixo em uploads/ real.
function cleanupFile(filename) {
  try { fs.unlinkSync(path.join(UPLOADS, filename)); } catch (_) {}
}

test('processUploadedFile: GIF maior que GIF_MAX_SIZE lança erro 413', async () => {
  const filename = tempName('.gif');
  const file = { path: path.join(UPLOADS, filename), filename, size: GIF_MAX_SIZE + 1 };

  await assert.rejects(
    () => processUploadedFile(file),
    (err) => {
      assert.equal(err.statusCode, 413);
      return true;
    }
  );
});

test('processUploadedFile: GIF dentro do limite retorna URL sem recompressão', async (t) => {
  const filename = tempName('.gif');
  t.after(() => cleanupFile(filename));
  const file = { path: path.join(UPLOADS, filename), filename, size: 1024 };

  const result = await processUploadedFile(file);
  assert.equal(result.url, '/uploads/' + filename);
});

test('processUploadedFile: SVG não é recomprimido', async (t) => {
  const filename = tempName('.svg');
  t.after(() => cleanupFile(filename));
  const file = { path: path.join(UPLOADS, filename), filename, size: 512 };

  const result = await processUploadedFile(file);
  assert.equal(result.url, '/uploads/' + filename);
});

test('processUploadedFile: imagem comum é recomprimida para WebP e o original é removido', async (t) => {
  const filename = tempName('.png');
  const filePath = path.join(UPLOADS, filename);
  await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
  }).png().toFile(filePath);

  const file = { path: filePath, filename, size: fs.statSync(filePath).size };
  const result = await processUploadedFile(file);
  t.after(() => {
    const outFilename = result.url.replace('/uploads/', '');
    cleanupFile(outFilename);
  });

  assert.match(result.url, /^\/uploads\/.+\.webp$/);
  assert.equal(fs.existsSync(filePath), false, 'arquivo PNG original deveria ter sido removido após a recompressão');
});
