// Testa public/js/core/serialization.js isoladamente sob os mocks do
// test-harness. Só precisa do `canvas` de canvas-manager.js (usado para
// calcular zIndex) — não precisa importar o board-app.js inteiro.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../mocks.mjs';

const { canvas } = await import('../../public/js/core/canvas-manager.js');
const { ser, serTransform, absoluteImgUrl } = await import('../../public/js/core/serialization.js');

function makeRect(id, opts = {}) {
  return new fabric.Rect({ id, type: 'rect', left: 10, top: 20, scaleX: 1, scaleY: 1, ...opts });
}

test('absoluteImgUrl: blob: retorna string vazia', () => {
  assert.equal(absoluteImgUrl('blob:http://localhost/xyz'), '');
});

test('absoluteImgUrl: path relativo vira absoluto com a origem atual', () => {
  assert.equal(absoluteImgUrl('/uploads/foo.webp'), 'http://localhost:3000/uploads/foo.webp');
});

test('absoluteImgUrl: URL absoluta de outro host com /uploads/ é reescrita para a origem atual', () => {
  assert.equal(absoluteImgUrl('http://192.168.0.5:3000/uploads/foo.webp'), 'http://localhost:3000/uploads/foo.webp');
});

test('absoluteImgUrl: URL absoluta sem /uploads/ é devolvida como está', () => {
  assert.equal(absoluteImgUrl('https://exemplo.com/logo.png'), 'https://exemplo.com/logo.png');
});

test('absoluteImgUrl: string vazia retorna vazia', () => {
  assert.equal(absoluteImgUrl(''), '');
});

test('ser: inclui zIndex baseado na posição real no canvas (ignorando o retângulo de viewport)', () => {
  canvas.clear();
  const vp = new fabric.Rect({ id: 'vp', type: 'rect', _isViewportRect: true });
  const o1 = makeRect('s-o1');
  const o2 = makeRect('s-o2');
  canvas.add(vp, o1, o2);

  const j1 = ser(o1);
  const j2 = ser(o2);
  assert.equal(j1.zIndex, 0);
  assert.equal(j2.zIndex, 1);
});

test('ser: retorna null para o retângulo de viewport', () => {
  const vp = new fabric.Rect({ id: 'vp2', type: 'rect', _isViewportRect: true });
  assert.equal(ser(vp), null);
});

test('ser: scaleX/scaleY negativos viram flip + valor absoluto', () => {
  canvas.clear();
  const o = makeRect('s-flip', { scaleX: -2, scaleY: 3 });
  canvas.add(o);
  const j = ser(o);
  assert.equal(j.flipX, true);
  assert.equal(j.scaleX, 2);
  assert.ok(!j.flipY); // flipY não deveria ter sido setado (scaleY positivo)
  assert.equal(j.scaleY, 3);
});

test('ser: normaliza src de imagem absoluto de outro host para path relativo', () => {
  canvas.clear();
  const img = new fabric.Image({}, {
    id: 's-img', type: 'image', src: 'http://192.168.0.5:3000/uploads/foto.webp',
  });
  canvas.add(img);
  const j = ser(img);
  assert.equal(j.src, '/uploads/foto.webp');
});

test('serTransform: expõe left/top/scale/angle/zIndex com valores absolutos de escala', () => {
  canvas.clear();
  const o1 = makeRect('t-o1');
  const o2 = makeRect('t-o2', { left: 5, top: 6, scaleX: -1, angle: 45 });
  canvas.add(o1, o2);

  const t = serTransform(o2);
  assert.equal(t.id, 't-o2');
  assert.equal(t.left, 5);
  assert.equal(t.top, 6);
  assert.equal(t.scaleX, 1); // Math.abs(-1)
  assert.equal(t.angle, 45);
  assert.equal(t.zIndex, 1);
});
