// Сетевой бой, сторона гостя: настоящий код игры — гость, тест играет за хоста через брокер в памяти
import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './dom-stub.js';
import './lang-ru.js';
import { FakeClient } from './fake-mqtt.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => dom.byId.get(id);
async function frames(n = 3) { for (let i = 0; i < n; i++) { await wait(30); dom.frame(); } await wait(10); }

const errors = [];
process.on('uncaughtException', e => errors.push(e));
process.on('unhandledRejection', e => errors.push(e));
const sim = await import('../src/sim/index.js');
const { net, NET_CFG } = await import('../src/net/transport.js');
const { setState } = await import('../src/sim/state.js');
const { run } = await import('../src/run.js');
const { TEAM } = await import('../src/config.js');
const { makeSnapshot, newPeerSync } = await import('../src/net/snapshot.js');
await import('../src/main.js');

const P = 'deltav/v4', ROOM = 'QWER';
const host = new FakeClient();
host.subscribe(`${P}/room/${ROOM}/g`);
const toAll = m => host.send(`${P}/room/${ROOM}/h`, { ...m, from: 'host' });
const toGuest = m => host.send(`${P}/room/${ROOM}/h/${net.id}`, { ...m, from: 'host' });
const empty = () => Array.from({ length: TEAM.max * 2 }, () => ({ kind: 'off', owner: '', name: '' }));
let slots, roster;
// снимок, который приготовил бы настоящий хост: состояние хоста строится рядом и не трогает состояние гостя
function hostSnap(edit = () => {}, opts = {}) {
  const mine = sim.S;
  sim.newGame({ mp: true, roster, myId: 0 }); sim.S.bodies = [];
  edit(sim.S);
  const m = JSON.parse(JSON.stringify(makeSnapshot(2, newPeerSync(), { scale: 1, pauseReason: '', ack: 0, say: [], result: '', ...opts })));
  setState(mine);
  return { ...m, ...opts.extra, from: 'host' };
}

test('гость входит по коду и видит состав, который ведёт хост', async () => {
  $('mpToken').value = 'test'; $('mpNick').value = 'Гость'; $('mpCode').value = ROOM.toLowerCase();
  $('mpJoin').click();
  await wait(30);
  assert.equal(net.role, 'guest');
  const join = host.last('join');
  assert.equal(join.nick, 'Гость'); assert.equal(join.from, net.id);
  slots = empty();
  slots[0] = { kind: 'human', owner: 'host', name: 'Хост' };
  slots[5] = { kind: 'human', owner: net.id, name: 'Гость' };
  slots[6] = { kind: 'human', owner: '', name: '' };
  slots[1] = { kind: 'ai', owner: '', name: '' };
  toGuest({ type: 'welcome', hostNick: 'Хост' });
  toAll({ type: 'roster', slots });
  await wait(20);
  assert.equal(net.joined, true);
  assert.equal($('ovBtn').hidden, true, 'бой начинает хост');
  assert.equal($('rosterSize').textContent, '2 на 2');
  const rows = $('roster').children[1].children;
  assert.match(rows[1].children[1].textContent, /Гость \(вы\)/);
  assert.equal(rows[2].children.find(c => c.tagName === 'SELECT'), undefined, 'гость состав не правит');
  rows[2].children.find(c => c.tagName === 'BUTTON').click();
  await wait(20);
  assert.deepEqual([host.last('seat').slot], [6]);
  const blue = $('roster').children[0].children[0];
  assert.equal(rows[0].children.length, 0, 'в своей команде кнопки перехода нет');
  blue.children.find(c => c.textContent === 'Перейти сюда').click();
  await wait(20);
  assert.equal(host.last('team').team, 0);
});

test('старт от хоста: гость получает свой корабль, бой начинается со снимком', async () => {
  roster = [{ team: 0, ctrl: 'human', owner: 'host', name: 'Хост' }, { team: 0, ctrl: 'ai', owner: '', name: '' },
    { team: 1, ctrl: 'human', owner: net.id, name: 'Гость' }, { team: 1, ctrl: 'ai', owner: '', name: '' }];
  toAll({ type: 'start', hostNick: 'Хост', bodies: [], roster });
  await wait(20);
  assert.equal(sim.S.myId, 2);
  assert.equal(run.started, false, 'ждём первый снимок');
  // снимок готовит настоящий хостовый код на копии состояния
  const hostS = sim.S;
  sim.newGame({ mp: true, roster, myId: 0 }); sim.S.bodies = [];
  sim.S.ships[2].fuel = 7777;
  const snap = JSON.parse(JSON.stringify(makeSnapshot(2, newPeerSync(), { scale: 1, pauseReason: '', ack: 0, say: ['Привет'], result: '' })));
  const { setState } = await import('../src/sim/state.js');
  setState(hostS);
  toGuest({ ...snap, from: 'host' });
  await wait(20);
  assert.equal(run.started, true);
  assert.equal($('overlay').hidden, true);
  assert.equal(sim.S.ships[2].fuel, 7777);
  await frames(2);
  assert.equal($('vFuel').textContent, '7777 м/с');
  assert.deepEqual(errors, []);
});

test('приказы гостя уходят хосту с номером', async () => {
  dom.key('KeyW');
  await wait(20);
  const o = host.last('order');
  assert.equal(o.o, 'throttle'); assert.equal(o.val, 1); assert.equal(o.seq, 1);
  assert.equal(sim.S.ships[2].issuedThrottle, 1, 'ползунок сразу показывает приказ');
  dom.key('KeyQ');
  await wait(20);
  const t = host.last('order');
  assert.equal(t.o, 'target'); assert.equal(sim.S.ships[t.val].team, 0);
});

test('гость шлёт пинги со своей скоростью времени', async () => {
  await wait(1000); await frames(1);
  const p = host.last('ping');
  assert.ok(p); assert.equal(p.v, run.chosen); assert.equal(p.auto, true);
});

test('сообщения от хоста всплывают у гостя, невидимый противник не появляется на карте', async () => {
  const before = [...sim.S.ships[0].pos];
  toGuest(hostSnap(h => { h.tracks[2][0].exact = false; h.ships[0].pos = [1, 2]; }, { say: [['msg.enemyLaunched', { name: 'Хост' }]] }));
  await wait(20);
  assert.equal($('toast').textContent, 'Противник Хост пустил торпеду');
  assert.deepEqual(sim.S.ships[0].pos.map(Math.round), before.map(Math.round), 'координаты невидимого противника гость не получил');
  assert.equal(sim.S.ships[0].accG, 0);
  toGuest(hostSnap(h => { h.tracks[2][0].exact = true; h.ships[0].pos = [1, 2]; }));
  await wait(20);
  assert.deepEqual(sim.S.ships[0].pos, [1, 2], 'видимый противник — на своём месте');
});

test('пауза другого игрока: у гостя пауза с именем; P — просьба снять', async () => {
  toGuest(hostSnap(() => {}, { pauseReason: 'other', extra: { pn: 'Хост' } }));
  await wait(20); await frames(1);
  assert.equal(run.paused, true);
  assert.match($('clock').textContent, /пауза: Хост/);
  dom.key('KeyP');
  await wait(20);
  assert.equal(host.last('pause').on, false);
  toGuest(hostSnap());
  await wait(20);
  assert.equal(run.paused, false);
  dom.key('KeyP');
  await wait(20);
  assert.equal(host.last('pause').on, true, 'без паузы P просит поставить её');
});

test('хост замолчал — пауза «нет связи»; снимок пришёл — связь восстановлена', async () => {
  NET_CFG.lostAfter = 150;
  await wait(200); await frames(2);
  assert.equal(net.lost, true);
  assert.equal(run.paused, true);
  assert.match($('clock').textContent, /нет связи/);
  assert.equal($('toast').textContent, 'Нет связи с хостом');
  toGuest(hostSnap());
  await wait(20);
  assert.equal(net.lost, false);
  assert.equal(run.paused, false);
  assert.equal($('toast').textContent, 'Связь с хостом восстановлена');
  NET_CFG.lostAfter = 5000;
});

test('понг от хоста: гость показывает пинг', async () => {
  const p = host.last('ping');
  toGuest({ type: 'pong', ts: p.ts });
  await wait(20); await frames(1);
  assert.ok(net.rtt > 0);
  assert.match($('clock').textContent, /пинг \d+ мс/);
});

test('хост вышел — бой прерван, гость возвращается в меню', async () => {
  toAll({ type: 'leave' });
  await wait(20);
  assert.equal(net.role, null);
  assert.equal(sim.S.result, 'Бой прерван: хост вышел');
  await frames(1); await wait(1900); // окно итога появляется через RESULT_DELAY (session.js)
  assert.equal($('overlay').hidden, false);
  assert.equal($('ovTitle').textContent, 'Бой прерван');
  assert.equal($('ovBtn').hidden, false, 'можно играть одному');
  assert.equal(net.slots[0].owner, 'local');
  assert.deepEqual(errors, []);
});

// войти в комнату ROOM: тест-хост отвечает code ('welcome', 'full', 'busy')
async function joinAs(reply) {
  $('mpCode').value = ROOM; $('mpJoin').click();
  await wait(30);
  if (reply === 'welcome') { toGuest({ type: 'welcome', hostNick: 'Хост' }); slots[5].owner = net.id; toAll({ type: 'roster', slots }); }
  else toGuest({ type: reply });
  await wait(30);
}

test('мест нет — гость остаётся в лобби и видит причину', async () => {
  await joinAs('full');
  assert.equal(net.role, null);
  assert.equal($('mpStatus').textContent, 'Свободных мест в этом бою нет.');
});

test('бой уже идёт — гость остаётся в лобби и видит причину', async () => {
  await joinAs('busy');
  assert.equal(net.role, null);
  assert.equal($('mpStatus').textContent, 'Бой уже идёт, войти можно после его конца.');
});

test('гость сам выходит из боя — поражение, хост получает «leave»', async () => {
  await joinAs('welcome');
  assert.equal(net.joined, true);
  roster[2].owner = net.id;
  toAll({ type: 'start', hostNick: 'Хост', bodies: [], roster });
  await wait(20);
  toGuest(hostSnap());
  await wait(20);
  assert.equal(run.started, true); assert.equal(sim.S.over, false);
  const leaves = host.got('leave').length;
  $('mpLeave').click();
  await wait(20);
  assert.equal(host.got('leave').length, leaves + 1);
  assert.equal(sim.S.result, 'Поражение: вы покинули бой');
  await frames(1); await wait(1900); // окно итога появляется через RESULT_DELAY (session.js)
  assert.equal($('ovTitle').textContent, 'Поражение');
  assert.deepEqual(errors, []);
});
