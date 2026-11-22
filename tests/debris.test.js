// Обломки корпуса: детерминированный разлёт по seed, урон от крупных, исчезновение за simRadius, совпадение у хоста и гостя
import test from 'node:test';
import assert from 'node:assert/strict';
import './lang-ru.js';
import { FX_CONFIG } from '../src/config.js';
import { S, newGame } from '../src/sim/index.js';
import { killShip, shipEnergy } from '../src/sim/ship.js';
import { debrisPlan, spawnDebris } from '../src/sim/debris.js';
import { addFx } from '../src/sim/state.js';
import { stepDebris } from '../src/sim/weapons.js';
import { makeSnapshot, applySnapshot, netRoster, newPeerSync } from '../src/net/snapshot.js';
import { emptySpace, runFor, resetTracks, me, foe } from './helpers.js';

const ev = (o = {}) => ({ pos: [0, 0], vel: [300, -100], en: 1, h: 0.5, seed: 4242, ...o });

test('план обломков по seed одинаков, число и сила растут с energy', () => {
  assert.deepEqual(debrisPlan(ev()), debrisPlan(ev()));
  assert.notDeepEqual(debrisPlan(ev()), debrisPlan(ev({ seed: 1 })));
  assert.equal(debrisPlan(ev({ en: 0.2 })).length, 8);
  assert.equal(debrisPlan(ev({ en: 1 })).length, 16);
  assert.equal(debrisPlan(ev({ en: 2 })).length, 26);
  // скорость источника добавляется ко всем; угловая скорость в пределах ±6 рад/с
  for (const p of debrisPlan(ev())) {
    assert.ok(Math.abs(Math.hypot(p.vx - 300, p.vy + 100) - p.v0) < 1e-6);
    assert.ok(p.v0 >= FX_CONFIG.vMin && p.v0 <= FX_CONFIG.vMin * Math.exp(FX_CONFIG.k));
    assert.ok(Math.abs(p.spin) <= FX_CONFIG.debris.spin);
  }
});

test('сила взрыва: обычная гибель — 1, торпеда по полным бакам — взрыв реактора 2', () => {
  emptySpace();
  assert.equal(shipEnergy(me(), 'flak'), 1);
  assert.equal(shipEnergy(me(), 'torp'), 2);
  me().fuel = 0;
  assert.equal(shipEnergy(me(), 'torp'), 1);
});

test('гибель корабля: событие с seed, в симуляции только крупные обломки; они летят прямо и уходят за 3 км', () => {
  emptySpace({ meVel: [200, 0] });
  killShip(me(), 'flak', 1);
  const f = S.fx.at(-1);
  assert.equal(f.kind, 'boom'); assert.ok(Number.isFinite(f.seed)); assert.deepEqual(f.vel, [200, 0]);
  const big = debrisPlan(f).filter(p => p.big);
  assert.ok(big.length >= 3 && big.length < debrisPlan(f).length, 'мелкие обломки — только картинка');
  assert.equal(S.debris.length, big.length);
  assert.ok(S.debris.every(d => d.m >= FX_CONFIG.debris.bigMass));
  const d0 = S.debris.map(d => ({ ...d, pos: [...d.pos] }));
  for (let i = 0; i < 200; i++) runForDebris();
  // через 10 с: позиция = старт + v·t, центр взрыва летит со скоростью корабля
  for (const d of S.debris) {
    const o = d0.find(x => x.i === d.i);
    assert.ok(Math.abs(d.pos[0] - (o.pos[0] + o.vel[0] * 10)) < 1e-6);
  }
  const all = debrisPlan(f).filter(p => p.v0 * 10 > 3000);
  assert.ok(all.length >= 1, 'хотя бы несколько осколков за 10 с дальше 3 км');
});
// шаг только обломков: корабли стоят, бой не кончается
function runForDebris() { S.t += 0.05; stepDebris(0.05); }

test('обломки пропадают дальше simRadius от центра взрыва', () => {
  emptySpace();
  killShip(me(), 'flak', 1);
  const n = S.debris.length, maxT = Math.max(...S.debris.map(d => FX_CONFIG.simRadius / d.v0));
  const minT = Math.min(...S.debris.map(d => FX_CONFIG.simRadius / d.v0));
  while (S.t < minT - 0.1) runForDebris();
  assert.equal(S.debris.length, n);
  while (S.t < maxT + 0.1) runForDebris();
  assert.equal(S.debris.length, 0);
});

test('крупный обломок бьёт корабль по массе и относительной скорости, затем исчезает', () => {
  emptySpace({ foe: [2000, 0] });
  S.debris.push({ b: 99, i: 0, team: 0, m: 1000, v0: 400, t0: S.t, dead: false, pos: [1000, 0], vel: [400, 0] });
  const hp = foe().hp;
  runFor(3);
  const dmg = Math.round(0.5 * 1000 * 400 * 400 / FX_CONFIG.debris.jPerHp);
  assert.equal(hp - foe().hp, Math.min(dmg, FX_CONFIG.debris.dmgMax));
  assert.equal(S.debris.length, 0);
});

test('обломок добивает корабль: гибель «debris» и новый взрыв', () => {
  emptySpace({ foe: [2000, 0] });
  foe().hp = 5;
  S.debris.push({ b: 99, i: 0, team: 0, m: 1000, v0: 400, t0: S.t, dead: false, pos: [1000, 0], vel: [400, 0] });
  runFor(3);
  assert.equal(foe().alive, false); assert.equal(foe().deathBy, 'debris');
  assert.match(S.result, /обломк/);
});

// сеть: 1 на 1, гость — красный
const ROSTER = [{ team: 0, ctrl: 'human', owner: 'host', name: 'Хост' }, { team: 1, ctrl: 'human', owner: 'G', name: 'Гость' }];
const opts = { scale: 1, pauseReason: '', ack: 0, say: [], result: '' };
const wire = m => JSON.parse(JSON.stringify(m));

test('у хоста и гостя опасные обломки совпадают: по сети идёт только событие взрыва', () => {
  newGame({ mp: true, roster: ROSTER, myId: 0 }); S.bodies = []; resetTracks();
  const victim = S.ships[0];
  victim.vel = [150, 50];
  killShip(victim, 'torp', 1);
  S.ships[0].alive = true;                       // бой не кончается: снимок обычный
  for (let i = 0; i < 20; i++) { S.t += 0.05; stepDebris(0.05); }
  const m = wire(makeSnapshot(1, newPeerSync(), opts));
  assert.ok(!('debris' in m), 'обломки не передаются');
  const host = S.debris.map(d => [d.b, d.i, d.pos[0], d.pos[1]]);
  newGame({ mp: true, guest: true, roster: netRoster(wire(ROSTER)), myId: 1, bodies: [] });
  applySnapshot(m, false);
  const guest = S.debris.map(d => [d.b, d.i, d.pos[0], d.pos[1]]);
  assert.equal(guest.length, host.length);
  guest.forEach((g, k) => { assert.deepEqual(g.slice(0, 2), host[k].slice(0, 2)); assert.ok(Math.abs(g[2] - host[k][2]) < 1e-6 && Math.abs(g[3] - host[k][3]) < 1e-6); });
});

test('обломок, попавший в корабль у хоста, пропадает и у гостя', () => {
  newGame({ mp: true, roster: ROSTER, myId: 0 }); S.bodies = []; resetTracks();
  const f = { kind: 'boom', pos: [0, 0], dur: 4, r: 6000, team: 1, vel: [0, 0], en: 1, h: 0, hull: 0, seed: 777 };
  addFx(f); spawnDebris(f);
  const sync = newPeerSync(), m1 = wire(makeSnapshot(1, sync, opts));
  const gone = S.debris[0];
  S.hitLog.push([gone.b, gone.i, ++S.hitSeq]);
  const m2 = wire(makeSnapshot(1, sync, opts));
  newGame({ mp: true, guest: true, roster: netRoster(wire(ROSTER)), myId: 1, bodies: [] });
  applySnapshot(m1, false);
  const n = S.debris.length;
  applySnapshot(m2, false);
  assert.equal(S.debris.length, n - 1);
  assert.ok(!S.debris.some(d => d.b === gone.b && d.i === gone.i));
});
