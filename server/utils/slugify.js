// ─── Slugify: converte nome de sala para ID seguro para URL e arquivo ─────────
// "Lousa 1" → "lousa-1", "Minha Lousa!" → "minha-lousa"
function slugify(name) {
  return (name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')  // só letras, números, espaços e hífens
    .replace(/\s+/g, '-')          // espaços → hífens
    .replace(/-+/g, '-')           // hífens duplos → simples
    .replace(/^-|-$/g, '')         // remove hífens no início/fim
    || 'sala';
}

module.exports = { slugify };
