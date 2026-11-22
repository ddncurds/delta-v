// Сетевой бой, сторона хоста: настоящий код игры — хост, тест играет за гостей через брокер в памяти
import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './dom-stub.js';
import './lang-ru.js';
import { FakeClient, broker } from './fake-mqtt.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => dom.byId.get(id);
// кадры игры; после каждого ждём, пока брокер доставит сообщения (снимки уходят раз в 100 мс)
async function frames(n = 3) { for (let i = 0; i < n; i++) { await wait(30); dom.frame(); } await wait(10); }

const errors = [];
process.on('uncaughtException', e => errors.push(e));
process.on('unhandledRejection', e => errors.push(e));
const sim = await import('../src/sim/index.js');
const { net, NET_CFG } = await import('../src/net/transport.js');
const mp = await import('../src/net/multiplayer.js');
const { SHIP, D2R } = await import('../src/config.js');
const { t } = await import('../src/i18n.js');
const { run } = await import('../src/run.js');
await import('../src/main.js');

const P = 'deltav/v4';
// гость из теста: подписан на общий топик и на свой
function guest(id, nick) {
  // как настоящий гость: «завещание» на случай обрыва
  const c = new FakeClient({ will: { topic: `${P}/room/${net.room}/g`, payload: JSON.stringify({ type: 'gone', from: id }), qos: 1 } });
  c.id = id;
  c.subscribe([`${P}/room/${net.room}/h`, `${P}/room/${net.room}/h/${id}`]);
  c.say = m => c.send(`${P}/room/${net.room}/g`, { ...m, from: id });
  c.join = () => c.say({ type: 'join', nick });
  c.mine = t => `${P}/room/${net.room}/h/${id}`;
  return c;
}
const slotSelect = (team, i) => $('roster').children[team].children[1 + i].children.find(c => c.tagName === 'SELECT');
const G1 = 'AAAAAAAAAAAA', G2 = 'BBBBBBBBBBBB', G3 = 'CCCCCCCCCCCC';
let g1, g2;

test('хост создаёт комнату из дуэли по умолчанию: место противника отдаётся человеку, комната видна в лобби', async () => {
  $('mpToken').value = 'test'; $('mpNick').value = 'Хост';
  $('mpHost').click();
  await wait(20);
  assert.equal(net.role, 'host');
  assert.match(net.room, /^[A-Z0-9]{4}$/);
  assert.equal(net.slots[0].owner, 'host');
  assert.equal(net.slots[5].kind, 'human', 'ИИ-противник стал местом для игрока');
  const ad = JSON.parse(broker.retained.get(`${P}/lobby/${net.room}`));
  assert.equal(ad.free, 1); assert.deepEqual(ad.size, [1, 1]);
});

test('места «Игрок» добавляются в составе, объявление обновляется', async () => {
  for (const [t, i, k] of [[1, 1, 'human'], [0, 1, 'ai']]) { const s = slotSelect(t, i); s.value = k; s.onchange(); }
  const ad = JSON.parse(broker.retained.get(`${P}/lobby/${net.room}`));
  assert.equal(ad.free, 2);
  assert.deepEqual(ad.size, [2, 2]);
});

test('гости садятся на свободные места, лишнему — отказ', async () => {
  g1 = guest(G1, 'Первый'); g2 = guest(G2, 'Второй');
  await wait(10);
  g1.join(); await wait(10); g2.join(); await wait(20);
  assert.ok(g1.last('welcome', g1.mine()));
  assert.equal(net.slots[5].owner, G1); assert.equal(net.slots[6].owner, G2);
  assert.equal(net.slots[6].name, 'Второй');
  const r = g2.last('roster');
  assert.equal(r.slots[5].owner, G1, 'состав разослан всем');
  assert.equal(broker.retained.has(`${P}/lobby/${net.room}`), false, 'мест нет — объявление снято');
  const g3 = guest(G3, 'Третий'); await wait(10); g3.join(); await wait(20);
  assert.ok(g3.last('full'));
  g3.end();
});

const row = (team, i) => $('roster').children[team].children[1 + i];
const btn = (el, text) => el.children.find(c => c.tagName === 'BUTTON' && c.textContent === text);

test('гость сам переходит в другую команду — на место ИИ, ИИ уходит на его место', async () => {
  g1.say({ type: 'team', team: 0 });
  await wait(20);
  assert.equal(net.slots[1].owner, G1);
  assert.equal(net.slots[5].kind, 'ai');
  assert.equal(g2.last('roster').slots[1].owner, G1, 'новый состав разослан');
  g1.say({ type: 'team', team: 7 }); g1.say({ type: 'seat', slot: 0 });
  await wait(20);
  assert.equal(net.slots[1].owner, G1, 'в несуществующую команду и на место хоста не пересесть');
});

test('хост пересаживает гостя: «Переместить», затем «Сюда»', async () => {
  btn(row(0, 1), 'Переместить').click();
  assert.equal(net.pick, 1);
  assert.ok(btn(row(0, 0), 'Сюда'), 'можно поменять местами и с хостом');
  btn(row(1, 0), 'Сюда').click();
  await wait(20);
  assert.equal(net.slots[5].owner, G1);
  assert.equal(net.slots[1].kind, 'ai');
  assert.equal(net.pick, -1);
  assert.equal(g1.last('roster').slots[5].owner, G1);
});

test('хост может сам перейти в другую команду и вернуться', async () => {
  btn(row(0, 0), 'Переместить').click();
  btn(row(1, 1), 'Сюда').click();
  assert.equal(net.slots[6].owner, 'host'); assert.equal(net.slots[0].owner, G2);
  btn(row(1, 1), 'Переместить').click();
  btn(row(0, 0), 'Сюда').click();
  assert.equal(net.slots[0].owner, 'host'); assert.equal(net.slots[6].owner, G2);
});

test('хост начинает бой: каждый гость получает свой корабль и свой снимок', async () => {
  $('ovBtn').click();
  await wait(20);
  const st = g1.last('start');
  assert.equal(st.roster.length, 4);
  assert.deepEqual(st.roster.map(r => r.owner), ['host', '', G1, G2]);
  assert.equal(sim.S.ships[2].ctrl, 'human'); assert.equal(sim.S.ships[2].ai, null);
  assert.equal(sim.S.ships[1].ctrl, 'ai'); assert.ok(sim.S.ships[1].ai);
  net.holdUntil = 0;
  await frames(6);
  const s1 = g1.last('snap', g1.mine()), s2 = g2.last('snap', g2.mine());
  assert.ok(s1 && s2);
  assert.equal(s1.ships[2].fuel, sim.S.ships[2].fuel, 'своё топливо гость видит');
  assert.equal(s1.ships[3].fuel, undefined, 'топливо союзника — нет');
  assert.ok(s1.ships[3].pos, 'союзника видно');
  assert.equal(s1.eye, 2); assert.equal(s2.eye, 3);
  assert.equal(g1.got('snap', `${P}/room/${net.room}/h`).length, 0, 'снимки не уходят в общий топик');
});

test('приказы гостя управляют только его кораблём', async () => {
  g1.say({ type: 'order', seq: 1, o: 'throttle', val: 3 });
  const enemy = sim.S.ships.find(s => s.team === 0 && s.id !== sim.S.ships[2].targetId).id;
  g1.say({ type: 'order', seq: 2, o: 'target', val: enemy });
  await frames(4);
  assert.equal(sim.S.ships[2].cmdThrottle, 3);
  assert.equal(sim.S.ships[2].targetId, enemy);
  assert.equal(sim.S.ships[3].cmdThrottle, 0);
  await wait(120); await frames(1);
  assert.equal(g1.last('snap', g1.mine()).ack, 2);
  g1.say({ type: 'order', seq: 3, o: 'target', val: 3 });
  await frames(2);
  assert.equal(sim.S.ships[2].targetId, enemy, 'союзника целью не выбрать');
});

test('пауза гостя ставит на паузу всех, и все знают, кто её поставил', async () => {
  g1.say({ type: 'pause', on: true });
  await frames(2);
  assert.equal(run.paused, true);
  await wait(600); await frames(1);
  assert.equal(g2.last('snap', g2.mine()).pa, 'other');
  assert.equal(g2.last('snap', g2.mine()).pn, 'Первый');
  assert.equal(g1.last('snap', g1.mine()).pa, 'me');
  g1.say({ type: 'pause', on: false });
  await frames(2);
  assert.equal(run.paused, false);
});

test('мусор в сети не ломает хоста: битый JSON, чужие и поддельные отправители', async () => {
  const topic = `${P}/room/${net.room}/g`;
  g1.publish(topic, '{не json');
  g1.send(topic, { type: 'order', o: 'throttle', val: 8, seq: 99, from: 'host' });
  g1.send(topic, { type: 'order', o: 'throttle', val: 8, seq: 99, from: 'ZZZZZZZZZZZZ' });
  g1.send(topic, { type: 'leave', from: '../../etc' });
  g1.send(topic, null);
  await frames(2);
  assert.equal(sim.S.ships[0].cmdThrottle, 0);
  assert.equal(net.peers.size, 2);
  assert.deepEqual(errors, []);
});

test('приказы гостя проверяются: тяга не больше 8 g, мусорные значения и типы отброшены', async () => {
  g1.say({ type: 'order', seq: 10, o: 'throttle', val: 99 });
  await frames(3);
  assert.equal(sim.S.ships[2].cmdThrottle, SHIP.maxG);
  g1.say({ type: 'order', seq: 11, o: 'throttle', val: null });
  g1.say({ type: 'order', seq: 12, o: 'heading', val: 'x' });
  g1.say({ type: 'order', seq: 13, o: 'selfDestruct', val: 1 });
  await frames(3);
  assert.equal(sim.S.ships[2].cmdThrottle, SHIP.maxG);
  assert.ok(Number.isFinite(sim.S.ships[2].cmdHeading));
  g1.say({ type: 'spread', val: 1 });
  await frames(1);
  assert.equal(sim.S.ships[2].spread, 10 * D2R, 'угол облака ограничен');
  g1.say({ type: 'order', seq: 14, o: 'throttle', val: 0 });
  await frames(3);
});

test('скорость времени в сети — самая медленная из выбранных, ×30 недоступно', async () => {
  assert.equal(dom.speedBtns.filter(b => b.dataset.speed === '30').every(b => b.disabled), true);
  g1.say({ type: 'ping', ts: 1, rtt: 40, v: 3, auto: true });
  g2.say({ type: 'ping', ts: 1, rtt: 40, v: 10, auto: false });
  await frames(1);
  assert.equal(mp.netSpeedLimit(), 3);
  assert.equal(g1.last('pong', g1.mine()).ts, 1, 'на пинг — понг лично гостю');
  dom.speedBtns.find(b => b.dataset.speed === '10').click();
  await frames(10);
  assert.ok(run.scale <= 3.01, `скорость ${run.scale}`);
  const ships = mp.autoSlowShips().map(s => s.id).sort();
  assert.deepEqual(ships, [0, 2], 'замедление при угрозе — для хоста и первого гостя');
  dom.speedBtns.find(b => b.dataset.speed === '1').click();
  g1.say({ type: 'ping', ts: 2, rtt: 40, v: 1, auto: true });
  g2.say({ type: 'ping', ts: 2, rtt: 40, v: 1, auto: true });
  await frames(1);
});

test('гость замолчал — пауза «нет связи» у всех; заговорил — бой продолжается', async () => {
  NET_CFG.lostAfter = 150;
  for (let i = 0; i < 8; i++) { g1.say({ type: 'ping', ts: i, v: 1, auto: true }); await frames(1); }
  assert.equal(run.paused, true);
  assert.equal(mp.pauseLabel(), 'нет связи');
  assert.equal(net.peers.get(G2).lost, true);
  assert.equal(net.peers.get(G1).lost, false);
  await wait(500); await frames(1);
  assert.equal(g1.last('snap', g1.mine()).pa, 'link');
  g2.say({ type: 'ping', ts: 9, v: 1, auto: true });
  g1.say({ type: 'ping', ts: 9, v: 1, auto: true });
  await frames(2);
  assert.equal(run.paused, false);
  NET_CFG.lostAfter = 5000;
});

test('обрыв у гостя: брокер шлёт его «завещание», хост сразу ставит паузу; переподключился — продолжаем', async () => {
  const id = G2;
  g2.drop();
  await frames(2);
  assert.equal(net.peers.get(id).lost, true);
  assert.equal(run.paused, true);
  g2 = guest(id, 'Второй'); await wait(10);
  g2.join();
  await wait(20);
  assert.ok(g2.last('welcome', g2.mine()), 'повторный вход своего гостя — не «бой идёт»');
  assert.ok(g2.last('roster', g2.mine()));
  assert.equal(g2.got('busy').length, 0);
  g2.say({ type: 'ping', ts: 1, v: 1, auto: true });
  await frames(2);
  assert.equal(run.paused, false);
});

test('сообщения экипажу корабля гостя уходят в его снимке', async () => {
  const host = sim.S.ships[0];
  host.targetId = 2; host.torps = 5;
  sim.issue(0, 'torp');
  await frames(4); await wait(120); await frames(1);
  // сообщения уходят ключами — гость переводит их сам
  const said = g1.got('snap', g1.mine()).flatMap(m => m.say).map(([k, p]) => t(k, p));
  assert.ok(said.some(t => /Противник Хост пустил торпеду/.test(t)), said.join(' | '));
  assert.ok(!g2.got('snap', g2.mine()).flatMap(m => m.say).some(([k]) => k === 'msg.enemyLaunched'), 'чужие сообщения не приходят');
  sim.S.torps = [];
});

test('во время боя новых гостей не пускают', async () => {
  const g = guest('DDDDDDDDDDDD', 'Поздний'); await wait(10); g.join(); await wait(20);
  assert.ok(g.last('busy'));
  g.end();
});

test('гость вышел — его кораблём управляет ИИ, место снова свободно', async () => {
  g2.say({ type: 'leave' });
  await frames(2);
  const s = sim.S.ships[3];
  assert.equal(s.ctrl, 'ai'); assert.ok(s.ai); assert.equal(s.owner, '');
  assert.equal(net.peers.has(G2), false);
  assert.equal(net.slots[6].owner, '');
  assert.equal(sim.S.over, false);
  assert.deepEqual(errors, []);
});

test('бой окончен — каждый гость получает итог глазами своей команды', async () => {
  for (const s of sim.S.ships) if (s.team === 1) s.alive = false;
  await frames(3); await wait(600); await frames(1);
  const last = g1.last('snap', g1.mine());
  assert.equal(last.ov, true);
  assert.deepEqual(last.res, ['res.loss.team'], 'итог — ключом, гость переведёт его на свой язык');
  assert.equal(broker.retained.has(`${P}/lobby/${net.room}`), true, 'после боя свободное место снова в лобби');
  assert.deepEqual(errors, []);
});

test('«Новый бой»: хост начинает заново с теми же гостями', async () => {
  await wait(1000); dom.frame();
  assert.equal($('overlay').hidden, false);
  assert.equal($('ovBtn').hidden, false);
  assert.equal($('ovBtn').textContent, 'Новый бой');
  const starts = g1.got('start').length;
  $('ovBtn').click();
  await wait(20);
  assert.equal(g1.got('start').length, starts + 1);
  const st = g1.last('start');
  assert.deepEqual(st.roster.map(r => r.owner), ['host', '', G1, ''], 'место ушедшего гостя занял ИИ');
  assert.equal(sim.S.over, false);
  assert.equal(net.peers.get(G1).ship, 2);
  net.holdUntil = 0;
  await frames(4);
  assert.equal(g1.last('snap', g1.mine()).ov, undefined, 'новый бой не окончен');
});

test('гость молчит дольше срока — его кораблём управляет ИИ, бой продолжается', async () => {
  NET_CFG.lostAfter = 100; NET_CFG.dropAfter = 600;
  net.peers.get(G1).lastRx = performance.now();   // тишина отсчитывается с этого момента
  await wait(200); await frames(2);
  assert.equal(run.paused, true);
  assert.equal(net.peers.size, 1, 'пока ждём — гость ещё в бою');
  await wait(500); await frames(2);
  const s = sim.S.ships[2];
  assert.equal(s.ctrl, 'ai'); assert.ok(s.ai);
  assert.equal(net.peers.size, 0);
  assert.equal(run.paused, false, 'пропавших больше нет — пауза снята');
  assert.equal(net.slots[5].owner, '');
  NET_CFG.lostAfter = 5000; NET_CFG.dropAfter = 60000;
  assert.deepEqual(errors, []);
});

test('хост выходит — гости узнают об этом, объявление снято', async () => {
  $('mpLeave').click();
  await wait(20);
  assert.ok(g1.last('leave'));
  assert.equal(net.role, null);
  assert.equal(broker.retained.size, 0);
  assert.deepEqual(errors, []);
});
