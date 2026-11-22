// Снимки сетевой игры: хост шлёт каждому гостю то, что видит его корабль
import test from 'node:test';
import assert from 'node:assert/strict';
import './lang-ru.js';
import { SHIP } from '../src/config.js';
import { S, newGame } from '../src/sim/index.js';
import { fireFlak } from '../src/sim/weapons.js';
import { addFx } from '../src/sim/state.js';
import { makeSnapshot, applySnapshot, netBodies, netRoster, newPeerSync, pruneHitLog } from '../src/net/snapshot.js';
import { putTorp, resetTracks } from './helpers.js';

// 2 на 2: хост и ИИ у синих, гость G и ИИ у красных
const ROSTER = [{ team: 0, ctrl: 'human', owner: 'host', name: 'Хост' }, { team: 0, ctrl: 'ai' },
  { team: 1, ctrl: 'human', owner: 'G', name: 'Гость' }, { team: 1, ctrl: 'ai' }];
const opts = { scale: 1, pauseReason: '', ack: 0, say: [], result: '' };
const wire = m => JSON.parse(JSON.stringify(m));
function hostGame() {
  newGame({ mp: true, roster: ROSTER, myId: 0 });
  S.bodies = []; resetTracks();
  return S;
}
function guestGame() { newGame({ mp: true, guest: true, roster: netRoster(wire(ROSTER)), myId: 2, bodies: [] }); }

test('свой корабль гость получает целиком, союзника — всегда, противника — только видимого', () => {
  hostGame();
  S.ships[2].fuel = 1234; S.ships[2].torps = 3;
  S.tracks[2][0].exact = true; S.tracks[2][1].exact = false;
  const m = wire(makeSnapshot(2, newPeerSync(), opts));
  assert.equal(m.ships[2].fuel, 1234);
  assert.equal(m.ships[2].torps, 3);
  assert.ok(m.ships[3].pos, 'союзник виден');
  assert.equal(m.ships[3].fuel, undefined, 'но его топливо — нет');
  assert.ok(m.ships[0].pos, 'видимый противник');
  assert.deepEqual(m.ships[1], { alive: true }, 'невидимый противник — только «жив»');
  assert.equal(m.eye, 2);
  assert.equal(m.tr[2], null); assert.equal(m.tr[3], null);
  assert.equal(m.tr[1].exact, false);
});

test('гость применяет снимок: свой корабль, треки, торпеды', () => {
  hostGame();
  S.ships[2].fuel = 4321; S.ships[2].pos = [10, 20];
  putTorp(0, [5, 5]);
  const m = wire(makeSnapshot(2, newPeerSync(), opts));
  guestGame();
  applySnapshot(m, false);
  assert.equal(S.myId, 2);
  assert.equal(S.ships[2].fuel, 4321);
  assert.deepEqual(S.ships[2].pos, [10, 20]);
  assert.equal(S.torps.length, 1);
  assert.equal(S.torps[0].team, 0);
});

test('эффекты и облака уходят каждому гостю один раз, у каждого гостя — свой учёт', () => {
  hostGame();
  fireFlak(S.ships[0], 0);
  addFx({ kind: 'boom', pos: [0, 0], dur: 4, r: 100, team: 0 });
  const a = newPeerSync(), b = newPeerSync();
  const m1 = makeSnapshot(2, a, opts);
  assert.equal(m1.fl.length, 1); assert.equal(m1.fl[0].p.length, 70); assert.equal(m1.fx.length, 2);
  const m2 = makeSnapshot(2, a, opts);
  assert.equal(m2.fl.length, 0); assert.equal(m2.fx.length, 0);
  const mb = makeSnapshot(3, b, opts);
  assert.equal(mb.fl.length, 1, 'второй гость получает облако сам');
});

test('сбитые шарики доходят до гостя один раз, лишнее хост забывает', () => {
  hostGame();
  S.hitLog.push([5, 1, ++S.hitSeq], [5, 2, ++S.hitSeq]);
  const a = newPeerSync(), b = newPeerSync();
  assert.deepEqual(makeSnapshot(2, a, opts).pd, [[5, 1], [5, 2]]);
  assert.deepEqual(makeSnapshot(2, a, opts).pd, []);
  pruneHitLog(Math.min(a.hitSeq, b.hitSeq));
  assert.equal(S.hitLog.length, 2, 'второй гость их ещё не получил');
  makeSnapshot(3, b, opts);
  pruneHitLog(Math.min(a.hitSeq, b.hitSeq));
  assert.equal(S.hitLog.length, 0);
});

test('погибший гость смотрит глазами живого союзника', () => {
  hostGame();
  S.ships[2].alive = false;
  S.tracks[3][0].exact = true; S.tracks[2][0].exact = false;
  const m = wire(makeSnapshot(2, newPeerSync(), opts));
  assert.equal(m.eye, 3);
  assert.ok(m.ships[0].pos, 'противника видит союзник');
  guestGame();
  applySnapshot(m, false);
  assert.equal(S.tracks[3][0].exact, true);
});

test('ползунок гостя не откатывается, пока хост не подтвердил приказ', () => {
  hostGame();
  const m = wire(makeSnapshot(2, newPeerSync(), opts));
  guestGame();
  S.ships[2].issuedThrottle = 5;
  applySnapshot(m, true);
  assert.equal(S.ships[2].issuedThrottle, 5);
  applySnapshot(m, false);
  assert.equal(S.ships[2].issuedThrottle, 0);
});

test('конец боя доходит до гостя со своим итогом', () => {
  hostGame();
  S.over = true;
  const m = wire(makeSnapshot(2, newPeerSync(), { ...opts, result: ['res.win.team'] }));
  guestGame();
  applySnapshot(m, false);
  assert.equal(S.over, true);
  assert.equal(S.resultKey[0], 'res.win.team');
  assert.equal(S.result, 'Победа: все корабли противника уничтожены', 'гость переводит итог на свой язык');
  assert.equal(S.ships[2].fuel, SHIP.dv);
});

test('состав от хоста проверяется', () => {
  const r = netRoster(wire(ROSTER));
  assert.equal(r.length, 4);
  assert.deepEqual(r.map(x => x.team), [0, 0, 1, 1]);
  assert.equal(r[2].owner, 'G');
  assert.equal(netRoster(null), null);
  assert.equal(netRoster([{ team: 0 }]), null, 'в команде красных никого');
  assert.equal(netRoster(Array(11).fill({ team: 0 })), null);
  assert.equal(netRoster([{ team: 0, ctrl: 'root', name: 'x'.repeat(40) }, { team: 1 }])[0].ctrl, 'ai');
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
