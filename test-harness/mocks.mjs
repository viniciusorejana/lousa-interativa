// Mocks mínimos pra permitir que o grafo de módulos do board-app.js seja
// IMPORTADO (avaliação de nível superior) sem lançar erro, fora de um
// navegador real. Não simula comportamento funcional completo — só o
// suficiente pra pegar bugs de TDZ/ordem de avaliação em imports circulares,
// e ReferenceError de identificador faltando na ponte window.*.
import { EventEmitter } from 'events';

globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'http://localhost:3000', pathname: '/board.html', search: '' };

// --- fabric mock ---
class FakeFabricObject extends EventEmitter {
  constructor(opts) { super(); Object.assign(this, opts); }
  set() { return this; }
  setCoords() { return this; }
  get() { return undefined; }
  remove() {}
}
// fabric.Path tem assinatura (pathString, opts) — diferente dos outros
// construtores fabric.* usados aqui, que recebem só (opts).
class FakePath extends FakeFabricObject {
  constructor(path, opts) { super(opts); this.path = path; }
}
class FakeCanvas extends EventEmitter {
  constructor() {
    super();
    this._objects = [];
    this.wrapperEl = new FakeElement();
    this.upperCanvasEl = new FakeElement();
    this.lowerCanvasEl = new FakeElement();
  }
  setWidth() {} setHeight() {} renderAll() {} requestRenderAll() {}
  getObjects() { return this._objects; }
  add(...objs) { this._objects.push(...objs); } remove() {} bringToFront() {} sendToBack() {}
  getPointer() { return { x: 0, y: 0 }; }
  getActiveObject() { return null; }
  getActiveObjects() { return []; }
  discardActiveObject() {} setActiveObject() {}
  getZoom() { return 1; }
  clear() { this._objects = []; }
  setViewportTransform() {}
  moveTo() {}
  viewportTransform = [1, 0, 0, 1, 0, 0];
}
globalThis.fabric = {
  Canvas: FakeCanvas,
  Rect: FakeFabricObject,
  Text: FakeFabricObject,
  Textbox: FakeFabricObject,
  Circle: FakeFabricObject,
  Line: FakeFabricObject,
  Path: FakePath,
  Group: Object.assign(FakeFabricObject, {
    fromObject: (obj, cb) => cb(new FakeFabricObject(obj)),
  }),
  Image: Object.assign(function (el, opts) { return new FakeFabricObject(opts); }, {
    fromURL: (url, cb) => cb(new FakeFabricObject({})),
    fromObject: (obj, cb) => cb(new FakeFabricObject(obj)),
  }),
  util: { enlivenObjects: (objs, cb) => cb([]) },
};

// --- socket.io-client mock ---
function fakeIo() {
  const emitter = new EventEmitter();
  emitter.emit_original = emitter.emit.bind(emitter);
  emitter.volatile = emitter;
  emitter.broadcast = { to: () => emitter, volatile: emitter };
  emitter.to = () => emitter;
  return emitter;
}
globalThis.io = fakeIo;

// --- LB (shared/socket-client.js equivalente) ---
// Guarda a última instância criada em globalThis.__testSocket — o teste usa
// isso pra DISPARAR eventos (board:init, etc.) depois de importar o grafo,
// simulando o que o servidor mandaria. Pega bugs que só aparecem dentro de
// handlers de evento (ex: referenciar uma variável que devia ter sido
// importada de outro módulo, mas não foi) — o teste de importação sozinho só
// pega o que roda no nível superior do módulo.
globalThis.LB = { createSocket: () => { const s = fakeIo(); globalThis.__testSocket = s; return s; } };

// --- DOM mock mínimo ---
class FakeElement {
  constructor() {
    this.style = {}; this.dataset = {}; this.classList = { add(){}, remove(){}, toggle(){}, contains(){return false;} };
    this.children = []; this._listeners = {};
  }
  addEventListener(ev, fn) { (this._listeners[ev] ||= []).push(fn); }
  removeEventListener() {}
  appendChild(child) { this.children.push(child); return child; }
  removeChild() {}
  remove() {}
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  setAttribute() {} getAttribute() { return null; }
  get textContent() { return this._text || ''; } set textContent(v) { this._text = v; }
  get innerHTML() { return this._html || ''; } set innerHTML(v) { this._html = v; }
  focus() {} click() {} select() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
}
globalThis.document = {
  createElement: () => new FakeElement(),
  getElementById: () => new FakeElement(),
  querySelector: () => new FakeElement(),
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: new FakeElement(),
  head: new FakeElement(),
};

// --- storage mocks ---
function makeStorage() {
  const data = new Map();
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
  };
}
globalThis.localStorage = makeStorage();
globalThis.sessionStorage = makeStorage();

// --- Worker mock (gif.worker.js) ---
globalThis.Worker = class { postMessage() {} terminate() {} };

// --- Image mock ---
globalThis.Image = class extends EventEmitter {
  set src(v) { this._src = v; }
  get src() { return this._src; }
};

// --- outros globais de browser usados soltos pelo código ---
globalThis.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = () => {};
globalThis.fetch = () => Promise.resolve({ ok: true, blob: () => Promise.resolve() });
globalThis.alert = () => {};
globalThis.confirm = () => true;
globalThis.prompt = () => null;
// crypto: Node já expõe um globalThis.crypto nativo com randomUUID, não precisa mockar.
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: () => Promise.resolve(), write: () => Promise.resolve() } },
  configurable: true,
});
