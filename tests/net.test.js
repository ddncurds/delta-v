// Снимки сетевой игры: хост шлёт гостю картину глазами гостя
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIP } from '../src/config.js';
import { S, newGame } from '../src/sim/index.js';
import { makeSnapshot, applySnapshot, netBodies } from '../src/net/snapshot.js';
import { putTorp } from './helpers.js';

const snap = () => makeSnapshot({ scale: 1, pauseReason: '', ack: 0, say: [], result: '' });

test('снимок для гостя: стороны переставлены, топливо и боезапас гостя передаются', () => {
  newGame({ mp: true });
  S.foe.fuel = 1234; S.foe.torps = 3; S.foe.hp = 77;
  putTorp('me', [1, 2]);
  const m = snap();
  assert.equal(m.me.fuel, 1234);
  assert.equal(m.me.torps, 3);
  assert.equal(m.me.hp, 77);
  assert.equal(m.torps[0].owner, 'foe', 'торпеда хоста для гостя — вражеская');
  assert.equal(m.foe.fuel, undefined, 'топливо хоста гостю не раскрывается');
  JSON.parse(JSON.stringify(m));
});

test('гость применяет снимок: свой корабль, видимый противник, торпеды', () => {
  newGame({ mp: true });
  S.foe.fuel = 4321; S.foe.pos = [10, 20];
  putTorp('me', [5, 5]);
  const m = JSON.parse(JSON.stringify(snap()));
  newGame({ mp: true });
  applySnapshot(m, false);
  assert.equal(S.me.fuel, 4321);
  assert.deepEqual(S.me.pos, [10, 20]);
  assert.equal(S.torps.length, 1);
  assert.equal(S.torps[0].owner, 'foe');
});

test('ползунок гостя не откатывается, пока хост не подтвердил приказ', () => {
  newGame({ mp: true });
  const m = JSON.parse(JSON.stringify(snap()));
  newGame({ mp: true });
  S.me.issuedThrottle = 5;
  applySnapshot(m, true);
  assert.equal(S.me.issuedThrottle, 5);
  applySnapshot(m, false);
  assert.equal(S.me.issuedThrottle, 0);
});

test('конец боя доходит до гостя', () => {
  newGame({ mp: true });
  S.over = true;
  const m = makeSnapshot({ scale: 1, pauseReason: '', ack: 0, say: [], result: 'Победа: x' });
  newGame({ mp: true });
  applySnapshot(JSON.parse(JSON.stringify(m)), false);
  assert.equal(S.over, true);
  assert.equal(S.result, 'Победа: x');
  assert.equal(S.me.fuel, SHIP.dv);
});

test('тела от хоста проверяются: мусор отбрасывается, поля обрезаются', () => {
  assert.deepEqual(netBodies(null), []);
  const out = netBodies([
    { kind: 'planet', look: 'terra', seed: 5, name: 'Очень длинное имя планеты', pos: [1, 2], r: 100, mu: 1e9 },
    { kind: 'x', look: 'evil', seed: 1, name: 'M', pos: [0, 0], r: 10, mu: 0 },
    { kind: 'moon', pos: [0, NaN], r: 10, mu: 1, seed: 1 },
    { kind: 'moon', pos: [0, 0], r: -1, mu: 1, seed: 1 },
    null,
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].name.length, 16);
  assert.equal(out[1].kind, 'moon');
  assert.equal(out[1].look, 'rock');
  assert.equal(netBodies(Array(20).fill(out[0])).length, 8);
});
