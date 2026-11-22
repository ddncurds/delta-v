// Мир боя: гравитация, прогноз, столкновения, итог боя, бои с ИИ
import test from 'node:test';
import assert from 'node:assert/strict';
import './lang-ru.js';
import { DT } from '../src/config.js';
import { dist } from '../src/lib/math.js';
import { S, newGame, step, predictPath, resultFor, gravAt, surfaceG } from '../src/sim/index.js';
import { paintSphere } from '../src/render/planets.js';
import { me, foe } from './helpers.js';

// свой корабль в точке p со скоростью v, противник далеко и без ИИ
function solo(p, v) {
  me().pos = [...p]; me().vel = [...v];
  foe().pos = [1e8, 1e8]; foe().vel = [0, 0]; foe().ai = null;
}

test('круговая орбита вокруг одиночной планеты держится', () => {
  newGame(); S.bodies = [S.bodies[0]];
  const b = S.bodies[0], r0 = b.r * 1.5;
  solo([b.pos[0] + r0, b.pos[1]], [0, Math.sqrt(b.mu / r0)]);
  let rmin = Infinity, rmax = 0;
  for (let i = 0; i < 1500 / DT; i++) { step(DT); const r = dist(me().pos, b.pos); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
  assert.ok(me().alive);
  assert.ok((rmax - rmin) / r0 < 0.005, `радиус гуляет на ${((rmax - rmin) / r0 * 100).toFixed(2)}%`);
});

test('прогноз курса совпадает с полётом', () => {
  newGame(); S.bodies = [S.bodies[0]];
  const b = S.bodies[0];
  solo([b.pos[0] + b.r * 2.5, b.pos[1] - b.r], [-150, 330]);
  const pp = predictPath(me(), 120, 0.5);
  for (let i = 0; i < 120 / DT; i++) step(DT);
  const end = pp.pts[pp.pts.length - 1];
  assert.equal(pp.hit, null);
  assert.ok(dist(end, me().pos) < 50, `расхождение ${dist(end, me().pos).toFixed(1)} м`);
});

test('падение на тело предсказывается и кончается гибелью корабля', () => {
  newGame(); S.bodies = [S.bodies[0]];
  const b = S.bodies[0];
  solo([b.pos[0] + b.r + 30000, b.pos[1]], [-300, 0]);
  const pp = predictPath(me(), 300, 0.5);
  assert.equal(pp.hit, b);
  for (let i = 0; i < 300 / DT && !S.over; i++) step(DT);
  assert.equal(me().deathBy, 'crash');
  assert.match(S.result, /разбился/);
});

test('бои с ИИ: тела расставлены, ИИ не разбивается, числа конечны', () => {
  let noBodies = 0;
  for (let g = 0; g < 60; g++) {
    newGame(); if (!S.bodies.length) noBodies++;
    me().torps = 0;
    for (let i = 0; i < 600 / DT && !S.over; i++) step(DT);
    assert.notEqual(foe().deathBy, 'crash');
    assert.ok([...me().pos, ...foe().pos].every(Number.isFinite));
  }
  assert.equal(noBodies, 0);
});

test('текстуры тел: диск непрозрачен внутри и прозрачен в углах', () => {
  for (const look of ['terra', 'desert', 'ice', 'gas', 'rock']) {
    const n = 64, px = paintSphere(n, look, 7), at = (x, y) => (y * n + x) * 4 + 3;
    assert.equal(px[at(n / 2, n / 2)], 255, look);
    assert.equal(px[at(0, 0)], 0, look);
  }
});

test('новый бой: корабли далеко друг от друга, уже в движении, с полным боезапасом', () => {
  for (let g = 0; g < 20; g++) {
    newGame();
    assert.ok(dist(me().pos, foe().pos) > 100000);
    for (const s of [me(), foe()]) {
      const v = Math.hypot(...s.vel);
      // скорость строя 300–800 м/с и разброс каждого корабля в строю до ±30 м/с по каждой оси
      assert.ok(v >= 250 && v <= 850, `скорость ${v}`);
      assert.equal(s.hp, 100); assert.equal(s.alive, true); assert.equal(s.torps, 10);
    }
    assert.equal(me().crew, true); assert.ok(foe().ai, 'в одиночной игре противником управляет ИИ');
    for (const b of S.bodies) for (const s of [me(), foe()]) assert.ok(dist(s.pos, b.pos) > b.r + 20000);
  }
});

test('корабль человека — с экипажем и без ИИ, корабль ИИ — без экипажа', () => {
  newGame({ mp: true, roster: [{ team: 0, ctrl: 'human', owner: 'host' }, { team: 1, ctrl: 'human', owner: 'G' }] });
  assert.equal(S.mp, true); assert.equal(foe().crew, true); assert.equal(foe().ai, null);
  newGame();
  assert.equal(me().crew, true); assert.equal(me().ai, null);
  assert.equal(foe().crew, false); assert.ok(foe().ai);
});

test('притяжение у поверхности соответствует заданному в g', () => {
  newGame(); S.bodies = [S.bodies[0]];
  const b = S.bodies[0], g = gravAt(b.pos[0] + b.r, b.pos[1]);
  assert.ok(Math.abs(Math.hypot(...g) / 9.81 - surfaceG(b)) < 1e-9);
  assert.ok(surfaceG(b) >= 1 && surfaceG(b) <= 1.5);
});

test('итог боя глазами каждой стороны', () => {
  newGame();
  foe().alive = false; foe().deathBy = 'flak';
  assert.equal(resultFor(0), 'Победа: корабль противника разрушен облаком шариков');
  assert.equal(resultFor(1), 'Поражение: корпус разрушен облаком шариков');
  me().alive = false;
  assert.equal(resultFor(0), 'Взаимное уничтожение');
  S.forfeit = 1;
  assert.equal(resultFor(1), 'Поражение: вы покинули бой');
  S.abort = 'Бой прерван: хост вышел';
  assert.equal(resultFor(0), S.abort);
});

test('после конца боя симуляция стоит', () => {
  newGame(); foe().alive = false; step(DT);
  assert.equal(S.over, true);
  const t = S.t, p = [...me().pos];
  step(DT);
  assert.equal(S.t, t); assert.deepEqual(me().pos, p);
});
