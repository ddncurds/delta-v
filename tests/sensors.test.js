// Обнаружение противника и угрозы
import test from 'node:test';
import assert from 'node:assert/strict';
import './lang-ru.js';
import { DETECT } from '../src/config.js';
import { dist } from '../src/lib/math.js';
import { S, nearestThreat, timeToImpact } from '../src/sim/index.js';
import { emptySpace, runFor, putTorp, me, foe } from './helpers.js';

test('корабль по инерции вдали не виден, трек ведётся по баллистике', () => {
  emptySpace({ foe: [100000, 0], foeVel: [0, 200] });
  runFor(1);
  assert.equal(S.tracks[0][1].exact, false);
  runFor(30);
  assert.ok(dist(S.tracks[0][1].pos, foe().pos) < 1, 'без тел и тяги трек совпадает с кораблём');
});

test('трек расходится с кораблём, если тот маневрирует невидимо — и уточняется при включении двигателя', () => {
  emptySpace({ foe: [100000, 0] });
  runFor(1);
  foe().vel = [0, 300];          // скрытое изменение скорости (например, отдача)
  runFor(20);
  assert.ok(dist(S.tracks[0][1].pos, foe().pos) > 5000);
  foe().cmdThrottle = 1;
  runFor(0.1);
  assert.equal(S.tracks[0][1].exact, true);
  assert.ok(dist(S.tracks[0][1].pos, foe().pos) < 1);
});

test('вблизи корабль виден и без двигателя', () => {
  emptySpace({ foe: [DETECT - 1000, 0] });
  runFor(1);
  assert.equal(S.tracks[0][1].exact, true);
});

test('ближайшая угроза — торпеда с наименьшим временем подлёта', () => {
  emptySpace();
  assert.equal(nearestThreat(me()), null);
  putTorp(1, [30000, 0], [-1000, 0]);
  const fast = putTorp(1, [0, 40000], [0, -4000]);
  putTorp(0, [1000, 0], [-1000, 0]);   // своя торпеда — не угроза
  const th = nearestThreat(me());
  assert.equal(th.t, fast);
  assert.ok(Math.abs(th.ttg - 10) < 1e-6);
  assert.equal(timeToImpact({ pos: [1000, 0], vel: [100, 0] }, me()), null, 'удаляющаяся торпеда');
});
