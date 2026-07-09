const test = require('node:test');
const assert = require('node:assert/strict');

const { slugify } = require('../../../server/utils/slugify');

test('slugify: minúsculas e espaços viram hífens', () => {
  assert.equal(slugify('Lousa 1'), 'lousa-1');
});

test('slugify: remove acentos', () => {
  assert.equal(slugify('Reunião de Sábado'), 'reuniao-de-sabado');
});

test('slugify: remove caracteres especiais', () => {
  assert.equal(slugify('Minha Lousa!!'), 'minha-lousa');
});

test('slugify: colapsa hífens duplicados e remove das pontas', () => {
  assert.equal(slugify('  -- sala   teste -- '), 'sala-teste');
});

test('slugify: string vazia ou só símbolos cai no fallback "sala"', () => {
  assert.equal(slugify(''), 'sala');
  assert.equal(slugify('!!!'), 'sala');
});

test('slugify: undefined/null não lança e cai no fallback', () => {
  assert.equal(slugify(undefined), 'sala');
  assert.equal(slugify(null), 'sala');
});
