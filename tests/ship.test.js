// Движение корабля, приказы и экипаж
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIP, D2R, G0 } from '../src/config.js';
import { S, issue, reactionDelay } from '../src/sim/index.js';
import { startBurn } from '../src/sim/ship.js';
import { emptySpace, runFor, me, foe } from './helpers.js';

test('корабль разворачивается не быстрее 60°/с', () => {
  emptySpace();
  me().heading = 0; me().cmdHeading = Math.PI / 2;
  runFor(1);
  assert.ok(Math.abs(me().heading - SHIP.turn) < 0.01, `курс ${(me().heading / D2R).toFixed(1)}°`);
  runFor(1);
  assert.ok(Math.abs(me().heading - Math.PI / 2) < 1e-9);
});

test('тяга ограничена 8 g и направлена по курсу', () => {
  emptySpace();
  me().heading = me().cmdHeading = Math.PI / 2; me().cmdThrottle = 20;
  runFor(1);
  assert.equal(me().accG, SHIP.maxG);
  assert.ok(Math.abs(me().vel[1] - SHIP.maxG * G0) < 0.5);
  assert.ok(Math.abs(me().vel[0]) < 1e-6);
});

test('манёвр на время сам выключает двигатель', () => {
  emptySpace();
  startBurn(me(), 0, 3, 5);
  runFor(4.9);
  assert.equal(me().accG, 3);
  runFor(0.3);
  assert.equal(me().cmdThrottle, 0);
  assert.equal(me().accG, 0);
  assert.equal(me().burnEnd, -1);
});

test('перегрузка утомляет экипаж, отдых снимает усталость', () => {
  emptySpace({ crew: true });
  me().cmdThrottle = 6;
  runFor(5);
  const st = me().stress;
  assert.ok(st > 10, `усталость ${st}`);
  me().cmdThrottle = 0;
  runFor(5);
  assert.ok(Math.abs(me().stress - (st - 6)) < 0.1);
  me().cmdThrottle = 2.5;
  const before = me().stress;
  runFor(5);
  assert.equal(me().stress, before, 'от 1.5 до 3 g усталость не меняется');
});

test('экипаж гибнет от перегрузки, бой проигран', () => {
  emptySpace({ crew: true });
  me().cmdThrottle = 8;
  runFor(60);
  assert.equal(S.over, true);
  assert.equal(me().deathBy, 'crew');
  assert.match(S.result, /Поражение: экипаж не выдержал перегрузки/);
});

test('уставший экипаж выполняет приказы с задержкой', () => {
  emptySpace({ crew: true });
  assert.equal(reactionDelay(me()), 0);
  me().stress = 70;
  assert.equal(reactionDelay(me()), 1.25);
  me().stress = 0;
  issue(0, 'throttle', 1);
  runFor(0.05);
  assert.equal(me().cmdThrottle, 1, 'свежий экипаж — сразу');
  me().stress = 70;
  issue(0, 'throttle', 2);
  assert.equal(me().issuedThrottle, 2, 'ползунок показывает отданный приказ');
  runFor(1);
  assert.equal(me().cmdThrottle, 1);
  runFor(0.5);
  assert.equal(me().cmdThrottle, 2);
});

test('корабль без экипажа (ИИ) не устаёт', () => {
  emptySpace();
  me().cmdThrottle = 8;
  runFor(20);
  assert.equal(me().stress, 0);
  assert.equal(reactionDelay(me()), 0);
});
