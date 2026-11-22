// Топливо (запас Δv) корабля
import test from 'node:test';
import assert from 'node:assert/strict';
import { DT, G0, SHIP, FLAK } from '../src/config.js';
import { dist } from '../src/lib/math.js';
import { S, step, predictPath } from '../src/sim/index.js';
import { fireFlak } from '../src/sim/weapons.js';
import { newAi, aiStep } from '../src/sim/ai.js';
import { emptySpace, runFor, putTorp } from './helpers.js';

test('запас топлива на 50% больше прежних 6000 м/с', () => {
  assert.equal(SHIP.dv, 9000);
  emptySpace();
  assert.equal(S.me.fuel, 9000);
  assert.equal(S.foe.fuel, 9000);
});

test('без тяги топливо не тратится', () => {
  emptySpace({ meVel: [500, 0] });
  runFor(60);
  assert.equal(S.me.fuel, SHIP.dv);
});

test('расход равен набранной скорости: 2 g за 10 с — около 196 м/с', () => {
  emptySpace();
  S.me.cmdThrottle = 2;
  runFor(10);
  assert.ok(Math.abs(S.me.fuel - (SHIP.dv - 2 * G0 * 10)) < 1, `осталось ${S.me.fuel}`);
  assert.ok(Math.abs(SHIP.dv - S.me.fuel - Math.hypot(...S.me.vel)) < 1);
});

test('топливо кончилось — двигатель глохнет, скорость больше не растёт', () => {
  emptySpace();
  S.me.cmdThrottle = 8;
  runFor(SHIP.dv / (8 * G0) + 5);
  assert.equal(S.me.fuel, 0);
  assert.equal(S.me.accG, 0);
  const v = Math.hypot(...S.me.vel);
  assert.ok(Math.abs(v - SHIP.dv) < 1, `скорость ${v}`);
  runFor(30);
  assert.equal(Math.hypot(...S.me.vel), v);
  assert.equal(S.me.cmdThrottle, 8, 'приказ остаётся, но тяги нет');
});

test('топливо никогда не уходит в минус, последний шаг тянет ровно на остаток', () => {
  emptySpace();
  S.me.fuel = 1; S.me.cmdThrottle = 8;
  step(DT);
  assert.equal(S.me.fuel, 0);
  assert.ok(Math.abs(Math.hypot(...S.me.vel) - 1) < 1e-9);
});

test('выстрел облаком стоит 15 м/с топлива', () => {
  emptySpace();
  fireFlak(S.me, 'me', 0);
  assert.equal(S.me.fuel, SHIP.dv - FLAK.mass);
  S.me.fuel = 5; S.me.flakCd = 0;
  fireFlak(S.me, 'me', 0);
  assert.equal(S.me.fuel, 0);
});

test('прогноз курса учитывает остаток топлива', () => {
  emptySpace();
  S.me.fuel = 100; S.me.cmdThrottle = 2;
  const pp = predictPath(S.me, 30, DT);
  runFor(30);
  const end = pp.pts[pp.pts.length - 1];
  assert.ok(dist(end, S.me.pos) < 5, `расхождение ${dist(end, S.me.pos).toFixed(1)} м`);
  assert.ok(Math.abs(Math.hypot(...S.me.vel) - 100) < 1);
});

test('ИИ без топлива не уклоняется и не маневрирует, с топливом — уклоняется', () => {
  for (const [fuel, dodges] of [[100, false], [SHIP.dv, true]]) {
    emptySpace({ me: [200000, 0], foe: [0, 0] });
    S.foe.ai = newAi(); S.foe.ai.nextSalvo = 1e9; S.foe.fuel = fuel; S.t = 10;
    putTorp('me', [5000, 0], [-800, 0]);
    aiStep();
    assert.equal(S.foe.burnEnd > 0, dodges, `топливо ${fuel}`);
  }
});

test('ИИ без топлива не начинает плановый манёвр', () => {
  emptySpace({ me: [100000, 0], foe: [0, 0] });
  S.foe.ai = newAi(); S.foe.ai.nextSalvo = 1e9; S.foe.fuel = 500; S.t = 100;
  aiStep();
  assert.equal(S.foe.burnEnd, -1);
});
