// ── Monkey-patch fabric.Image.fromURL ─────────────────────────────────────────
// Intercepta TODA carga de imagem do Fabric (inclusive filhos de grupos via
// fabric.Group.fromObject → fabric.util.enlivenObjects → fabric.Image.fromObject).
// Garante: (1) crossOrigin='anonymous' sempre, (2) src normalizado para origin atual,
// (3) cache de HTMLImageElement — zero re-downloads ao mover/modificar objetos.
//
// Compartilhado entre board.html e view.html (antes duplicado byte-a-byte nos
// dois arquivos). Script clássico (não ES module) de propósito: precisa
// executar de forma síncrona e imediata, na mesma ordem de hoje, antes de
// qualquer uso de fabric.Image pelo resto do código de cada página — um
// `type="module"` seria adiado para depois do parsing do HTML, o que mudaria
// essa ordem e quebraria o patch para o carregamento inicial de imagens.
(function patchFabricImageFromURL() {
  // url → { el: HTMLImageElement, pending: [{ctx,callback,opts}] | null }
  const _imgCache = new Map();

  function normalizeUrl(url) {
    const u = url || '';
    if (!u || u.startsWith('blob:') || u.startsWith('data:')) return u;
    if (!u.startsWith('http')) {
      return window.location.origin + (u.startsWith('/') ? u : '/' + u);
    }
    try {
      const parsed = new URL(u);
      if (parsed.pathname.startsWith('/uploads/')) {
        return window.location.origin + parsed.pathname;
      }
    } catch(_) {}
    return u;
  }

  const _orig = fabric.Image.fromURL;
  fabric.Image.fromURL = function(url, callback, imgOptions) {
    const absUrl = normalizeUrl(url);
    const opts = Object.assign({}, imgOptions || {});
    opts.crossOrigin = 'anonymous';

    // Imagens que não são uploads passam direto (blobs, data:, SVG inline, etc)
    if (!absUrl || !absUrl.includes('/uploads/')) {
      return _orig.call(this, absUrl, callback, opts);
    }

    const cached = _imgCache.get(absUrl);

    // Cache hit: elemento já carregado — entrega imediatamente via clone
    if (cached && cached.el && cached.el.complete && cached.el.naturalWidth > 0) {
      const clone = new Image();
      clone.crossOrigin = 'anonymous';
      clone.src = cached.el.src;
      const finish = () => callback(new fabric.Image(clone, opts));
      if (clone.complete && clone.naturalWidth > 0) { finish(); return; }
      clone.onload = finish;
      clone.onerror = () => _orig.call(this, absUrl, callback, opts);
      return;
    }

    // Carga já em andamento — enfileira callback
    if (cached && cached.pending) {
      cached.pending.push({ ctx: this, callback, opts });
      return;
    }

    // Cache miss: inicia carga
    _imgCache.set(absUrl, { el: null, pending: [{ ctx: this, callback, opts }] });

    // fetch primeiro para garantir CORS headers no cache HTTP antes do <img>
    fetch(absUrl, { mode: 'cors', credentials: 'omit' })
      .catch(() => {})
      .finally(() => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => {
          const entry = _imgCache.get(absUrl) || {};
          const pending = entry.pending || [];
          _imgCache.set(absUrl, { el, pending: null });
          pending.forEach(({ ctx, callback: cb, opts: o }) => {
            const clone = new Image();
            clone.crossOrigin = 'anonymous';
            clone.src = el.src;
            const finish = () => cb(new fabric.Image(clone, o));
            if (clone.complete && clone.naturalWidth > 0) finish();
            else { clone.onload = finish; clone.onerror = () => _orig.call(ctx, absUrl, cb, o); }
          });
        };
        el.onerror = () => {
          const entry = _imgCache.get(absUrl) || {};
          const pending = entry.pending || [];
          _imgCache.delete(absUrl);
          pending.forEach(({ ctx, callback: cb, opts: o }) => _orig.call(ctx, absUrl, cb, o));
        };
        el.src = absUrl;
      });
  };

  // Expõe para pré-aquecimento no board:init
  window._fabricImgCache = _imgCache;
  window._normalizeImgUrl = normalizeUrl;
})();
