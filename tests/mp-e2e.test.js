// Сквозной тест сетевого боя: настоящий хост и два настоящих гостя, каждый — отдельная копия игры в своём потоке.
// Они общаются только через брокер, а тест действует через их интерфейс: поля, кнопки, клавиши
import test from 'node:test';
import assert from 'node:assert/strict';
import './lang-ru.js';
import { startBroker } from './e2e/broker.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
// ждать, пока состояние игрока не станет нужным; на таймауте — понятная ошибка с последним состоянием
async function until(p, cond, what, ms = 4000) {
  const t0 = Date.now();
  let st;
  while (Date.now() - t0 < ms) { st = await p.state(); if (cond(st)) return st; await wait(30); }
  throw new Error('не дождались: ' + what + '\n' + JSON.stringify({ role: st.role, status: st.status, toast: st.toast, clock: st.clock, paused: st.paused, peers: st.peers, errors: st.errors }));
}

const broker = startBroker();
test.after(() => broker.stop());
const host = await broker.player('хост'), anna = await broker.player('Аня'), boris = await broker.player('Борис');
const all = [host, anna, boris];
let room = '';
const shipOf = (st, owner) => st.ships.find(s => s.owner === owner);

test('хост создаёт комнату, гости находят её в лобби', async () => {
  for (const [p, nick] of [[host, 'Хост'], [anna, 'Аня'], [boris, 'Борис']]) { await p('type', 'mpNick', nick); await p('change', 'mpToken', 'tok'); }
  await host('click', 'mpHost');
  room = (await until(host, s => s.room && s.role === 'host', 'комната создана')).room;
  await until(anna, s => s.rooms.includes(room), 'Аня видит комнату');
  await until(boris, s => s.rooms.includes(room), 'Борис видит комнату');
});

test('хост открывает второе место, гости входят из списка комнат', async () => {
  await host('slot', 1, 1, 'human');
  await anna('room', room);
  await until(anna, s => s.joined, 'Аня в комнате');
  await boris('room', room);
  const b = await until(boris, s => s.joined, 'Борис в комнате');
  assert.match(b.status, /Бой начнёт Хост/);
  const h = await until(host, s => s.slots.filter(x => x.owner && x.owner !== 'host').length === 2, 'хост видит двоих');
  assert.deepEqual(h.slots.slice(5, 7).map(x => x.name), ['Аня', 'Борис']);
  const a = await until(anna, s => s.slots[6].name === 'Борис', 'Аня видит Бориса в составе');
  assert.equal(a.ovBtn.hidden, true, 'начать бой может только хост');
});

test('Борис сам переходит к синим, хост добавляет ИИ к красным и пересаживает Аню', async () => {
  await boris('joinTeam', 0);
  const h = await until(host, s => s.slots.slice(0, 5).some(x => x.name === 'Борис'), 'Борис у синих');
  assert.equal(h.slots.slice(5).filter(x => x.kind !== 'off').length, 1, 'у красных осталась одна Аня');
  await host('slot', 1, 2, 'ai');
  // хост меняет местами себя и Аню: хост к красным, Аня к синим — и обратно
  const hostSlot = h.slots.findIndex(x => x.owner === 'host');
  await host('slotButton', 0, hostSlot, 'Переместить');
  await host('slotButton', 1, 0, 'Сюда');
  await until(anna, s => s.slots.slice(0, 5).some(x => x.name === 'Аня'), 'Аня видит себя у синих');
  await host('slotButton', 1, 0, 'Переместить');
  await host('slotButton', 0, hostSlot, 'Сюда');
  const a = await until(anna, s => s.slots[5].name === 'Аня', 'Аня снова у красных');
  assert.deepEqual([a.slots.slice(0, 5), a.slots.slice(5)].map(t => t.filter(x => x.kind !== 'off').length), [2, 2]);
});

test('хост начинает бой 2 на 2: у каждого гостя свой корабль и своя команда', async () => {
  await host('click', 'ovBtn');
  await host('skipCountdown');
  const ids = {};
  for (const [p, name] of [[anna, 'Аня'], [boris, 'Борис']]) {
    const st = await until(p, s => s.started && s.overlay, name + ' в бою');
    const me = st.ships[st.myId];
    assert.equal(me.name, name);
    ids[name] = st.id;
    assert.equal(st.ships.length, 4);
    assert.match(st.vTeams, /Синие 2\/2 · Красные 2\/2/);
  }
  const h = await host.state();
  assert.equal(shipOf(h, ids['Аня']).team, 1);
  assert.equal(shipOf(h, ids['Борис']).team, 0);
  assert.equal(h.ships.filter(s => s.ctrl === 'ai').length, 1);
});

test('приказы гостей доходят до хоста: тяга и торпеда', async () => {
  const a0 = await anna.state();
  await anna('key', 'KeyW'); await anna('key', 'KeyW');
  await until(host, s => shipOf(s, a0.id).cmdThrottle === 2, 'хост получил тягу Ани');
  await until(anna, s => Number.parseInt(s.vFuel) < 9000, 'у Ани тратится топливо');
  await boris('key', 'KeyT');
  const b0 = await boris.state();
  await until(host, s => shipOf(s, b0.id).torps === 9, 'Борис пустил торпеду');
  await until(anna, s => s.torps >= 1, 'Аня видит торпеду');
  await anna('key', 'KeyX');
  await until(host, s => shipOf(s, a0.id).cmdThrottle === 0, 'Аня заглушила двигатель');
});

test('пауза Бориса останавливает бой у всех, у Ани видно, кто её поставил', async () => {
  await boris('key', 'KeyP');
  await until(host, s => s.paused, 'хост на паузе');
  await until(anna, s => s.paused && /пауза: Борис/.test(s.clock), 'Аня видит паузу Бориса');
  await boris('key', 'KeyP');
  await until(anna, s => !s.paused, 'пауза снята');
});

test('связь с Борисом оборвалась: пауза у всех, через срок его корабль берёт ИИ', async () => {
  await host('netCfg', { dropAfter: 800 });
  const b = await boris.state();
  await boris.drop();
  await until(host, s => s.paused, 'хост поставил паузу по «завещанию»');
  const h = await until(host, s => shipOf(s, '') && s.ships.filter(x => x.ctrl === 'ai').length === 2 && !s.paused, 'корабль Бориса под ИИ', 5000);
  assert.equal(h.ships.find(s => s.name === 'Борис').ctrl, 'ai');
  assert.equal(h.ships.find(s => s.name === 'Борис').owner, '');
  await until(anna, s => /Борис вышел/.test(s.toast) || !s.paused, 'Аня продолжает бой');
  assert.ok(b.id);
});

test('синие уничтожены: Аня побеждает, хост проигрывает, хост начинает новый бой', async () => {
  await host('killTeam', 0);
  const h = await until(host, s => !s.overlay && s.ovTitle === 'Поражение', 'итог у хоста');
  assert.match(h.ovText, /ваша команда уничтожена/);
  const a = await until(anna, s => !s.overlay && s.ovTitle === 'Победа', 'итог у Ани');
  assert.match(a.status, /Новый бой начнёт Хост/);
  assert.equal(h.ovBtn.text, 'Новый бой');
  await host('click', 'ovBtn');
  await host('skipCountdown');
  const a2 = await until(anna, s => s.started && s.overlay && !s.over, 'Аня в новом бою');
  assert.equal(a2.ships[a2.myId].name, 'Аня');
  assert.equal(a2.ships[a2.myId].fuel, 9000);
});

test('хост выходит: бой у Ани прерван, она в лобби; ошибок ни у кого нет', async () => {
  await host('click', 'mpLeave');
  const a = await until(anna, s => s.role === null && s.result === 'Бой прерван: хост вышел', 'Аня узнала, что хост вышел');
  assert.equal(a.status, 'Хост вышел из игры.');
  await until(anna, s => !s.overlay && s.ovTitle === 'Бой прерван', 'итог у Ани');
  for (const p of [host, anna]) assert.deepEqual((await p.state()).errors, []);
  assert.equal([...broker.retained.keys()].filter(k => k.includes('/lobby/')).length, 0, 'в лобби не осталось объявлений');
});
