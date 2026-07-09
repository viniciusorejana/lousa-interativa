// ── Monkey-patch fabric.Object.prototype.drawObject: borracha real ────────────
// Cada objeto pode ter `eraseStrokes` = [{ points:[{x,y},...], width }], em
// coordenadas LOCAIS do próprio objeto (mesmo referencial que fabric.Object usa
// dentro de _render: origem no centro, sem escala/rotação aplicada — a mesma
// transform matrix que o Fabric já monta pra desenhar o objeto cuida de
// posicionar/rotacionar/escalar o traço de apagar junto com o resto). Depois
// do desenho normal do objeto, "recorta" cada traço com destination-out.
//
// Ponto-chave verificado direto no código-fonte do fabric.js 5.3.1:
// drawObject(ctx) é chamado tanto para o cache próprio do objeto
// (this._cacheContext, o caso normal — objectCaching:true é o padrão e
// this.group nunca existe aqui, já que "grupos" neste projeto são só uma tag
// `groupId`, não um fabric.Group real) quanto, raramente, direto no ctx
// principal quando shouldCache() é false. Como cada objeto tem seu próprio
// cache canvas isolado, destination-out aqui nunca vaza para os objetos atrás
// — só perfura o próprio bitmap do objeto antes dele ser colado no canvas.
//
// Script clássico (não ES module) de propósito, igual fabric-image-patch.js:
// precisa já estar aplicado antes de qualquer render, em board.html e
// view.html (as duas páginas que desenham objetos com eraseStrokes).
(function patchFabricEraseRender() {
  const _origDrawObject = fabric.Object.prototype.drawObject;
  fabric.Object.prototype.drawObject = function(ctx, forClipping) {
    _origDrawObject.call(this, ctx, forClipping);
    if (forClipping) return;
    const strokes = this.eraseStrokes;
    if (!strokes || !strokes.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) {
      if (!s.points || !s.points.length) continue;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      if (s.points.length === 1) {
        // Clique único sem arrasto: "carimba" um círculo em vez de uma linha
        ctx.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      ctx.stroke();
    }
    ctx.restore();
  };
})();
