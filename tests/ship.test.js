// Движение корабля, приказы и экипаж
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIP, D2R, G0 } from '../src/config.js';
import { S, issue, reactionDelay } from '../src/sim/index.js';
import { startBurn } from '../src/sim/ship.js';
import { emptySpace, runFor } from './helpers.js';

test('корабль разворачивается не быстрее 60°/с', () => {
  emptySpace();
  S.me.heading = 0; S.me.cmdHeading = Math.PI / 2;
  runFor(1);
  assert.ok(Math.abs(S.me.heading - SHIP.turn) < 0.01, `курс ${(S.me.heading / D2R).toFixed(1)}°`);
  runFor(1);
  assert.ok(Math.abs(S.me.heading - Math.PI / 2) < 1e-9);
});

test('тяга ограничена 8 g и направлена по курсу', () => {
  emptySpace();
  S.me.heading = S.me.cmdHeading = Math.PI / 2; S.me.cmdThrottle = 20;
  runFor(1);
  assert.equal(S.me.accG, SHIP.maxG);
  assert.ok(Math.abs(S.me.vel[1] - SHIP.maxG * G0) < 0.5);
  assert.ok(Math.abs(S.me.vel[0]) < 1e-6);
});

test('манёвр на время сам выключает двигатель', () => {
  emptySpace();
  startBurn(S.me, 0, 3, 5);
  runFor(4.9);
  assert.equal(S.me.accG, 3);
  runFor(0.3);
  assert.equal(S.me.cmdThrottle, 0);
  assert.equal(S.me.accG, 0);
  assert.equal(S.me.burnEnd, -1);
});

test('перегрузка утомляет экипаж, отдых снимает усталость', () => {
  emptySpace({ crew: true });
  S.me.cmdThrottle = 6;
  runFor(5);
  const st = S.me.stress;
  assert.ok(st > 10, `усталость ${st}`);
  S.me.cmdThrottle = 0;
  runFor(5);
  assert.ok(Math.abs(S.me.stress - (st - 6)) < 0.1);
  S.me.cmdThrottle = 2.5;
  const before = S.me.stress;
  runFor(5);
  assert.equal(S.me.stress, before, 'от 1.5 до 3 g усталость не меняется');
});

test('экипаж гибнет от перегрузки, бой проигран', () => {
  emptySpace({ crew: true });
  S.me.cmdThrottle = 8;
  runFor(60);
  assert.equal(S.over, true);
  assert.equal(S.me.deathBy, 'crew');
  assert.match(S.result, /Поражение: экипаж не выдержал перегрузки/);
});

test('уставший экипаж выполняет приказы с задержкой', () => {
  emptySpace({ crew: true });
  assert.equal(reactionDelay(S.me), 0);
  S.me.stress = 70;
  assert.equal(reactionDelay(S.me), 1.25);
  S.me.stress = 0;
  issue('me', 'throttle', 1);
  runFor(0.05);
  assert.equal(S.me.cmdThrottle, 1, 'свежий экипаж — сразу');
  S.me.stress = 70;
  issue('me', 'throttle', 2);
  assert.equal(S.me.issuedThrottle, 2, 'ползунок показывает отданный приказ');
  runFor(1);
  assert.equal(S.me.cmdThrottle, 1);
  runFor(0.5);
  assert.equal(S.me.cmdThrottle, 2);
});

test('корабль без экипажа (ИИ) не устаёт', () => {
  emptySpace();
  S.me.cmdThrottle = 8;
  runFor(20);
  assert.equal(S.me.stress, 0);
  assert.equal(reactionDelay(S.me), 0);
});
