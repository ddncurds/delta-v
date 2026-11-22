// Обнаружение противника и угрозы
import test from 'node:test';
import assert from 'node:assert/strict';
import './lang-ru.js';
import { DETECT } from '../src/config.js';
import { dist } from '../src/lib/math.js';
import { S, nearestThreat, timeToImpact, shownPos, setSayHook } from '../src/sim/index.js';
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

test('игроку потерянный контакт показан в точке последнего обнаружения, а не по баллистике', () => {
  emptySpace({ foe: [100000, 0], foeVel: [0, 200] });
  runFor(30);
  const tr = S.tracks[0][1];
  assert.equal(tr.exact, false);
  assert.ok(dist(shownPos(tr), [100000, 0]) < 50, 'отметка осталась на месте');
  assert.ok(dist(shownPos(tr), foe().pos) > 5000, 'и не едет за кораблём');
});


test('тело на линии взгляда скрывает корабль даже с работающим двигателем', () => {
  emptySpace({ foe: [100000, 0] });
  S.bodies.push({ kind: 'planet', name: 'Стена', pos: [50000, 0], r: 10000, mu: 0 });
  foe().cmdThrottle = 1;
  runFor(0.5);
  assert.ok(foe().accG > 0.3);
  assert.equal(S.tracks[0][1].exact, false);
  assert.equal(S.tracks[1][0].exact, false, 'и он нас тоже не видит');
});

test('тело в стороне от линии взгляда не мешает', () => {
  emptySpace({ foe: [100000, 0] });
  S.bodies.push({ kind: 'planet', name: 'Стена', pos: [50000, 20000], r: 10000, mu: 0 });
  foe().cmdThrottle = 1;
  runFor(0.5);
  assert.equal(S.tracks[0][1].exact, true);
});

test('за телом не видно и вблизи; цель за телом — своё сообщение', () => {
  emptySpace({ foe: [DETECT - 1000, 0] });
  S.bodies.push({ kind: 'moon', name: 'Луна', pos: [(DETECT - 1000) / 2, 0], r: 2000, mu: 0 });
  const log = [];
  setSayHook((id, key, p) => log.push([id, key, p]));
  runFor(0.5);
  setSayHook(() => {});
  assert.equal(S.tracks[0][1].exact, false);
  assert.deepEqual(log.find(m => m[0] === 0)?.slice(1), ['msg.contactHidden', { name: foe().name, body: 'Луна' }]);
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
