// Топливо (запас Δv) корабля
import test from 'node:test';
import assert from 'node:assert/strict';
import { DT, G0, SHIP, FLAK } from '../src/config.js';
import { dist } from '../src/lib/math.js';
import { S, step, predictPath } from '../src/sim/index.js';
import { fireFlak } from '../src/sim/weapons.js';
import { newAi, aiStep } from '../src/sim/ai.js';
import { emptySpace, runFor, putTorp, me, foe } from './helpers.js';

test('запас топлива на 50% больше прежних 6000 м/с', () => {
  assert.equal(SHIP.dv, 9000);
  emptySpace();
  assert.equal(me().fuel, 9000);
  assert.equal(foe().fuel, 9000);
});

test('без тяги топливо не тратится', () => {
  emptySpace({ meVel: [500, 0] });
  runFor(60);
  assert.equal(me().fuel, SHIP.dv);
});

test('расход равен набранной скорости: 2 g за 10 с — около 196 м/с', () => {
  emptySpace();
  me().cmdThrottle = 2;
  runFor(10);
  assert.ok(Math.abs(me().fuel - (SHIP.dv - 2 * G0 * 10)) < 1, `осталось ${me().fuel}`);
  assert.ok(Math.abs(SHIP.dv - me().fuel - Math.hypot(...me().vel)) < 1);
});

test('топливо кончилось — двигатель глохнет, скорость больше не растёт', () => {
  emptySpace();
  me().cmdThrottle = 8;
  runFor(SHIP.dv / (8 * G0) + 5);
  assert.equal(me().fuel, 0);
  assert.equal(me().accG, 0);
  const v = Math.hypot(...me().vel);
  assert.ok(Math.abs(v - SHIP.dv) < 1, `скорость ${v}`);
  runFor(30);
  assert.equal(Math.hypot(...me().vel), v);
  assert.equal(me().cmdThrottle, 8, 'приказ остаётся, но тяги нет');
});

test('топливо никогда не уходит в минус, последний шаг тянет ровно на остаток', () => {
  emptySpace();
  me().fuel = 1; me().cmdThrottle = 8;
  step(DT);
  assert.equal(me().fuel, 0);
  assert.ok(Math.abs(Math.hypot(...me().vel) - 1) < 1e-9);
});

test('выстрел облаком стоит 15 м/с топлива', () => {
  emptySpace();
  fireFlak(me(), 0);
  assert.equal(me().fuel, SHIP.dv - FLAK.mass);
  me().fuel = 5; me().flakCd = 0;
  fireFlak(me(), 0);
  assert.equal(me().fuel, 0);
});

test('прогноз курса учитывает остаток топлива', () => {
  emptySpace();
  me().fuel = 100; me().cmdThrottle = 2;
  const pp = predictPath(me(), 30, DT);
  runFor(30);
  const end = pp.pts[pp.pts.length - 1];
  assert.ok(dist(end, me().pos) < 5, `расхождение ${dist(end, me().pos).toFixed(1)} м`);
  assert.ok(Math.abs(Math.hypot(...me().vel) - 100) < 1);
});

test('ИИ без топлива не уклоняется и не маневрирует, с топливом — уклоняется', () => {
  for (const [fuel, dodges] of [[100, false], [SHIP.dv, true]]) {
    emptySpace({ me: [200000, 0], foe: [0, 0] });
    foe().ai = newAi(); foe().ai.nextSalvo = 1e9; foe().fuel = fuel; S.t = 10;
    putTorp(0, [5000, 0], [-800, 0]);
    aiStep(foe());
    assert.equal(foe().burnEnd > 0, dodges, `топливо ${fuel}`);
  }
});

test('ИИ без топлива не начинает плановый манёвр', () => {
  emptySpace({ me: [100000, 0], foe: [0, 0] });
  foe().ai = newAi(); foe().ai.nextSalvo = 1e9; foe().fuel = 500; S.t = 100;
  aiStep(foe());
  assert.equal(foe().burnEnd, -1);
});
