const test = require('node:test');
const assert = require('node:assert/strict');

const { imgFilename, collectImageFilenames } = require('../../../server/utils/files');

test('imgFilename: extrai nome de arquivo de URL absoluta', () => {
  assert.equal(imgFilename('http://localhost:3000/uploads/abc123.webp'), 'abc123.webp');
});

test('imgFilename: extrai nome de arquivo de path relativo', () => {
  assert.equal(imgFilename('/uploads/abc123.webp'), 'abc123.webp');
});

test('imgFilename: retorna null para src vazio/ausente', () => {
  assert.equal(imgFilename(''), null);
  assert.equal(imgFilename(null), null);
  assert.equal(imgFilename(undefined), null);
});

test('imgFilename: retorna null para string que não é URL válida e não contém /uploads/', () => {
  assert.equal(imgFilename('nao-e-uma-url-nem-path'), null);
});

test('collectImageFilenames: coleta src e _gifUrl de um objeto simples', () => {
  const set = new Set();
  collectImageFilenames({ src: '/uploads/a.webp', _gifUrl: '/uploads/b.gif' }, set);
  assert.deepEqual([...set].sort(), ['a.webp', 'b.gif']);
});

test('collectImageFilenames: recursa dentro de objetos de grupo', () => {
  const set = new Set();
  const group = {
    type: 'group',
    objects: [
      { src: '/uploads/child1.webp' },
      { type: 'group', objects: [{ src: '/uploads/nested.webp' }] },
    ],
  };
  collectImageFilenames(group, set);
  assert.deepEqual([...set].sort(), ['child1.webp', 'nested.webp']);
});

test('collectImageFilenames: obj nulo não lança', () => {
  const set = new Set();
  collectImageFilenames(null, set);
  assert.equal(set.size, 0);
});
