// ИИ кораблей: защита от торпед, обход тел, расход боезапаса (plans/ai.md, Т-1…Т-5)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DT, G0 } from '../src/config.js';
import { S, step, setSayHook } from '../src/sim/index.js';
import { newAi } from '../src/sim/ai.js';
import { emptySpace, runFor, putTorp, me, foe } from './helpers.js';

// ИИ ведёт корабль 1 (красные) в точке [0, 0]; противник (корабль 0) — в точке mePos
function aiDuel(mePos = [1e8, 1e8], ai = {}) {
  emptySpace({ me: mePos, foe: [0, 0] });
  foe().ai = Object.assign(newAi(), { nextSalvo: 1e9, nextNudge: 1e9, nextRetarget: 1e9 }, ai);
  return foe();
}

// сообщения экипажам за время теста
function said() {
  const log = [];
  setSayHook((id, key) => log.push([id, key]));
  return log;
}

test('Т-1: торпеда в 5 с — ИИ отвечает выхлопом кормой к ней', { todo: 'этап 1' }, () => {
  const f = aiDuel();
  putTorp(0, [10000, 0], [-2000, 0]);
  step(DT);
  assert.ok(f.aimAway, 'выхлоп не запущен');
  assert.ok(f.cmdThrottle > 0);
});

test('Т-2: уклонение не прерывает выхлоп', { todo: 'этап 1' }, () => {
  const f = aiDuel(), log = said();
  putTorp(0, [10000, 0], [-2000, 0]);
  step(DT);
  assert.ok(f.aimAway);
  const end = f.burnEnd;
  // вторая торпеда в окне уклонения
  putTorp(0, [0, 24000], [0, -2000]);
  while (S.t < end - DT && f.alive) { step(DT); assert.ok(f.aimAway, `выхлоп прерван на ${S.t.toFixed(2)} с`); }
  assert.ok(!log.some(([id, k]) => id === f.id && k === 'msg.dodge'));
  setSayHook(() => {});
});

test('Т-3: корабль, летящий в тело, отворачивает', () => {
  const f = aiDuel();
  S.bodies = [{ kind: 'planet', name: 'X', pos: [60000, 0], r: 20000, mu: 1 * G0 * 20000 ** 2 }];
  f.vel = [800, 0]; f.ai.nextGeo = 0;
  step(DT);
  assert.ok(f.cmdThrottle > 0, 'ИИ не включил двигатель');
  runFor(120);
  assert.ok(f.alive, 'ИИ разбился о тело');
});

test('Т-4: без зарядов облака ИИ не стреляет, без торпед — не пускает залп', () => {
  const f = aiDuel([60000, 0], { nextSalvo: 0 });
  f.flak = 0; f.torps = 0;
  putTorp(0, [30000, 0], [-1500, 0]);
  runFor(3);
  assert.equal(S.pellets.length, 0);
  assert.equal(S.torps.filter(t => t.team === f.team).length, 0);
});
