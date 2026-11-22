// Игрок для сквозного теста: отдельный поток со своей копией игры (свой DOM-заглушка, свой S, своя сеть).
// MQTT здесь — прокси к брокеру в главном потоке (tests/e2e/broker.js). Тест управляет игроком командами (см. CMD)
import { parentPort } from 'node:worker_threads';
import { dom } from '../dom-stub.js';

/* --- MQTT через главный поток --- */
const clients = new Map();
let nextCid = 1;
class RemoteClient {
  constructor(opts) {
    this.cid = nextCid++; this.handlers = {}; this.subCbs = new Map(); this.connected = false;
    clients.set(this.cid, this);
    parentPort.postMessage({ op: 'connect', cid: this.cid, opts: { username: opts.username, will: opts.will } });
  }
  on(e, f) { (this.handlers[e] ||= []).push(f); return this; }
  emit(e, ...a) { for (const f of this.handlers[e] || []) f(...a); }
  subscribe(topics, opts, cb) {
    const ack = Math.random();
    if (cb) this.subCbs.set(ack, cb);
    parentPort.postMessage({ op: 'sub', cid: this.cid, topics: [].concat(topics), ack });
  }
  publish(topic, payload, opts = {}) { parentPort.postMessage({ op: 'pub', cid: this.cid, topic, payload: String(payload), retain: !!opts.retain }); }
  end() { this.connected = false; parentPort.postMessage({ op: 'end', cid: this.cid }); }
}
globalThis.mqtt = { connect: (url, opts) => new RemoteClient(opts) };

const errors = [];
process.on('uncaughtException', e => errors.push(String(e.stack || e)));
process.on('unhandledRejection', e => errors.push(String(e?.stack || e)));

// сценарий проверяет русские тексты
const { setLang } = await import('../../src/i18n.js');
setLang('ru');
const sim = await import('../../src/sim/index.js');
const { net, NET_CFG } = await import('../../src/net/transport.js');
const { run } = await import('../../src/run.js');
await import('../../src/main.js');
// игра крутит кадры сама, как браузер
setInterval(() => dom.frame(), 30);

const $ = id => dom.byId.get(id);
const text = id => $(id).textContent;
const kids = el => el.children || [];
const btn = (el, t) => kids(el).find(c => c.tagName === 'BUTTON' && c.textContent === t);
const row = (team, i) => kids($('roster'))[team].children[1 + i];

/* --- команды теста --- */
const CMD = {
  type: (id, v) => { $(id).value = v; },
  change: (id, v) => { $(id).value = v; $(id).dispatch('change'); },
  click: id => { if ($(id).disabled) throw new Error(id + ' выключена'); $(id).click(); },
  key: code => dom.key(code),
  room: code => {
    const b = kids($('mpRooms')).find(c => c.tagName === 'BUTTON' && c.children[1].textContent === code);
    if (!b) throw new Error('комнаты ' + code + ' нет в списке: ' + text('mpRooms'));
    b.click();
  },
  slot: (team, i, kind) => { const s = kids(row(team, i)).find(c => c.tagName === 'SELECT'); s.value = kind; s.onchange(); },
  slotButton: (team, i, t) => { const b = btn(row(team, i), t); if (!b) throw new Error('нет кнопки ' + t); b.click(); },
  joinTeam: team => btn(kids($('roster'))[team].children[0], 'Перейти сюда').click(),
  netCfg: o => Object.assign(NET_CFG, o),
  skipCountdown: () => { net.holdUntil = 0; },
  killTeam: team => { for (const s of sim.S.ships) if (s.team === team) s.alive = false; },
  state: () => {
    const S = sim.S;
    return {
      errors, role: net.role, room: net.room, id: net.id, joined: net.joined, slots: net.slots,
      rooms: kids($('mpRooms')).filter(c => c.tagName === 'BUTTON').map(c => c.children[1].textContent),
      status: text('mpStatus'), toast: text('toast'), clock: text('clock'),
      overlay: $('overlay').hidden, ovTitle: text('ovTitle'), ovText: text('ovText'),
      ovBtn: { hidden: $('ovBtn').hidden, disabled: $('ovBtn').disabled, text: text('ovBtn') },
      started: run.started, paused: run.paused, over: S.over, result: S.result, myId: S.myId,
      vFuel: text('vFuel'), vTeams: text('vTeams'), vContact: text('vContact'),
      ships: S.ships.map(s => ({ id: s.id, team: s.team, name: s.name, ctrl: s.ctrl, owner: s.owner, alive: s.alive,
        cmdThrottle: s.cmdThrottle, torps: s.torps, fuel: s.fuel, targetId: s.targetId })),
      torps: S.torps.length,
      peers: [...net.peers.values()].map(p => ({ id: p.id, nick: p.nick, lost: p.lost, ago: Math.round(performance.now() - p.lastRx) })),
    };
  },
};

parentPort.on('message', async m => {
  if (m.op === 'msg') { clients.get(m.cid)?.emit('message', m.topic, Buffer.from(m.payload)); return; }
  if (m.op === 'connected') { const c = clients.get(m.cid); if (c) { c.connected = true; c.emit('connect'); } return; }
  if (m.op === 'suback') { const c = clients.get(m.cid), cb = c?.subCbs.get(m.ack); if (cb) { c.subCbs.delete(m.ack); cb(); } return; }
  if (m.rpc === undefined) return;
  try { parentPort.postMessage({ rpc: m.rpc, ok: true, value: await CMD[m.cmd](...(m.args || [])) }); }
  catch (e) { parentPort.postMessage({ rpc: m.rpc, ok: false, error: String(e.message || e) }); }
});
parentPort.postMessage({ op: 'ready' });
