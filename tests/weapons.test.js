// Оружие: торпеды, облако шариков, выхлоп
import test from 'node:test';
import assert from 'node:assert/strict';
import { DT, SHIP, TORP, FLAK, D2R } from '../src/config.js';
import { S, step, issue } from '../src/sim/index.js';
import { fireFlak, launchTorp, plumeFactor } from '../src/sim/weapons.js';
import { emptySpace, runFor, putTorp } from './helpers.js';

test('торпеда: пуск тратит боезапас, без торпед пуск не проходит', () => {
  emptySpace({ foe: [50000, 0] });
  assert.equal(S.me.torps, SHIP.torps);
  assert.equal(launchTorp(S.me, 'me'), true);
  assert.equal(S.me.torps, SHIP.torps - 1);
  assert.equal(S.torps.length, 1);
  assert.equal(S.stats.me.launched, 1);
  S.me.torps = 0;
  assert.equal(launchTorp(S.me, 'me'), false);
  assert.equal(S.torps.length, 1);
});

test('торпеда догоняет неподвижную цель и уничтожает её одним попаданием', () => {
  emptySpace({ foe: [20000, 3000] });
  launchTorp(S.me, 'me');
  runFor(60);
  assert.equal(S.over, true);
  assert.equal(S.foe.alive, false);
  assert.equal(S.foe.deathBy, 'torp');
  assert.equal(S.me.alive, true);
  assert.match(S.result, /^Победа: корабль противника уничтожен торпедой/);
});

test('у торпеды ограниченный запас Δv: кончился — она больше не разгоняется', () => {
  emptySpace({ foe: [5e6, 0] });
  launchTorp(S.me, 'me');
  const t = S.torps[0];
  assert.equal(t.fuel, TORP.dv);
  t.fuel = 300;
  runFor(30);
  assert.equal(t.fuel, 0);
  const v = Math.hypot(...t.vel);
  assert.ok(Math.abs(v - 400) < 1, `скорость ${v}: 100 м/с пуска + 300 м/с топлива`);
});

test('облако: три заряда, пауза между выстрелами, перезарядка 15 с', () => {
  emptySpace();
  assert.equal(S.me.flak, FLAK.charges);
  assert.equal(fireFlak(S.me, 'me', 0), true);
  assert.equal(S.pellets.length, FLAK.n);
  assert.equal(fireFlak(S.me, 'me', 0), false, 'пауза между выстрелами');
  S.me.flakCd = 0; fireFlak(S.me, 'me', 0);
  S.me.flakCd = 0; fireFlak(S.me, 'me', 0);
  assert.equal(S.me.flak, 0);
  S.me.flakCd = 0;
  assert.equal(fireFlak(S.me, 'me', 0), false, 'заряды кончились');
  runFor(FLAK.recharge + 0.1);
  assert.equal(S.me.flak, 1);
  runFor(FLAK.recharge * 2);
  assert.equal(S.me.flak, FLAK.charges);
});

test('отдача облака толкает корабль назад', () => {
  emptySpace();
  fireFlak(S.me, 'me', 0);
  assert.ok(Math.abs(S.me.vel[0] + FLAK.recoil) < 1e-9);
});

test('два шарика сбивают торпеду', () => {
  emptySpace({ foe: [1e6, 0] });
  const t = putTorp('foe', [5000, 0]);
  for (let i = 0; i < 2; i++) S.pellets.push({ owner: 'me', age: 0, dead: false, b: 1, i, pos: [4900 - i * 5, 0], vel: [1800, 0] });
  step(DT);
  assert.equal(t.alive, false);
  assert.equal(S.stats.me.kills, 1);
  assert.equal(S.torps.length, 0);
});

test('облако по кораблю снимает прочность и может его добить', () => {
  emptySpace({ foe: [3000, 0] });
  S.me.spread = 1 * D2R;
  fireFlak(S.me, 'me', 0);
  runFor(4);
  assert.ok(S.foe.hp < 100, `корпус ${S.foe.hp}`);
  S.foe.hp = 1;
  S.me.flakCd = 0; fireFlak(S.me, 'me', Math.atan2(S.foe.pos[1] - S.me.pos[1], S.foe.pos[0] - S.me.pos[0]));
  runFor(5);
  assert.equal(S.foe.deathBy, 'flak');
});

test('выхлоп: факел только за кормой, тем слабее, чем дальше', () => {
  emptySpace();
  S.me.heading = 0; S.me.accG = 4;
  assert.equal(plumeFactor(S.me, [1000, 0]), 0, 'впереди факела нет');
  const near = plumeFactor(S.me, [-500, 0]), far = plumeFactor(S.me, [-4000, 0]);
  assert.ok(near > far && far > 0);
  assert.equal(plumeFactor(S.me, [-1000, 3000]), 0, 'сбоку факела нет');
  S.me.accG = 0;
  assert.equal(plumeFactor(S.me, [-500, 0]), 0, 'двигатель выключен');
});

test('выхлоп плавит торпеду за кормой', () => {
  emptySpace({ foe: [1e6, 0] });
  S.me.heading = S.me.cmdHeading = 0; S.me.cmdThrottle = 7;
  const t = putTorp('foe', [-2000, 0]);
  runFor(1.5);
  assert.equal(t.alive, false);
  assert.equal(S.stats.me.kills, 1);
});

test('выхлоп плавит корабль противника за кормой', () => {
  emptySpace({ foe: [-800, 0] });
  S.me.heading = S.me.cmdHeading = 0; S.me.cmdThrottle = 8;
  runFor(1);
  assert.ok(S.foe.hp < 100);
  S.foe.hp = 0.5;
  runFor(1);
  assert.equal(S.foe.deathBy, 'plume');
});

test('приказ «торпеда» исполняется через очередь приказов', () => {
  emptySpace({ foe: [50000, 0] });
  issue('me', 'torp');
  step(DT);
  assert.equal(S.torps.length, 1);
  assert.equal(S.torps[0].owner, 'me');
});
