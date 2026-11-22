// Оружие: торпеды, облако шариков, выхлоп
import test from 'node:test';
import assert from 'node:assert/strict';
import './lang-ru.js';
import { DT, SHIP, TORP, FLAK, D2R } from '../src/config.js';
import { S, step, issue } from '../src/sim/index.js';
import { fireFlak, launchTorp, plumeFactor } from '../src/sim/weapons.js';
import { emptySpace, runFor, putTorp, me, foe } from './helpers.js';

test('торпеда: пуск тратит боезапас, без торпед пуск не проходит', () => {
  emptySpace({ foe: [50000, 0] });
  assert.equal(me().torps, SHIP.torps);
  assert.equal(launchTorp(me()), true);
  assert.equal(me().torps, SHIP.torps - 1);
  assert.equal(S.torps.length, 1);
  assert.equal(S.stats[0].launched, 1);
  me().torps = 0;
  assert.equal(launchTorp(me()), false);
  assert.equal(S.torps.length, 1);
});

test('запас торпед пополняется по одной за SHIP.torpReload секунд, но не сверх полного', () => {
  emptySpace({ foe: [1e7, 0] });
  launchTorp(me()); launchTorp(me());
  assert.equal(me().torps, SHIP.torps - 2);
  runFor(SHIP.torpReload - 1);
  assert.equal(me().torps, SHIP.torps - 2, 'раньше срока не пополняется');
  runFor(2);
  assert.equal(me().torps, SHIP.torps - 1);
  runFor(SHIP.torpReload);
  assert.equal(me().torps, SHIP.torps);
  runFor(SHIP.torpReload * 2);
  assert.equal(me().torps, SHIP.torps, 'сверх полного запаса не растёт');
  assert.equal(me().torpTimer, 0);
});

test('торпеда догоняет неподвижную цель и уничтожает её одним попаданием', () => {
  emptySpace({ foe: [20000, 3000] });
  launchTorp(me());
  runFor(60);
  assert.equal(S.over, true);
  assert.equal(foe().alive, false);
  assert.equal(foe().deathBy, 'torp');
  assert.equal(me().alive, true);
  assert.match(S.result, /^Победа: корабль противника уничтожен торпедой/);
});

test('у торпеды ограниченный запас Δv: кончился — она больше не разгоняется', () => {
  emptySpace({ foe: [5e6, 0] });
  launchTorp(me());
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
  assert.equal(me().flak, FLAK.charges);
  assert.equal(fireFlak(me(), 0), true);
  assert.equal(S.pellets.length, FLAK.n);
  assert.equal(fireFlak(me(), 0), false, 'пауза между выстрелами');
  me().flakCd = 0; fireFlak(me(), 0);
  me().flakCd = 0; fireFlak(me(), 0);
  assert.equal(me().flak, 0);
  me().flakCd = 0;
  assert.equal(fireFlak(me(), 0), false, 'заряды кончились');
  runFor(FLAK.recharge + 0.1);
  assert.equal(me().flak, 1);
  runFor(FLAK.recharge * 2);
  assert.equal(me().flak, FLAK.charges);
});

test('отдача облака толкает корабль назад', () => {
  emptySpace();
  fireFlak(me(), 0);
  assert.ok(Math.abs(me().vel[0] + FLAK.recoil) < 1e-9);
});

test('два шарика сбивают торпеду', () => {
  emptySpace({ foe: [1e6, 0] });
  const t = putTorp(1, [5000, 0]);
  for (let i = 0; i < 2; i++) S.pellets.push({ owner: 0, team: 0, age: 0, dead: false, b: 1, i, pos: [4900 - i * 5, 0], vel: [1800, 0] });
  step(DT);
  assert.equal(t.alive, false);
  assert.equal(S.stats[0].kills, 1);
  assert.equal(S.torps.length, 0);
});

test('облако по кораблю снимает прочность и может его добить', () => {
  emptySpace({ foe: [3000, 0] });
  me().spread = 1 * D2R;
  fireFlak(me(), 0);
  runFor(4);
  assert.ok(foe().hp < 100, `корпус ${foe().hp}`);
  foe().hp = 1;
  me().flakCd = 0; fireFlak(me(), Math.atan2(foe().pos[1] - me().pos[1], foe().pos[0] - me().pos[0]));
  runFor(5);
  assert.equal(foe().deathBy, 'flak');
});

test('выхлоп: факел только за кормой, тем слабее, чем дальше', () => {
  emptySpace();
  me().heading = 0; me().accG = 4;
  assert.equal(plumeFactor(me(), [1000, 0]), 0, 'впереди факела нет');
  const near = plumeFactor(me(), [-500, 0]), far = plumeFactor(me(), [-4000, 0]);
  assert.ok(near > far && far > 0);
  assert.equal(plumeFactor(me(), [-1000, 3000]), 0, 'сбоку факела нет');
  me().accG = 0;
  assert.equal(plumeFactor(me(), [-500, 0]), 0, 'двигатель выключен');
});

test('выхлоп плавит торпеду за кормой', () => {
  emptySpace({ foe: [1e6, 0] });
  me().heading = me().cmdHeading = 0; me().cmdThrottle = 7;
  const t = putTorp(1, [-2000, 0]);
  runFor(1.5);
  assert.equal(t.alive, false);
  assert.equal(S.stats[0].kills, 1);
});

test('выхлоп плавит корабль противника за кормой', () => {
  emptySpace({ foe: [-800, 0] });
  me().heading = me().cmdHeading = 0; me().cmdThrottle = 8;
  runFor(1);
  assert.ok(foe().hp < 100);
  foe().hp = 0.5;
  runFor(1);
  assert.equal(foe().deathBy, 'plume');
});

test('приказ «торпеда» исполняется через очередь приказов', () => {
  emptySpace({ foe: [50000, 0] });
  issue(0, 'torp');
  step(DT);
  assert.equal(S.torps.length, 1);
  assert.equal(S.torps[0].owner, 0);
});
