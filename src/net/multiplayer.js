// Сетевой бой: лобби, хост и гость. Хост считает симуляцию, гость шлёт приказы и рисует снимки состояния
import { SHIP, D2R } from '../config.js';
import { clamp } from '../lib/math.js';
import { S, newGame, issue, resultFor, ORDER_TYPES, ORDER_VAL } from '../sim/index.js';
import { run } from '../run.js';
import { $, el } from '../ui/dom.js';
import { say } from '../ui/toast.js';
import { NET_CFG, net, rid, topic, store, urlToken, connect, netSend } from './transport.js';
import { makeSnapshot, applySnapshot, netBodies } from './snapshot.js';

export { net, netSend };

// beginBattle приходит из session.js: сеть сама решает, когда начинается бой
const hooks = { beginBattle: () => {} };

export const mpStatus = t => { $('mpStatus').textContent = t; };
export function netToken() { return urlToken() || NET_CFG.token || $('mpToken').value.trim(); }
function nickVal() {
  const v = ($('mpNick').value.trim() || 'Пилот ' + rid(3)).slice(0, 16);
  store('deltav.nick', v); return v;
}
const netConnect = will => connect(netToken(), will, e => mpStatus('Ошибка MQTT: ' + e.message));

/* --- лобби --- */
export async function lobbyOpen() {
  mpRender();
  if (net.lobby || net.role || !netToken()) return;
  const gen = ++net.lobbyGen;
  net.lobby = 'pending'; net.rooms.clear(); mpStatus('Подключение к flespi…');
  let c;
  try { c = await netConnect(); } catch (e) { if (gen === net.lobbyGen) { net.lobby = null; mpStatus('Нет связи с flespi: ' + e.message); } return; }
  if (gen !== net.lobbyGen) { c.end(true); return; }
  net.lobby = c; mpStatus('');
  c.on('message', (t, buf) => {
    const code = t.split('/').pop();
    if (!buf.length) net.rooms.delete(code);
    else try { const r = JSON.parse(buf.toString()); if (Date.now() - r.created < 15 * 60e3) net.rooms.set(code, r); } catch (_) {}
    renderRooms();
  });
  c.subscribe(topic('lobby', '+'), { qos: 1 }, () => renderRooms());
}

export function lobbyClose() {
  net.lobbyGen++;
  if (net.lobby && net.lobby !== 'pending') net.lobby.end(true);
  net.lobby = null; net.rooms.clear(); renderRooms();
}

function renderRooms() {
  const box = $('mpRooms');
  box.textContent = '';
  if (!net.lobby || net.lobby === 'pending') return;
  if (!net.rooms.size) { const s = document.createElement('span'); s.className = 'small'; s.textContent = 'Открытых боёв пока нет'; box.append(s); return; }
  for (const [code, r] of net.rooms) {
    const b = document.createElement('button'), n = document.createElement('span'), k = document.createElement('b');
    n.textContent = 'Бой с ' + String(r.name || 'безымянным').slice(0, 16); k.textContent = code;
    b.append(n, k); b.onclick = () => guestJoin(code); box.append(b);
  }
}

// что показать в сетевом блоке оверлея
export function mpRender() {
  const inMp = !!net.role;
  $('mpMenu').hidden = inMp;
  $('mpTokRow').hidden = inMp || !!(urlToken() || NET_CFG.token);
  $('mpLink').hidden = !(net.role === 'host' && !net.peerId);
  $('mpLeave').hidden = !inMp;
  const btn = $('ovBtn');
  btn.hidden = inMp && !((net.role === 'host' ? net.peerId : net.joined) && run.started && S.over);
  btn.textContent = inMp ? 'Реванш' : S.reported ? 'Ещё раз против ИИ' : 'Начать бой против ИИ';
  if (!inMp && !netToken()) mpStatus('Чтобы играть по сети, вставьте токен flespi.');
}

/* --- хост --- */
async function hostCreate() {
  if (net.role) return;
  lobbyClose();
  Object.assign(net, { role: 'host', room: rid(4), id: 'host', nick: nickVal(), peerId: '', peerNick: '' });
  mpRender(); mpStatus('Создаём комнату…');
  const room = net.room;
  let c;
  // если хост пропадёт, брокер сам сотрёт объявление из лобби
  try { c = await netConnect({ topic: topic('lobby', room), payload: '', qos: 1, retain: true }); }
  catch (e) { netReset(); mpStatus('Не удалось подключиться: ' + e.message); return; }
  if (net.role !== 'host' || net.room !== room) { c.end(true); return; }
  net.client = c;
  c.on('message', (t, buf) => onHostMsg(buf));
  c.subscribe(topic('room', room, 'g'), { qos: 1 });
  advertise();
  history.replaceState(null, '', '#room=' + room);
  mpStatus('Комната ' + room + ' открыта. Соперник может выбрать её в списке, ввести код или открыть ссылку.');
  mpRender();
}

function advertise() {
  if (net.role !== 'host' || net.peerId || !net.client) return;
  net.advAt = performance.now();
  net.client.publish(topic('lobby', net.room), JSON.stringify({ name: net.nick, created: Date.now() }),
    { qos: 1, retain: true, properties: { messageExpiryInterval: 600 } });
}
function unadvertise() { if (net.client) net.client.publish(topic('lobby', net.room), '', { qos: 1, retain: true }); }

function hostStart() {
  newGame({ mp: true });
  const now = performance.now();
  Object.assign(net, { ack: 0, pauseBy: '', pauseReason: 'start', lost: false, holdUntil: now + 3000, lastRx: now, lastSnap: 0, sayQ: [], ready: { me: false, foe: false } });
  netSend({ type: 'start', nick: net.nick, bodies: S.bodies }, 1);
  hooks.beginBattle('На связи ' + net.peerNick + '. Бой начнётся через 3 с.');
}

export function requestRematch() {
  if (net.role === 'host') { net.ready.me = true; netSend({ type: 'rematch' }, 1); maybeRematch(); }
  else netSend({ type: 'rematch' }, 1);
  if (net.role) mpStatus('Ждём согласия соперника на реванш…');
}
function maybeRematch() {
  if (net.ready.me && net.ready.foe && net.peerId) hostStart();
  else if (net.ready.foe) mpStatus(net.peerNick + ' хочет реванш.');
}

export function hostPauseReason(now) { return now < net.holdUntil ? 'start' : net.lost ? 'link' : net.pauseBy; }

function onHostMsg(buf) {
  let m;
  try { m = JSON.parse(buf.toString()); } catch (_) { return; }
  if (!m || typeof m.from !== 'string') return;
  if (m.type === 'join') {
    if (net.peerId && m.from !== net.peerId) { netSend({ type: 'full', to: m.from }, 1); return; }
    net.peerId = m.from; net.peerNick = String(m.nick || 'Соперник').slice(0, 16);
    unadvertise(); history.replaceState(null, '', location.pathname + location.search);
    hostStart(); return;
  }
  if (m.from !== net.peerId) return;
  net.lastRx = performance.now();
  if (net.lost && m.type !== 'gone') { net.lost = false; say('Связь с соперником восстановлена'); }
  switch (m.type) {
    case 'order':
      net.ack = Math.max(net.ack, m.seq | 0);
      if (!run.started || S.over || !ORDER_TYPES.includes(m.o)) break;
      if (ORDER_VAL.includes(m.o) && !Number.isFinite(m.val)) break;
      issue('foe', m.o, m.o === 'throttle' ? clamp(m.val, 0, SHIP.maxG) : m.val);
      break;
    case 'spread': if (Number.isFinite(m.val)) S.foe.spread = clamp(m.val, 2 * D2R, 10 * D2R); break;
    case 'ping': netSend({ type: 'pong', ts: m.ts }); if (Number.isFinite(m.rtt)) net.rtt = m.rtt; // fallthrough: в пинге есть и скорость
    case 'speed': if (Number.isFinite(m.v)) net.peerSpeed = clamp(m.v, 0.5, 30); net.peerAuto = !!m.auto; break;
    case 'pause': if (run.started && !S.over) net.pauseBy = m.on ? 'foe' : ''; break;
    case 'rematch': net.ready.foe = true; maybeRematch(); break;
    case 'gone': net.lastRx = performance.now() - 5001; break; // обрыв связи у гостя: пауза, ждём переподключения
    case 'leave': peerLeft(); break;
  }
}

/* --- гость --- */
export async function guestJoin(code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 4) { mpStatus('Код комнаты — 4 символа'); return; }
  if (net.role) return;
  lobbyClose();
  Object.assign(net, { role: 'guest', room: code, id: rid(12), nick: nickVal(), joined: false, synced: false, seq: 0, peerId: '', peerNick: '' });
  mpRender(); mpStatus('Подключение к комнате ' + code + '…');
  const id = net.id;
  let c;
  try { c = await netConnect({ topic: topic('room', code, 'g'), payload: JSON.stringify({ type: 'gone', from: id }), qos: 1 }); }
  catch (e) { netReset(); mpStatus('Не удалось подключиться: ' + e.message); return; }
  if (net.role !== 'guest' || net.id !== id) { c.end(true); return; }
  net.client = c;
  c.on('message', (t, buf) => onGuestMsg(buf));
  c.subscribe(topic('room', code, 'h'), { qos: 1 }, () => netSend({ type: 'join', nick: net.nick }, 1));
  setTimeout(() => {
    if (net.role === 'guest' && net.id === id && !net.joined) { netReset(); mpStatus('Комната ' + code + ' не отвечает.'); lobbyOpen(); }
  }, 8000);
}

function onGuestMsg(buf) {
  let m;
  try { m = JSON.parse(buf.toString()); } catch (_) { return; }
  if (!m || (m.to && m.to !== net.id)) return;
  net.lastRx = performance.now();
  if (net.lost) { net.lost = false; if (run.started) say('Связь с хостом восстановлена'); }
  switch (m.type) {
    case 'full': netReset(); mpStatus('Комната уже занята.'); lobbyOpen(); break;
    case 'start':
      net.joined = true; net.synced = false; net.seq = 0; net.peerNick = String(m.nick || 'Соперник').slice(0, 16);
      newGame({ mp: true, bodies: netBodies(m.bodies) }); mpStatus('Синхронизация…');
      break;
    case 'snap': applySnap(m); break;
    case 'pong': net.rtt = performance.now() - m.ts; break;
    case 'rematch': mpStatus(net.peerNick + ' хочет реванш.'); break;
    case 'leave': peerLeft(); break;
  }
}

function applySnap(m) {
  if (!net.joined) return;
  if (!net.synced) { net.synced = true; hooks.beginBattle('Бой с ' + net.peerNick + ' начался. Оба корабля уже в движении.'); }
  applySnapshot(m, (m.ack | 0) < net.seq);
  for (const txt of m.say) say(txt);
  net.snapScale = run.scale = m.sc; net.pauseReason = m.pa || ''; run.paused = !!m.pa;
}

/* --- общее --- */
export function pauseLabel() {
  if (!S.mp) return 'пауза';
  return { start: 'старт', link: 'нет связи', foe: 'пауза соперника' }[net.pauseReason] || 'пауза';
}

// соперник ушёл или пропал надолго: техническая победа
function peerLeft() {
  if (run.started && !S.over) { S.forfeit = 'foe'; S.over = true; S.result = resultFor('me'); }
  if (net.role === 'host') {
    net.peerId = ''; net.lost = false; net.ready = { me: false, foe: false };
    advertise(); history.replaceState(null, '', '#room=' + net.room);
    mpStatus('Соперник вышел. Комната ' + net.room + ' снова открыта.');
    mpRender();
  } else { netReset(); mpStatus('Хост вышел из игры.'); lobbyOpen(); }
}

function netReset() {
  const c = net.client;
  net.client = null;
  if (c) c.end(false);
  Object.assign(net, { role: null, peerId: '', joined: false, synced: false, lost: false, pauseBy: '', pauseReason: '' });
  if (location.hash.startsWith('#room=')) history.replaceState(null, '', location.pathname + location.search);
  mpRender();
}

function netLeave() {
  if (!net.role) return;
  if (net.role === 'host' && !net.peerId) unadvertise();
  else netSend({ type: 'leave' }, 1);
  if (run.started && !S.over) { S.forfeit = 'me'; S.over = true; S.result = resultFor('me'); }
  netReset(); mpStatus(''); lobbyOpen();
}

// раз в кадр: снимки гостю, пинги хосту, контроль обрыва связи
export function netTick(now) {
  if (!net.client) return;
  if (net.role === 'host') {
    if (!net.peerId) { if (now - net.advAt > 300e3) advertise(); return; }
    if (!run.started) return;
    if (!S.over && !net.lost && now - net.lastRx > 5000) { net.lost = true; say('Нет связи с соперником, бой на паузе'); }
    if (net.lost && !S.over && now - net.lastRx > 60000) { peerLeft(); return; }
    if (now - net.lastSnap >= (S.over || run.paused ? 500 : 100)) {
      net.lastSnap = now;
      netSend(makeSnapshot({ scale: run.scale, pauseReason: net.pauseReason, ack: net.ack, say: net.sayQ.splice(0), result: S.over ? resultFor('foe') : '' }));
    }
  } else if (net.joined) {
    if (now - net.lastPing >= 1000) { net.lastPing = now; netSend({ type: 'ping', ts: now, rtt: Math.round(net.rtt), v: run.chosen, auto: el.autoSlow.checked }); }
    if (run.started && !S.over) {
      if (!net.lost && now - net.lastRx > 5000) { net.lost = true; run.paused = true; net.pauseReason = 'link'; say('Нет связи с хостом'); }
      if (net.lost && now - net.lastRx > 60000) peerLeft();
    }
  }
}

export function initMultiplayer(h) {
  Object.assign(hooks, h);
  $('mpHost').onclick = hostCreate;
  $('mpJoin').onclick = () => guestJoin($('mpCode').value);
  $('mpCode').addEventListener('keydown', e => { if (e.key === 'Enter') guestJoin($('mpCode').value); });
  $('mpLeave').onclick = netLeave;
  $('mpToken').addEventListener('change', () => { store('deltav.token', $('mpToken').value.trim()); lobbyClose(); lobbyOpen(); });
  $('mpLink').onclick = () => {
    const link = location.origin + location.pathname + location.search + '#room=' + net.room;
    navigator.clipboard.writeText(link).then(() => mpStatus('Ссылка скопирована: ' + link), () => mpStatus('Ссылка: ' + link));
  };
  addEventListener('pagehide', () => { if (net.role === 'guest' || net.peerId) netSend({ type: 'leave' }, 1); });
  $('mpNick').value = store('deltav.nick') || '';
  $('mpToken').value = store('deltav.token') || '';
}

// комната из ссылки #room=КОД: входим сразу, если есть токен, иначе открываем лобби
export function joinFromUrl() {
  const h = location.hash.match(/^#room=([A-Za-z0-9]{4})$/);
  if (h) $('mpCode').value = h[1].toUpperCase();
  if (h && netToken()) guestJoin(h[1]); else lobbyOpen();
}
