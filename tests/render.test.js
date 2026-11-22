// Чистая логика рендера без холста: раскладка подписей, срок жизни эффектов, следы, ступени детализации
import test from 'node:test';
import assert from 'node:assert/strict';
import { labelRect, overlap, placeLabels } from '../src/render/label-layout.js';
import { clock, tickClock } from '../src/render/clock.js';
import { syncFx, fxRecords, fxParticles, FX_LIFE, MAX_PARTS } from '../src/render/fx.js';
import { newTrails, updateTrails, trailOf, TRAIL_MAX } from '../src/render/trails.js';
import { iconLen, iconMin, modelMix, ICON_MIN_PX, MODEL_MIN_PX } from '../src/render/lod.js';

test('подписи: пересечение прямоугольников с учётом выравнивания', () => {
  const a = labelRect(100, 50, 40, 'left'), b = labelRect(130, 55, 40, 'left'), c = labelRect(100, 50, 40, 'right');
  assert.ok(overlap(a, b));
  assert.ok(!overlap(a, c), 'правое выравнивание уводит подпись влево от якоря');
  assert.ok(!overlap(a, labelRect(100, 80, 40)), 'подписи на разных строках не пересекаются');
});

test('подписи: P2 не ложится на P0, равные приоритеты не мешают друг другу', () => {
  const r = (x, y) => labelRect(x, y, 60);
  const env = { p: 2, rect: r(0, 0), id: 'env' }, threat = { p: 0, rect: r(20, 4), id: 'threat' };
  const own = { p: 1, rect: r(300, 0), id: 'own' }, env2 = { p: 2, rect: r(10, 2), id: 'env2' };
  const ids = placeLabels([env, threat, own, env2]).map(i => i.id);
  assert.deepEqual(ids.sort(), ['own', 'threat']);
  const same = placeLabels([{ p: 1, rect: r(0, 0) }, { p: 1, rect: r(5, 0) }]);
  assert.equal(same.length, 2);
});

// жизнь эффекта по часам рендера: результат не зависит от шага кадра и скорости игры
function lifetime(dt, gameScale) {
  const S = { t: 0, fx: [{ kind: 'boom', pos: [1000, 2000], t0: 0, dur: 4, r: 6000, team: 1 }] };
  clock.fx = 0;
  let seen = 0;
  for (let i = 0; i < 10 / dt; i++) {
    tickClock(dt, false);
    S.t += dt * gameScale;
    // симуляция убирает эффект через dur игровых секунд, рендер — нет
    S.fx = S.fx.filter(f => S.t - f.t0 < f.dur);
    syncFx(S);
    if (fxRecords().length) seen = clock.fx;
  }
  return seen;
}

test('эффекты живут в реальном времени, независимо от шага и скорости игры', () => {
  const a = lifetime(1 / 60, 1), b = lifetime(1 / 60, 30), c = lifetime(0.1, 10);
  for (const v of [a, b, c]) assert.ok(Math.abs(v - FX_LIFE.boom) < 0.11, `взрыв живёт ${v} с`);
  assert.ok(FX_LIFE.boom >= 2.5);
});

test('эффекты: пауза замораживает, новый бой очищает, частиц не больше лимита', () => {
  const S = { t: 0, fx: [{ kind: 'boom', pos: [0, 0], t0: 0, dur: 4, r: 6000, team: 0 }] };
  clock.fx = 0;
  syncFx(S);
  for (let i = 0; i < 100; i++) { tickClock(0.1, true); syncFx(S); }
  assert.equal(fxRecords().length, 1, 'на паузе эффект не стареет');
  const S2 = { t: 0, fx: [] };
  for (let i = 0; i < 30; i++) S2.fx.push({ kind: 'boom', pos: [i * 1000, 0], t0: 0, dur: 4, r: 6000, team: 0 });
  syncFx(S2);
  assert.equal(fxRecords().length, 30, 'эффекты прошлого боя не видны');
  assert.ok(fxParticles().length <= MAX_PARTS);
  assert.ok(fxParticles().every(p => fxRecords().includes(p.rec)));
});

test('следы: не больше 120 точек, сброс при уходе времени назад, разрыв при потере контакта', () => {
  const ship = { id: 0, alive: true, pos: [0, 0] }, S = { t: 0, ships: [ship] }, tr = newTrails();
  let vis = true;
  for (let i = 0; i < 300; i++) { S.t = i; ship.pos = [i * 10, 0]; updateTrails(tr, S, () => vis); }
  const n = trailOf(tr, 0).reduce((a, g) => a + g.length, 0);
  assert.equal(n, TRAIL_MAX);
  vis = false; S.t = 300; updateTrails(tr, S, () => vis);
  vis = true; S.t = 301; updateTrails(tr, S, () => vis);
  assert.equal(trailOf(tr, 0).length, 2, 'после потери контакта начат новый сегмент');
  S.t = 5; updateTrails(tr, S, () => vis);
  assert.equal(trailOf(tr, 0).length, 1, 'время ушло назад: следы сброшены');
  assert.equal(trailOf(tr, 0)[0].length, 1);
  const S2 = { t: 400, ships: [ship] };
  updateTrails(tr, S2, () => vis);
  assert.equal(trailOf(tr, 0)[0].length, 1, 'новый бой: следы сброшены');
});

test('iconLen: монотонность и непрерывность на пороге', () => {
  assert.equal(MODEL_MIN_PX, ICON_MIN_PX);
  for (const team of [0, 1]) {
    let prev = 0;
    for (let L = 0; L < 200; L += 0.05) {
      const v = iconLen(L, team);
      assert.ok(v >= prev - 1e-9, 'не убывает');
      assert.ok(v - prev < 0.06 || L === 0, 'без скачков');
      prev = v;
    }
    const m = iconMin(team);
    assert.ok(Math.abs(iconLen(m - 1e-6, team) - iconLen(m + 1e-6, team)) < 1e-5);
    assert.equal(modelMix(m - 0.01, team), 0);
    assert.ok(modelMix(m * 2, team) === 1);
  }
  assert.equal(iconLen(10, 0), ICON_MIN_PX);
  assert.ok(Math.abs(iconLen(10, 1) - ICON_MIN_PX * 55 / 46) < 1e-9);
});
