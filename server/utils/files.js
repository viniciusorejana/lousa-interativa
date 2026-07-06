const path = require('path');

// ─── Helpers de imagem ────────────────────────────────────────────────────────
function imgFilename(src) {
  if (!src) return null;
  try { return path.basename(new URL(src).pathname); } catch (_) {}
  if (src.includes('/uploads/')) return path.basename(src);
  return null;
}

// Coleta recursivamente nomes de arquivo de imagem referenciados por um
// objeto — inclusive dentro de grupos. Grupos guardam os filhos serializados
// DENTRO de si mesmos (obj.objects[]), não como entradas separadas em
// room.state.objects, então uma imagem dentro de um grupo só é encontrada
// recursando aqui — sem isso, ela pareceria "não referenciada" e seria
// apagada por engano enquanto ainda está visível dentro do grupo.
function collectImageFilenames(obj, set) {
  if (!obj) return;
  const f1 = imgFilename(obj.src);
  if (f1) set.add(f1);
  const f2 = imgFilename(obj._gifUrl);
  if (f2) set.add(f2);
  if (obj.type === 'group' && Array.isArray(obj.objects)) {
    obj.objects.forEach(child => collectImageFilenames(child, set));
  }
}

module.exports = { imgFilename, collectImageFilenames };
