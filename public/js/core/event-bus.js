// ─── Pub/Sub simples (Observer pattern) ───────────────────────────────────────
// Ainda sem consumidores nesta fase — a extração de features (Fase 4/5) vai
// usar isso pra desacoplar toolbar ⇄ canvas ⇄ socket, que hoje se chamam
// direto (acoplamento circular). Criado agora, junto do resto do core, porque
// faz parte da mesma "camada" arquitetural.
class EventBus {
  constructor() { this._listeners = new Map(); }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler); // retorna unsubscribe, conveniente em callbacks
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (set) set.delete(handler);
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    // Copia pra array: um handler pode se desinscrever durante o próprio emit
    // (ex: um listener "once"-like chamando off()) sem corromper a iteração.
    [...set].forEach(fn => fn(payload));
  }
}

export const eventBus = new EventBus();
