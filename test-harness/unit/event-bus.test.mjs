// public/js/core/event-bus.js é um pub/sub puro, sem dependências circulares
// nem de browser — não precisa dos mocks do test-harness.
import test from 'node:test';
import assert from 'node:assert/strict';

const { eventBus } = await import('../../public/js/core/event-bus.js');

test('on/emit: handler registrado recebe o payload emitido', () => {
  let received = null;
  eventBus.on('evento-teste-1', payload => { received = payload; });
  eventBus.emit('evento-teste-1', { foo: 'bar' });
  assert.deepEqual(received, { foo: 'bar' });
});

test('emit: múltiplos handlers do mesmo evento são todos chamados', () => {
  let count = 0;
  eventBus.on('evento-teste-2', () => count++);
  eventBus.on('evento-teste-2', () => count++);
  eventBus.emit('evento-teste-2');
  assert.equal(count, 2);
});

test('emit: evento sem nenhum handler registrado não lança', () => {
  assert.doesNotThrow(() => eventBus.emit('evento-sem-handler-nenhum'));
});

test('off: remove um handler específico sem afetar os demais', () => {
  let calledA = 0, calledB = 0;
  const handlerA = () => calledA++;
  eventBus.on('evento-teste-3', handlerA);
  eventBus.on('evento-teste-3', () => calledB++);

  eventBus.off('evento-teste-3', handlerA);
  eventBus.emit('evento-teste-3');

  assert.equal(calledA, 0);
  assert.equal(calledB, 1);
});

test('on: retorna uma função de unsubscribe equivalente a off()', () => {
  let called = 0;
  const unsubscribe = eventBus.on('evento-teste-4', () => called++);
  unsubscribe();
  eventBus.emit('evento-teste-4');
  assert.equal(called, 0);
});

test('emit: um handler pode se desinscrever durante o próprio emit sem corromper a iteração dos demais', () => {
  let calledOther = 0;
  const selfUnsub = eventBus.on('evento-teste-5', () => selfUnsub());
  eventBus.on('evento-teste-5', () => calledOther++);

  eventBus.emit('evento-teste-5');
  eventBus.emit('evento-teste-5'); // segunda vez: o primeiro handler já deveria ter saído

  assert.equal(calledOther, 2);
});
