// Брокер MQTT в памяти вместо flespi: игра получает его как window.mqtt, тест подключает к нему своих «игроков».
// Сообщения доставляются асинхронно, как по сети; retained-сообщения хранятся и отдаются новым подписчикам
// failNext — следующее подключение не удастся с этой ошибкой; connects — сколько раз подключались
export const broker = { clients: new Set(), retained: new Map(), failNext: '', connects: 0 };

const match = (filter, topic) => {
  const f = filter.split('/'), t = topic.split('/');
  return f.length === t.length && f.every((x, i) => x === '+' || x === t[i]);
};
const later = f => setTimeout(f, 0);

export class FakeClient {
  constructor(opts = {}) {
    this.opts = opts; this.handlers = {}; this.subs = []; this.connected = true; this.inbox = [];
    broker.connects++;
    if (broker.failNext) { const e = new Error(broker.failNext); broker.failNext = ''; this.connected = false; later(() => this.emit('error', e)); return; }
    broker.clients.add(this);
    later(() => this.emit('connect'));
  }
  // обрыв связи: брокер рассылает «завещание» клиента (will), как настоящий
  drop() {
    this.end();
    const w = this.opts.will;
    if (w) this.publish(w.topic, w.payload, { retain: w.retain });
  }
  on(e, f) { (this.handlers[e] ||= []).push(f); return this; }
  emit(e, ...a) { for (const f of this.handlers[e] || []) f(...a); }
  subscribe(topics, opts, cb) {
    for (const t of [].concat(topics)) {
      this.subs.push(t);
      for (const [rt, payload] of broker.retained) if (match(t, rt)) later(() => this.deliver(rt, payload));
    }
    if (cb) later(cb);
  }
  deliver(topic, payload) {
    let msg = null;
    try { msg = payload ? JSON.parse(payload) : null; } catch (_) { /* битое сообщение: игре оно уходит как есть */ }
    this.inbox.push({ topic, msg });
    this.emit('message', topic, Buffer.from(payload));
  }
  publish(topic, payload, opts = {}) {
    if (opts.retain) { if (payload === '') broker.retained.delete(topic); else broker.retained.set(topic, payload); }
    for (const c of broker.clients) if (c.connected && c.subs.some(s => match(s, topic))) later(() => c.deliver(topic, payload));
  }
  end() { this.connected = false; broker.clients.delete(this); }
  // для теста: отправить JSON и найти полученные сообщения
  send(topic, m) { this.publish(topic, JSON.stringify(m)); }
  got(type, topic) { return this.inbox.filter(x => x.msg?.type === type && (!topic || x.topic === topic)).map(x => x.msg); }
  last(type, topic) { return this.got(type, topic).at(-1); }
}

globalThis.mqtt = { connect: (url, opts) => new FakeClient(opts) };
