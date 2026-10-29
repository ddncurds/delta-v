// Проверки симуляции без браузера: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../src/config.js';
import { dist } from '../src/lib/math.js';
import { S, newGame, step, predictPath } from '../src/sim/index.js';
import { paintSphere } from '../src/render/planets.js';

// свой корабль в точке p со скоростью v, противник далеко и без ИИ
function solo(p, v) {
  S.me.pos = [...p]; S.me.vel = [...v];
  S.foe.pos = [1e8, 1e8]; S.foe.vel = [0, 0]; S.foe.ai = null;
}

test('у корабля нет топлива: долгая тяга не кончается', () => {
  newGame(); S.bodies = []; solo([0, 0], [0, 0]);
  S.me.crew = false; S.me.cmdThrottle = 2;
  for (let i = 0; i < 20 * 60 / DT; i++) step(DT);
  assert.ok(!('fuel' in S.me));
  assert.ok(S.me.accG > 1.9, 'через 20 минут двигатель всё ещё тянет');
});

test('круговая орбита вокруг одиночной планеты держится', () => {
  newGame(); S.bodies = [S.bodies[0]];
  const b = S.bodies[0], r0 = b.r * 1.5;
  solo([b.pos[0] + r0, b.pos[1]], [0, Math.sqrt(b.mu / r0)]);
  let rmin = Infinity, rmax = 0;
  for (let i = 0; i < 1500 / DT; i++) { step(DT); const r = dist(S.me.pos, b.pos); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
  assert.ok(S.me.alive);
  assert.ok((rmax - rmin) / r0 < 0.005, `радиус гуляет на ${((rmax - rmin) / r0 * 100).toFixed(2)}%`);
});

test('прогноз курса совпадает с полётом', () => {
  newGame(); S.bodies = [S.bodies[0]];
  const b = S.bodies[0];
  solo([b.pos[0] + b.r * 2.5, b.pos[1] - b.r], [-150, 330]);
  const pp = predictPath(S.me, 120, 0.5);
  for (let i = 0; i < 120 / DT; i++) step(DT);
  const end = pp.pts[pp.pts.length - 1];
  assert.equal(pp.hit, null);
  assert.ok(dist(end, S.me.pos) < 50, `расхождение ${dist(end, S.me.pos).toFixed(1)} м`);
});

test('падение на тело предсказывается и кончается гибелью корабля', () => {
  newGame(); S.bodies = [S.bodies[0]];
  const b = S.bodies[0];
  solo([b.pos[0] + b.r + 30000, b.pos[1]], [-300, 0]);
  const pp = predictPath(S.me, 300, 0.5);
  assert.equal(pp.hit, b);
  for (let i = 0; i < 300 / DT && !S.over; i++) step(DT);
  assert.equal(S.me.deathBy, 'crash');
  assert.match(S.result, /разбился/);
});

test('бои с ИИ: тела расставлены, ИИ не разбивается, числа конечны', () => {
  let noBodies = 0;
  for (let g = 0; g < 60; g++) {
    newGame(); if (!S.bodies.length) noBodies++;
    S.me.torps = 0;
    for (let i = 0; i < 600 / DT && !S.over; i++) step(DT);
    assert.notEqual(S.foe.deathBy, 'crash');
    assert.ok([...S.me.pos, ...S.foe.pos].every(Number.isFinite));
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
