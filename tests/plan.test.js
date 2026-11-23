// Планировщик манёвра: прогноз не меняет бой и совпадает с исполнением приказа burn
import test from 'node:test';
import assert from 'node:assert/strict';
import { DT, G0, SHIP } from '../src/config.js';
import { S, issue, planBurn, orderVal, step } from '../src/sim/index.js';
import { emptySpace, me } from './helpers.js';

// планета рядом с кораблём: прогноз должен учитывать притяжение
function nearPlanet() {
  emptySpace({ me: [0, 0], meVel: [0, 1500], crew: true });
  S.bodies = [{ kind: 'planet', look: 'rock', seed: 1, name: 'P', pos: [60000, 0], r: 30000, mu: 1.2 * G0 * 30000 ** 2 }];
  me().stress = 55;
}

// исполнить бой шагами DT и снять положения корабля через каждые 0,5 с
function execute(T) {
  const pts = [[...me().pos]];
  for (let k = 1; k <= Math.round(T / DT) && me().alive; k++) {
    step(DT);
    if (k % 10 === 0) pts.push([...me().pos]);
  }
  return pts;
}

test('прогноз не меняет состояние боя', () => {
  nearPlanet();
  const before = JSON.stringify(S);
  planBurn(me(), [1, 4, 10]);
  planBurn(me(), null);
  assert.equal(JSON.stringify(S), before);
});

test('прогноз манёвра совпадает с исполнением: задержка, поворот, тяга, притяжение', () => {
  nearPlanet();
  const burn = [Math.PI * 0.75, 5, 12];
  const plan = planBurn(me(), burn, 60);
  assert.ok(plan.delay > 0, 'усталый экипаж исполняет приказ с задержкой');
  issue(me().id, 'burn', burn);
  const real = execute(60);
  assert.equal(real.length, plan.pts.length);
  for (let i = 0; i < real.length; i++) {
    const d = Math.hypot(real[i][0] - plan.pts[i][0], real[i][1] - plan.pts[i][1]);
    assert.ok(d < 1e-6, `точка ${i}: расхождение ${d} м`);
  }
  assert.ok(Math.abs(me().fuel - plan.fuel) < 1e-6, 'остаток Δv совпадает');
  assert.ok(Math.abs(plan.dv - 5 * G0 * 12) < 5 * G0 * DT + 1e-6, 'расход Δv = тяга × время');
  assert.ok(Math.abs(me().stress - plan.stress) < 1e-9, 'усталость экипажа совпадает');
  assert.ok(plan.burnFrom > 0 && plan.burnTo > plan.burnFrom);
});

test('прогноз учитывает приказы в очереди и находит столкновение', () => {
  emptySpace({ me: [0, 0], meVel: [0, 0] });
  S.bodies = [{ kind: 'planet', look: 'rock', seed: 1, name: 'P', pos: [80000, 0], r: 30000, mu: G0 * 30000 ** 2 }];
  issue(me().id, 'throttle', 2);
  const plan = planBurn(me(), [Math.PI, 3, 5]);
  assert.equal(plan.hit, null, 'без тяги к планете корабль не падает сразу');
  const fall = planBurn(me(), [0, 8, 30]);
  assert.ok(fall.hit && fall.hitT > 0, 'манёвр на планету ведёт к столкновению');
  assert.ok(fall.minAlt.alt === 0);
});

test('параметр приказа burn проверяется и ограничивается', () => {
  assert.equal(orderVal('burn', 5), null);
  assert.equal(orderVal('burn', [1, 2]), null);
  assert.equal(orderVal('burn', [1, NaN, 3]), null);
  assert.deepEqual(orderVal('burn', [1, 99, 999]), [1, SHIP.maxG, 60]);
  assert.equal(orderVal('nope', 1), null);
  assert.equal(orderVal('throttle', 50), SHIP.maxG);
  assert.equal(orderVal('heading', 'x'), null);
  assert.equal(orderVal('torp'), 0, 'приказ без параметра годен');
});
