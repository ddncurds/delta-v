// Сетевой бой: лобби, хост и гости (до 9). Хост ведёт состав боя и считает симуляцию,
// гости шлют приказы своим кораблям и рисуют снимки. Пустые места людей и корабли ушедших гостей ведёт ИИ
import { SHIP, D2R } from '../config.js';
import { clamp } from '../lib/math.js';
import { S, newGame, issue, resultOf, endBattle, newAi, ORDER_TYPES, ORDER_VAL } from '../sim/index.js';
import { t } from '../i18n.js';
import { run } from '../run.js';
import { $, el } from '../ui/dom.js';
import { say } from '../ui/toast.js';
import { renderRoster } from '../ui/roster-view.js';
import { NET_CFG, net, rid, topic, store, urlToken, connect, netSend } from './transport.js';
import { makeSnapshot, applySnapshot, netBodies, netRoster, newPeerSync, pruneHitLog } from './snapshot.js';
import { defaultSlots, rosterValid, freeHumanSlot, openSeats, moveTo, joinTeam, swapSlots, vacate, setSlotKind, slotsToRoster, netSlots, teamSize, slotTeam, slotOf } from '../roster.js';

export { net, netSend };

// beginBattle приходит из session.js: сеть сама решает, когда начинается бой
const hooks = { beginBattle: () => {} };
const GUEST_ID = /^[A-Z0-9]{12}$/;

// статус сетевого блока: ключ словаря и параметры; при смене языка он переводится заново (rerenderStatus)
let status = { key: '', p: {} };
export function mpStatus(key, p = {}) { status = { key, p }; $('mpStatus').textContent = key ? t(key, p) : ''; }
export const rerenderStatus = () => mpStatus(status.key, status.p);
const sayT = (key, p) => say(t(key, p));
export function netToken() { return urlToken() || NET_CFG.token || $('mpToken').value.trim(); }
function nickVal() {
  const v = ($('mpNick').value.trim() || t('mp.pilot') + ' ' + rid(3)).slice(0, 16);
  store('deltav.nick', v); return v;
}
const netConnect = will => connect(netToken(), will, e => mpStatus('mp.errMqtt', { msg: e.message }));
const inSetup = () => !run.started || S.over;

/* --- лобби --- */
export async function lobbyOpen() {
  mpRender();
  if (net.lobby || net.role || !netToken()) return;
  const gen = ++net.lobbyGen;
  // сообщение о том, почему мы снова в лобби («комната не отвечает», «хост вышел»), не затираем
  net.lobby = 'pending'; net.rooms.clear();
  if (!status.key || status.key === 'mp.needToken') mpStatus('mp.connecting');
  let c;
  try { c = await netConnect(); } catch (e) { if (gen === net.lobbyGen) { net.lobby = null; mpStatus('mp.noBroker', { msg: e.message }); } return; }
  if (gen !== net.lobbyGen) { c.end(true); return; }
  net.lobby = c;
  if (status.key === 'mp.connecting') mpStatus('');
  c.on('message', (t, buf) => {
    const code = t.split('/').pop();
    if (!buf.length) net.rooms.delete(code);
    else try { const r = JSON.parse(buf.toString()); if (Date.now() - r.created < 15 * 60e3) net.rooms.set(code, r); } catch (_) {}
    renderRooms();
  });
  c.subscribe(topic('lobby', '+'), { qos: 1 }, () => renderRooms());
}

// список комнат заново: например, после смены языка
export const rerenderRooms = () => renderRooms();

export function lobbyClose() {
  net.lobbyGen++;
  if (net.lobby && net.lobby !== 'pending') net.lobby.end(true);
  net.lobby = null; net.rooms.clear(); renderRooms();
}

function renderRooms() {
  const box = $('mpRooms');
  box.textContent = '';
  if (!net.lobby || net.lobby === 'pending') return;
  if (!net.rooms.size) { const s = document.createElement('span'); s.className = 'small'; s.textContent = t('mp.noRooms'); box.append(s); return; }
  for (const [code, r] of net.rooms) {
    const b = document.createElement('button'), n = document.createElement('span'), k = document.createElement('b');
    const size = Array.isArray(r.size) && r.size.every(Number.isInteger) ? ', ' + t('r.size', { a: r.size[0], b: r.size[1] }) : '';
    n.textContent = t('mp.roomAt', { name: String(r.name || t('mp.unnamed')).slice(0, 16) }) + (r.free ? t('mp.free', { n: r.free | 0 }) : '') + size;
    k.textContent = code;
    b.append(n, k); b.onclick = () => guestJoin(code); box.append(b);
  }
}

// сетевой блок оверлея, кнопка старта и состав боя
export function mpRender() {
  const inMp = !!net.role;
  $('mpMenu').hidden = inMp;
  $('mpTokRow').hidden = inMp || !!(urlToken() || NET_CFG.token);
  $('mpLink').hidden = !(net.role === 'host' && inSetup());
  $('mpLeave').hidden = !inMp;
  const btn = $('ovBtn');
  btn.hidden = net.role === 'guest' || !inSetup();
  btn.disabled = !rosterValid(net.slots);
  btn.textContent = t(S.reported ? 'btn.newBattle' : 'btn.start');
  if (!inMp && !netToken()) mpStatus('mp.needToken');
  rosterRender();
}

// состав: в одиночной игре и у хоста — правка слотов и пересадка людей («Переместить» → «Сюда»),
// у гостя — выбор команды и места; хост проверяет и рассылает итог
function rosterRender() {
  const me = net.role ? net.id : 'local', setup = inSetup(), editable = net.role !== 'guest' && setup;
  if (!editable || !net.slots[net.pick]?.owner) net.pick = -1;
  renderRoster($('roster'), net.slots, { me, editable, humanAllowed: net.role === 'host', canSeat: net.role === 'guest' && setup && net.joined,
    picked: net.pick,
    onKind: (i, kind) => { if (setSlotKind(net.slots, i, kind)) rosterChanged(); },
    onPick: i => { net.pick = net.pick === i ? -1 : i; mpRender(); },
    onPlace: i => { const a = net.pick; net.pick = -1; if (swapSlots(net.slots, a, i)) rosterChanged(); else mpRender(); },
    onSeat: i => netSend({ type: 'seat', slot: i }, 1),
    onTeam: team => netSend({ type: 'team', team }, 1) });
  $('rosterSize').textContent = t('r.size', { a: teamSize(net.slots, 0), b: teamSize(net.slots, 1) });
}

function rosterChanged() {
  if (net.role === 'host') { netSend({ type: 'roster', slots: net.slots }, 1); updateAdvert(); }
  mpRender();
}

/* --- хост --- */
async function hostCreate() {
  if (net.role) return;
  lobbyClose();
  const nick = nickVal();
  Object.assign(net, { role: 'host', room: rid(4), id: 'host', nick, advertised: false });
  net.peers.clear();
  const own = Math.max(0, slotOf(net.slots, 'local'));
  net.slots[own] = { kind: 'human', owner: 'host', name: nick };
  // без мест «Игрок» в комнату никто не войдёт: первое место ИИ (или пустое) в команде напротив отдаём человеку
  if (!openSeats(net.slots)) {
    const other = net.slots.map((x, i) => i).filter(i => slotTeam(i) !== slotTeam(own));
    const i = other.find(j => net.slots[j].kind === 'ai') ?? other.find(j => net.slots[j].kind === 'off');
    if (i !== undefined) net.slots[i] = { kind: 'human', owner: '', name: '' };
  }
  mpRender(); mpStatus('mp.creating');
  const room = net.room;
  let c;
  // если хост пропадёт, брокер сам сотрёт объявление из лобби
  try { c = await netConnect({ topic: topic('lobby', room), payload: '', qos: 1, retain: true }); }
  catch (e) { netReset(); mpStatus('mp.failed', { msg: e.message }); return; }
  if (net.role !== 'host' || net.room !== room) { c.end(true); return; }
  net.client = c;
  c.on('message', (t, buf) => onHostMsg(buf));
  c.subscribe(topic('room', room, 'g'), { qos: 1 });
  updateAdvert();
  history.replaceState(null, '', '#room=' + room);
  mpStatus('mp.opened', { room });
  mpRender();
}

// комната видна в лобби, пока есть свободные места и бой не идёт
function updateAdvert() {
  if (net.role !== 'host' || !net.client) return;
  const want = openSeats(net.slots) > 0 && inSetup();
  if (want) {
    net.advAt = performance.now(); net.advertised = true;
    net.client.publish(topic('lobby', net.room), JSON.stringify({ name: net.nick, created: Date.now(), free: openSeats(net.slots),
      size: [teamSize(net.slots, 0), teamSize(net.slots, 1)] }), { qos: 1, retain: true, properties: { messageExpiryInterval: 600 } });
  } else if (net.advertised) {
    net.advertised = false;
    net.client.publish(topic('lobby', net.room), '', { qos: 1, retain: true });
  }
}

export function hostStart() {
  if (!rosterValid(net.slots)) { mpStatus('mp.needShips'); return; }
  const roster = slotsToRoster(net.slots);
  newGame({ mp: true, roster, myId: roster.findIndex(r => r.owner === 'host') });
  const now = performance.now();
  for (const p of net.peers.values()) Object.assign(p, { ship: S.ships.findIndex(s => s.owner === p.id), sync: newPeerSync(), ack: 0, sayQ: [], lastRx: now, lost: false });
  Object.assign(net, { pauseBy: '', pauseNick: '', pauseReason: 'start', holdUntil: now + 3000, lastSnap: 0 });
  netSend({ type: 'start', hostNick: net.nick, bodies: S.bodies, roster: S.ships.map(s => ({ team: s.team, ctrl: s.ctrl, name: s.name, owner: s.owner })) }, 1);
  updateAdvert();
  hooks.beginBattle((net.peers.size ? t('mp.players', { n: net.peers.size + 1 }) : '') + t('mp.startIn'));
}

// причина паузы у хоста: старт, обрыв связи с кем-то из гостей или пауза, поставленная игроком
export function hostPauseReason(now) {
  if (now < net.holdUntil) return 'start';
  for (const p of net.peers.values()) if (p.lost) return 'link';
  return net.pauseBy ? (net.pauseBy === 'host' ? 'me' : 'other') : '';
}

// причина паузы для гостя p
function pauseFor(p) {
  const r = net.pauseReason;
  return r === 'me' ? 'other' : r === 'other' && net.pauseBy === p.id ? 'me' : r;
}

// самая медленная скорость времени из выбранных людьми: в сети время общее
export function netSpeedLimit() {
  let v = NET_CFG.maxSpeed;
  for (const p of net.peers.values()) v = Math.min(v, p.speed);
  return v;
}

// корабли людей, которые просили замедлять время при угрозе
export function autoSlowShips() {
  const out = [];
  if (el.autoSlow.checked && S.ships[S.myId]) out.push(S.ships[S.myId]);
  if (net.role === 'host') for (const p of net.peers.values()) if (p.auto && S.ships[p.ship]) out.push(S.ships[p.ship]);
  return out;
}

// сообщение экипажу корабля id, которым управляет гость: уйдёт в его следующем снимке ключом [ключ, параметры]
export function queueSay(id, key, params) {
  for (const p of net.peers.values()) if (p.ship === id && p.sayQ.length < 20) p.sayQ.push(params ? [key, params] : [key]);
}

function onHostMsg(buf) {
  let m;
  try { m = JSON.parse(buf.toString()); } catch (_) { return; }
  if (!m || typeof m.from !== 'string' || !GUEST_ID.test(m.from)) return;
  if (m.type === 'join') { onJoin(m); return; }
  const p = net.peers.get(m.from);
  if (!p) return;
  // «завещание» шлёт брокер, а не гость: срок до передачи корабля ИИ считаем от последнего настоящего сообщения
  if (m.type !== 'gone') {
    p.lastRx = performance.now();
    if (p.lost) { p.lost = false; sayT('mp.linkBack', { nick: p.nick }); }
  }
  const s = S.ships[p.ship];
  switch (m.type) {
    case 'order':
      p.ack = Math.max(p.ack, m.seq | 0);
      if (!run.started || S.over || !s || !s.alive || s.owner !== p.id || !ORDER_TYPES.includes(m.o)) break;
      if (ORDER_VAL.includes(m.o) && !Number.isFinite(m.val)) break;
      issue(s.id, m.o, m.o === 'throttle' ? clamp(m.val, 0, SHIP.maxG) : m.val);
      break;
    case 'spread': if (s && Number.isFinite(m.val)) s.spread = clamp(m.val, 2 * D2R, 10 * D2R); break;
    case 'ping': netSend({ type: 'pong', ts: m.ts }, 0, p.id); if (Number.isFinite(m.rtt)) p.rtt = m.rtt; // fallthrough: в пинге есть и скорость
    case 'speed': if (Number.isFinite(m.v)) p.speed = clamp(m.v, 0.5, 30); p.auto = !!m.auto; break;
    case 'pause': if (run.started && !S.over) { net.pauseBy = m.on ? p.id : ''; net.pauseNick = p.nick; } break;
    case 'seat': if (inSetup() && moveTo(net.slots, p.id, m.slot | 0)) rosterChanged(); break;
    case 'team': if (inSetup() && joinTeam(net.slots, p.id, m.team | 0)) rosterChanged(); break;
    case 'gone': if (run.started && !S.over && !p.lost) { p.lost = true; sayT('mp.linkLost', { nick: p.nick }); } break; // обрыв у гостя: пауза, ждём переподключения
    case 'leave': peerLeft(p); break;
  }
}

function onJoin(m) {
  const id = m.from, nick = String(m.nick || t('mp.pilot')).slice(0, 16);
  if (net.peers.has(id)) { netSend({ type: 'welcome', hostNick: net.nick }, 1, id); netSend({ type: 'roster', slots: net.slots }, 1, id); return; }
  if (!inSetup()) { netSend({ type: 'busy' }, 1, id); return; }
  const seat = freeHumanSlot(net.slots);
  if (seat < 0) { netSend({ type: 'full' }, 1, id); return; }
  net.slots[seat] = { kind: 'human', owner: id, name: nick };
  net.peers.set(id, { id, nick, ship: -1, lastRx: performance.now(), ack: 0, lost: false, speed: 1, auto: true, rtt: 0, sync: newPeerSync(), sayQ: [] });
  netSend({ type: 'welcome', hostNick: net.nick }, 1, id);
  sayT('mp.joined', { nick });
  rosterChanged();
}

/* --- гость --- */
export async function guestJoin(code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 4) { mpStatus('mp.badCode'); return; }
  if (net.role) return;
  lobbyClose();
  Object.assign(net, { role: 'guest', room: code, id: rid(12), nick: nickVal(), joined: false, synced: false, seq: 0, hostNick: '' });
  mpRender(); mpStatus('mp.joining', { code });
  const id = net.id;
  let c;
  try { c = await netConnect({ topic: topic('room', code, 'g'), payload: JSON.stringify({ type: 'gone', from: id }), qos: 1 }); }
  catch (e) { netReset(); mpStatus('mp.failed', { msg: e.message }); return; }
  if (net.role !== 'guest' || net.id !== id) { c.end(true); return; }
  net.client = c;
  c.on('message', (t, buf) => onGuestMsg(buf));
  c.subscribe([topic('room', code, 'h'), topic('room', code, 'h', id)], { qos: 1 }, () => netSend({ type: 'join', nick: net.nick }, 1));
  setTimeout(() => {
    if (net.role === 'guest' && net.id === id && !net.joined) { netReset(); mpStatus('mp.noAnswer', { code }); lobbyOpen(); }
  }, NET_CFG.joinTimeout);
}

function onGuestMsg(buf) {
  let m;
  try { m = JSON.parse(buf.toString()); } catch (_) { return; }
  if (!m || m.from !== 'host') return;
  net.lastRx = performance.now();
  if (net.lost) { net.lost = false; if (run.started) sayT('mp.hostBack'); }
  switch (m.type) {
    case 'full': netReset(); mpStatus('mp.full'); lobbyOpen(); break;
    case 'busy': netReset(); mpStatus('mp.busy'); lobbyOpen(); break;
    case 'welcome':
      net.joined = true; net.hostNick = String(m.hostNick || t('mp.hostNick')).slice(0, 16);
      mpStatus('mp.inRoom', { room: net.room, host: net.hostNick });
      mpRender(); break;
    case 'roster': { const sl = netSlots(m.slots); if (sl) { net.slots = sl; mpRender(); } break; }
    case 'start': {
      if (!net.joined) break;
      const roster = netRoster(m.roster), myId = roster ? roster.findIndex(r => r.owner === net.id) : -1;
      if (myId < 0) { mpStatus('mp.notInRoster'); break; }
      net.synced = false; net.seq = 0;
      newGame({ mp: true, guest: true, roster, myId, bodies: netBodies(m.bodies) }); mpStatus('mp.sync');
      break;
    }
    case 'snap': applySnap(m); break;
    case 'pong': net.rtt = performance.now() - m.ts; break;
    case 'leave': hostLeft(); break;
  }
}

function applySnap(m) {
  if (!net.joined || !S.mp) return;
  if (!net.synced) { net.synced = true; hooks.beginBattle(t('mp.begun', { name: S.ships[S.myId].name })); }
  applySnapshot(m, (m.ack | 0) < net.seq);
  // сообщения экипажу приходят ключами: переводим на свой язык
  for (const x of m.say || []) if (Array.isArray(x)) say(t(String(x[0]), x[1] || {}));
  net.snapScale = run.scale = m.sc; net.pauseReason = m.pa || ''; net.pauseNick = m.pn || ''; run.paused = !!m.pa;
}

/* --- общее --- */
export function pauseLabel() {
  if (!S.mp) return t('pause.l');
  const r = net.pauseReason;
  return r === 'start' ? t('pause.start') : r === 'link' ? t('pause.link') : r === 'other' ? t('pause.other', { nick: net.pauseNick || t('pause.player') }) : t('pause.l');
}

// гость ушёл или пропал надолго: его место снова свободно, а корабль в идущем бою берёт ИИ
function peerLeft(p) {
  net.peers.delete(p.id);
  vacate(net.slots, p.id);
  const s = S.ships[p.ship];
  if (run.started && !S.over && s && s.owner === p.id) {
    s.ctrl = 'ai'; s.owner = ''; s.ai = newAi();
    sayT('mp.leftAi', { nick: p.nick, name: s.name });
    for (const q of net.peers.values()) q.sayQ.push(['mp.leftAiShort', { nick: p.nick }]);
  } else sayT('mp.left', { nick: p.nick });
  if (net.pauseBy === p.id) net.pauseBy = '';
  rosterChanged();
}

// хост ушёл: бой прерван
function hostLeft() {
  if (run.started && !S.over) { S.abort = true; endBattle(); }
  netReset(); mpStatus('mp.hostLeft'); lobbyOpen();
}

// в одиночной игре места людей занимает ИИ, место хоста — местный игрок
function localSlots() {
  return net.slots.map(s => s.owner === 'host' ? { kind: 'human', owner: 'local', name: '' } : s.kind === 'human' ? { kind: 'ai', owner: '', name: '' } : { ...s, owner: '' });
}

function netReset() {
  if (net.role === 'host' && net.advertised && net.client) net.client.publish(topic('lobby', net.room), '', { qos: 1, retain: true });
  const c = net.client;
  net.client = null;
  if (c) c.end(false);
  net.slots = net.role === 'guest' ? defaultSlots() : localSlots();
  net.peers.clear();
  Object.assign(net, { role: null, joined: false, synced: false, lost: false, advertised: false, pauseBy: '', pauseReason: '' });
  if (location.hash.startsWith('#room=')) history.replaceState(null, '', location.pathname + location.search);
  mpRender();
}

function netLeave() {
  if (!net.role) return;
  netSend({ type: 'leave' }, 1);
  if (run.started && !S.over) { S.forfeit = S.myId; endBattle(); }
  netReset(); mpStatus(''); lobbyOpen();
}

// раз в кадр: снимки гостям, пинги хосту, контроль обрыва связи
export function netTick(now) {
  if (!net.client) return;
  if (net.role === 'host') {
    if (net.advertised && now - net.advAt > 300e3) updateAdvert();
    if (!run.started) return;
    // бой окончен, а места свободны — снова зовём в лобби
    if (S.over && !net.advertised && openSeats(net.slots) > 0) updateAdvert();
    for (const p of [...net.peers.values()]) {
      if (S.over) break;
      if (!p.lost && now - p.lastRx > NET_CFG.lostAfter) { p.lost = true; sayT('mp.linkLost', { nick: p.nick }); }
      if (p.lost && now - p.lastRx > NET_CFG.dropAfter) peerLeft(p);
    }
    if (now - net.lastSnap >= (S.over || run.paused ? 500 : 100)) {
      net.lastSnap = now;
      for (const p of net.peers.values()) {
        if (!S.ships[p.ship]) continue;
        const m = makeSnapshot(p.ship, p.sync, { scale: run.scale, pauseReason: pauseFor(p), ack: p.ack, say: p.sayQ.splice(0), result: S.over ? resultOf(p.ship) : null });
        if (m.pa === 'other') m.pn = net.pauseBy === 'host' ? net.nick : net.pauseNick;
        netSend(m, 0, p.id);
      }
      pruneHitLog(Math.min(S.hitSeq, ...[...net.peers.values()].map(p => p.sync.hitSeq)));
    }
  } else if (net.joined) {
    if (now - net.lastPing >= 1000) { net.lastPing = now; netSend({ type: 'ping', ts: now, rtt: Math.round(net.rtt), v: run.chosen, auto: el.autoSlow.checked }); }
    if (run.started && !S.over) {
      if (!net.lost && now - net.lastRx > NET_CFG.lostAfter) { net.lost = true; run.paused = true; net.pauseReason = 'link'; sayT('mp.hostLost'); }
      if (net.lost && now - net.lastRx > NET_CFG.dropAfter) hostLeft();
    }
  }
}

export function initMultiplayer(h) {
  Object.assign(hooks, h);
  net.slots = defaultSlots();
  $('mpHost').onclick = hostCreate;
  $('mpJoin').onclick = () => guestJoin($('mpCode').value);
  $('mpCode').addEventListener('keydown', e => { if (e.key === 'Enter') guestJoin($('mpCode').value); });
  $('mpLeave').onclick = netLeave;
  $('mpToken').addEventListener('change', () => { store('deltav.token', $('mpToken').value.trim()); lobbyClose(); lobbyOpen(); });
  $('mpLink').onclick = () => {
    const link = location.origin + location.pathname + location.search + '#room=' + net.room;
    navigator.clipboard.writeText(link).then(() => mpStatus('mp.copied', { link }), () => mpStatus('mp.linkIs', { link }));
  };
  addEventListener('pagehide', () => { if (net.role) netSend({ type: 'leave' }, 1); });
  $('mpNick').value = store('deltav.nick') || '';
  $('mpToken').value = store('deltav.token') || '';
}

// комната из ссылки #room=КОД: входим сразу, если есть токен, иначе открываем лобби
export function joinFromUrl() {
  const h = location.hash.match(/^#room=([A-Za-z0-9]{4})$/);
  if (h) $('mpCode').value = h[1].toUpperCase();
  if (h && netToken()) guestJoin(h[1]); else lobbyOpen();
}
