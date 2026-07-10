// ─── Escape de HTML para interpolação segura em innerHTML ─────────────────────
// Qualquer texto que venha de outro cliente (nome de usuário, nome de objeto/
// camada/grupo renomeado, conteúdo de um texto do board) e seja inserido via
// innerHTML PRECISA passar por aqui antes — senão vira XSS. O limite de
// caracteres do nome (24) NÃO protege: `<svg onload=alert(1)>` cabe folgado.
// Módulo ES (importado só por outros módulos ES); não faz parte da ponte window.
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
