// Общие заготовки для тестов симуляции
import { DT } from '../src/config.js';
import { S, newGame, step } from '../src/sim/index.js';

// пустой космос: без тел, противник далеко и без ИИ, экипажи не устают
export function emptySpace({ me = [0, 0], meVel = [0, 0], foe = [1e8, 1e8], foeVel = [0, 0], crew = false } = {}) {
  newGame();
  S.bodies = [];
  S.me.pos = [...me]; S.me.vel = [...meVel]; S.me.crew = crew;
  S.foe.pos = [...foe]; S.foe.vel = [...foeVel]; S.foe.ai = null; S.foe.crew = false;
  S.tracks.me = { pos: [...S.foe.pos], vel: [...S.foe.vel], seenT: 0, exact: true };
  S.tracks.foe = { pos: [...S.me.pos], vel: [...S.me.vel], seenT: 0, exact: true };
  return S;
}

// прогнать симуляцию на sec секунд (или до конца боя)
export function runFor(sec) {
  for (let i = 0, n = Math.round(sec / DT); i < n && !S.over; i++) step(DT);
}

// торпеда стороны owner в точке pos со скоростью vel
export function putTorp(owner, pos, vel = [0, 0], extra = {}) {
  const t = { id: S.nextId++, owner, pos: [...pos], vel: [...vel], fuel: 3900, age: 0, alive: true, hits: 0, heat: 0, acc: 0,
    trail: [], lastTrail: 0, ...extra };
  S.torps.push(t);
  return t;
}
