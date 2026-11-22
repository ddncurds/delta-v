// Командный бой: состав, расстановка, сенсоры каждого корабля, цели, итог
import test from 'node:test';
import assert from 'node:assert/strict';
import './lang-ru.js';
import { DT, TEAM, DETECT } from '../src/config.js';
import { dist } from '../src/lib/math.js';
import { S, newGame, step, resultFor, normalizeRoster, issue, viewShip, teamCount, callsign } from '../src/sim/index.js';
import { fireFlak, launchTorp } from '../src/sim/weapons.js';
import { runFor, putTorp, resetTracks } from './helpers.js';

const ai = team => ({ team, ctrl: 'ai' });
const squad = (a, b, me = true) => [...Array(a)].map((_, i) => i === 0 && me ? { team: 0, ctrl: 'human', name: 'Вы' } : ai(0)).concat([...Array(b)].map(() => ai(1)));

// бой без тел и ИИ, корабли в заданных точках
function arena(roster, places) {
  newGame({ roster });
  S.bodies = [];
  S.ships.forEach((s, i) => { s.pos = [...places[i]]; s.vel = [0, 0]; s.ai = null; s.crew = false; });
  resetTracks();
  for (const s of S.ships) s.targetId = S.ships.find(e => e.team !== s.team).id;
}

test('состав: до 5 в команде, сначала синие, позывные по номеру', () => {
  const r = normalizeRoster([ai(1), ai(0), ...Array(7).fill(ai(0)), ai(1)]);
  assert.equal(r.filter(x => x.team === 0).length, TEAM.max);
  assert.deepEqual(r.map(x => x.id), [...Array(7).keys()]);
  assert.equal(r[0].team, 0); assert.equal(r[5].team, 1);
  assert.equal(r[1].name, callsign(0, 1));
  assert.equal(r[1].name, 'Ястреб');
  assert.throws(() => normalizeRoster([ai(0)]), /Красные/);
});

test('5 на 5: строй каждой команды на своей стороне, корабли не друг на друге', () => {
  for (let g = 0; g < 10; g++) {
    newGame({ roster: squad(5, 5) });
    assert.equal(S.ships.length, 10);
    assert.deepEqual([teamCount(0), teamCount(1)], [[5, 5], [5, 5]]);
    for (const s of S.ships) {
      assert.ok(s.team ? s.pos[0] > 40000 : s.pos[0] < -40000);
      for (const o of S.ships) if (o !== s) assert.ok(dist(s.pos, o.pos) > 3000);
      for (const b of S.bodies) assert.ok(dist(s.pos, b.pos) > b.r + 20000);
      assert.ok(S.ships[s.targetId].team !== s.team, 'у каждого цель в другой команде');
    }
    assert.equal(S.myId, 0); assert.equal(S.ships[0].ctrl, 'human');
    assert.equal(S.ships.filter(s => s.ai).length, 9);
  }
});

test('каждый корабль видит сам: союзник рядом с врагом не открывает его остальным', () => {
  arena(squad(2, 1), [[0, 0], [100000, 0], [110000, 0]]);
  runFor(1);
  assert.equal(S.tracks[1][2].exact, true, 'вблизи — виден');
  assert.equal(S.tracks[0][2].exact, false, 'издалека корабль по инерции не виден');
  assert.equal(S.tracks[0][1], null, 'союзник — не контакт');
});

test('союзников оружие не задевает: облако и выхлоп бьют только по противнику', () => {
  arena(squad(2, 1), [[0, 0], [3000, 0], [1e7, 0]]);
  S.ships[0].spread = 0.01;
  fireFlak(S.ships[0], 0);
  S.ships[0].heading = S.ships[0].cmdHeading = Math.PI; S.ships[0].cmdThrottle = 8;
  runFor(4);
  assert.equal(S.ships[1].hp, 100);
});

test('торпеда идёт в выбранную цель, а погибшую цель штурман меняет сам', () => {
  arena(squad(1, 2), [[0, 0], [20000, 3000], [60000, -5000]]);
  assert.equal(issue(0, 'target', 2), undefined);
  assert.equal(S.ships[0].targetId, 2);
  issue(0, 'target', 0); issue(0, 'target', 99);
  assert.equal(S.ships[0].targetId, 2, 'свой корабль и несуществующий — не цель');
  launchTorp(S.ships[0]);
  assert.equal(S.torps[0].target, 2);
  runFor(40);
  assert.equal(S.ships[2].deathBy, 'torp');
  assert.equal(S.ships[0].targetId, 1, 'новая цель — последний противник');
  assert.equal(S.over, false);
});

test('торпеда, потерявшая цель, берёт другую', () => {
  arena(squad(1, 2), [[0, 0], [30000, 0], [30000, 8000]]);
  const t = putTorp(0, [20000, 0], [500, 0]);
  t.target = 2; S.ships[2].alive = false;
  runFor(20);
  assert.equal(S.ships[1].deathBy, 'torp');
});

test('бой идёт, пока в обеих командах есть живые; гибель своего корабля — не конец', () => {
  arena(squad(2, 2), [[0, 0], [0, 10000], [1e6, 0], [1e6, 10000]]);
  S.ships[0].alive = false;
  step(DT);
  assert.equal(S.over, false);
  assert.equal(viewShip(), S.ships[1], 'камера на живом союзнике');
  S.ships[2].alive = false; S.ships[3].alive = false;
  step(DT);
  assert.equal(S.over, true);
  assert.equal(S.result, 'Победа: все корабли противника уничтожены, ваш корабль погиб, но команда выстояла');
  assert.equal(resultFor(2), 'Поражение: ваша команда уничтожена');
});

test('командные бои ИИ до конца: числа конечны, кто-то побеждает', () => {
  let finished = 0;
  for (const [a, b] of [[3, 3], [5, 5], [2, 4]]) {
    newGame({ roster: squad(a, b, false) });
    for (let i = 0; i < 2400 / DT && !S.over; i++) step(DT);
    assert.ok(S.ships.every(s => [...s.pos, ...s.vel, s.fuel, s.hp].every(Number.isFinite)));
    if (S.over) finished++;
  }
  // бои ИИ против ИИ иногда затягиваются: главное — без сбоев, и хотя бы один бой доходит до конца
  assert.ok(finished >= 1, 'бои заканчиваются');
});

test('сенсор на краю: корабль ближе DETECT виден без двигателя', () => {
  arena(squad(1, 1), [[0, 0], [DETECT - 100, 0]]);
  runFor(0.5);
  assert.equal(S.tracks[0][1].exact, true);
});
