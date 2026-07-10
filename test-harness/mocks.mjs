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
  set(opts) { if (opts) Object.assign(this, opts); return this; }
  setCoords() { return this; }
  get(key) { return this[key]; }
  remove() {}
  // Mimetiza fabric.Object#toJSON: sempre inclui um conjunto básico de
  // propriedades + as extras passadas (mesma assinatura usada por ser() em
  // core/serialization.js). Necessário pra qualquer teste que serialize um
  // objeto mockado (ser/serTransform/group-service etc).
  toJSON(extraProps = []) {
    const base = ['type', 'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle', 'opacity', 'fill', 'stroke', 'strokeWidth', 'flipX', 'flipY', 'src'];
    const out = {};
    [...base, ...extraProps].forEach(k => { if (this[k] !== undefined) out[k] = this[k]; });
    return out;
  }
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
  add(...objs) { this._objects.push(...objs); }
  remove(...objs) { objs.forEach(o => { const i = this._objects.indexOf(o); if (i !== -1) this._objects.splice(i, 1); }); }
  bringToFront() {} sendToBack() {}
  getPointer() { return { x: 0, y: 0 }; }
  // Rastreia seleção de verdade (não só stub) — necessário pra testar código
  // que lê getActiveObject()/getActiveObjects() (ex: group-service.js).
  getActiveObject() { return this._active || null; }
  getActiveObjects() { return this._activeObjects || []; }
  setActiveObject(obj) {
    this._active = obj;
    this._activeObjects = (obj && obj.type === 'activeSelection' && obj._objects) ? obj._objects : (obj ? [obj] : []);
  }
  discardActiveObject() { this._active = null; this._activeObjects = []; }
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
  createDocumentFragment: () => new FakeElement(),
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
