// ИИ кораблей: защита от торпед, обход тел, расход боезапаса (plans/ai.md, Т-1…Т-5)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DT, G0, FLAK } from '../src/config.js';
import { S, step, setSayHook } from '../src/sim/index.js';
import { newAi } from '../src/sim/ai.js';
import { flakLeft } from '../src/sim/sensors.js';
import { fireFlak } from '../src/sim/weapons.js';
import { emptySpace, runFor, putTorp, me, foe } from './helpers.js';

// ИИ ведёт корабль 1 (красные) в точке [0, 0]; противник (корабль 0) — в точке mePos
// ai — правка состояния ИИ, p — его параметров; сближение по умолчанию выключено, чтобы корабль стоял на месте
function aiDuel(mePos = [1e8, 1e8], ai = {}, p = {}) {
  emptySpace({ me: mePos, foe: [0, 0] });
  foe().ai = Object.assign(newAi('new', { close: false, knife: false, ...p }), { nextSalvo: 1e9, nextNudge: 1e9, nextRetarget: 1e9 }, ai);
  return foe();
}

// сообщения экипажам за время теста
function said() {
  const log = [];
  setSayHook((id, key) => log.push([id, key]));
  return log;
}

test('Т-1: торпеда в 5 с — ИИ отвечает выхлопом кормой к ней', () => {
  const f = aiDuel();
  putTorp(0, [10000, 0], [-2000, 0]);
  step(DT);
  assert.ok(f.aimAway, 'выхлоп не запущен');
  assert.ok(f.cmdThrottle > 0);
});

test('Т-2: уклонение не прерывает выхлоп', () => {
  const f = aiDuel(), log = said();
  putTorp(0, [10000, 0], [-2000, 0]);
  step(DT);
  assert.ok(f.aimAway);
  const end = f.burnEnd;
  // вторая торпеда в окне уклонения
  putTorp(0, [0, 24000], [0, -2000]);
  while (S.t < end - DT && f.alive) { step(DT); assert.ok(f.aimAway, `выхлоп прерван на ${S.t.toFixed(2)} с`); }
  assert.ok(!log.some(([id, k]) => id === f.id && k === 'msg.dodge'));
  setSayHook(() => {});
});

test('Т-3: корабль, летящий в тело, отворачивает', () => {
  const f = aiDuel();
  S.bodies = [{ kind: 'planet', name: 'X', pos: [60000, 0], r: 20000, mu: 1 * G0 * 20000 ** 2 }];
  f.vel = [800, 0]; f.ai.nextGeo = 0;
  step(DT);
  assert.ok(f.cmdThrottle > 0, 'ИИ не включил двигатель');
  runFor(120);
  assert.ok(f.alive, 'ИИ разбился о тело');
});

test('Т-4: без зарядов облака ИИ не стреляет, без торпед — не пускает залп', () => {
  const f = aiDuel([60000, 0], { nextSalvo: 0 });
  f.flak = 0; f.torps = 0;
  putTorp(0, [30000, 0], [-1500, 0]);
  runFor(3);
  assert.equal(S.pellets.length, 0);
  assert.equal(S.torps.filter(t => t.team === f.team).length, 0);
});

test('Т-5: залп — заданное число торпед с паузой не больше 0,5 с, не больше остатка', () => {
  for (const [n, torps] of [[4, 10], [3, 10], [4, 2]]) {
    const f = aiDuel([60000, 0], { nextSalvo: 0 }, { salvoN: n });
    f.torps = torps;
    const times = [];
    for (let i = 0; i < 3 / DT; i++) { const k = S.torps.length; step(DT); if (S.torps.length > k) times.push(S.t); }
    assert.equal(times.length, Math.min(n, torps));
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] <= 0.5 + 1e-9);
  }
});

test('оценка зарядов облака врага: видимые выстрелы и перезарядка', () => {
  emptySpace({ me: [0, 0], foe: [10000, 0] });
  const tr = S.tracks[1][0];
  assert.equal(flakLeft(tr), FLAK.charges);
  fireFlak(me(), 0); runFor(1); fireFlak(me(), 0);
  assert.equal(flakLeft(tr), FLAK.charges - 2);
  runFor(FLAK.recharge);
  assert.equal(flakLeft(tr), FLAK.charges - 1);
  runFor(FLAK.recharge);
  assert.equal(flakLeft(tr), FLAK.charges);
  // выстрел, которого враг не видел, в оценку не входит
  me().pos = [0, 0]; S.ships[1].pos = [1e7, 0]; runFor(0.1);
  fireFlak(me(), 0);
  assert.equal(flakLeft(tr), FLAK.charges);
});

test('враг далеко и расходится — ИИ разворачивается на сближение', () => {
  const f = aiDuel([200000, 0], {}, { close: true });
  f.vel = [-500, 0];
  step(DT);
  assert.ok(f.cmdThrottle > 0);
  assert.ok(Math.cos(f.cmdHeading) > 0.9, 'тяга не в сторону врага');
});

test('без торпед ИИ идёт в ближний бой и бьёт облаком по кораблю', () => {
  const f = aiDuel([40000, 0], {}, { knife: true });
  f.torps = 0;
  for (let i = 0; i < 200 / DT && !S.pellets.some(p => p.team === f.team); i++) step(DT);
  assert.ok(S.pellets.some(p => p.team === f.team), 'облако по кораблю не выпущено');
});
