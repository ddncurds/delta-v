// Брокер MQTT для сквозного теста: живёт в главном потоке и пересылает сообщения между потоками-игроками.
// Поддерживает подписки с '+', retained-сообщения и «завещания» при обрыве
import { Worker } from 'node:worker_threads';

const match = (filter, topic) => {
  const f = filter.split('/'), t = topic.split('/');
  return f.length === t.length && f.every((x, i) => x === '+' || x === t[i]);
};

export function startBroker() {
  const conns = new Map();      // `${игрок}:${cid}` → { worker, cid, subs, will }
  const retained = new Map();
  const players = [];
  const route = (topic, payload, retain) => {
    if (retain) { if (payload === '') retained.delete(topic); else retained.set(topic, payload); }
    for (const c of conns.values()) if (c.subs.some(s => match(s, topic))) c.worker.postMessage({ op: 'msg', cid: c.cid, topic, payload });
  };

  // новый игрок; возвращает функцию-команду: await p('click', 'mpHost')
  async function player(name) {
    const worker = new Worker(new URL('./player.js', import.meta.url));
    const idx = players.length;
    let rpc = 0;
    const waiting = new Map();
    await new Promise((ok, fail) => {
      worker.on('error', fail);
      worker.on('message', m => {
        if (m.op === 'ready') return ok();
        if (m.rpc !== undefined) { const w = waiting.get(m.rpc); waiting.delete(m.rpc); return m.ok ? w.ok(m.value) : w.fail(new Error(name + ': ' + m.error)); }
        const key = idx + ':' + m.cid;
        if (m.op === 'connect') { conns.set(key, { worker, cid: m.cid, subs: [], will: m.opts.will }); worker.postMessage({ op: 'connected', cid: m.cid }); }
        else if (m.op === 'sub') {
          const c = conns.get(key);
          if (!c) return;
          c.subs.push(...m.topics);
          for (const [t, p] of retained) if (m.topics.some(s => match(s, t))) worker.postMessage({ op: 'msg', cid: m.cid, topic: t, payload: p });
          worker.postMessage({ op: 'suback', cid: m.cid, ack: m.ack });
        } else if (m.op === 'pub') { if (conns.has(key)) route(m.topic, m.payload, m.retain); }
        else if (m.op === 'end') conns.delete(key);
      });
    });
    const p = (cmd, ...args) => new Promise((ok, fail) => { const id = rpc++; waiting.set(id, { ok, fail }); worker.postMessage({ rpc: id, cmd, args }); });
    p.state = () => p('state');
    // обрыв связи: соединения игрока пропадают, брокер рассылает их «завещания»
    p.drop = async () => {
      for (const [k, c] of [...conns]) if (k.startsWith(idx + ':')) { conns.delete(k); if (c.will) route(c.will.topic, c.will.payload, c.will.retain); }
      await worker.terminate();
    };
    p.worker = worker;
    players.push(p);
    return p;
  }

  return { player, retained, stop: () => Promise.all(players.map(p => p.worker.terminate())) };
}
