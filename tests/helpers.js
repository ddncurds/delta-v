// Общие заготовки для тестов симуляции
import { DT } from '../src/config.js';
import { S, newGame, step } from '../src/sim/index.js';
import { newTrack } from '../src/sim/sensors.js';

// в дуэли корабль 0 — игрок (синие), корабль 1 — противник (красные)
export const me = () => S.ships[0];
export const foe = () => S.ships[1];

// треки всех кораблей заново: каждый точно видит каждого противника
export function resetTracks() {
  S.tracks = S.ships.map(o => S.ships.map(e => e.team !== o.team ? newTrack(e) : null));
}

// пустой космос, дуэль: без тел, противник далеко и без ИИ, экипажи не устают
export function emptySpace({ me: p = [0, 0], meVel = [0, 0], foe: f = [1e8, 1e8], foeVel = [0, 0], crew = false } = {}) {
  newGame();
  S.bodies = [];
  Object.assign(S.ships[0], { pos: [...p], vel: [...meVel], crew, targetId: 1 });
  Object.assign(S.ships[1], { pos: [...f], vel: [...foeVel], ai: null, crew: false, targetId: 0 });
  resetTracks();
  return S;
}

// прогнать симуляцию на sec секунд (или до конца боя)
export function runFor(sec) {
  for (let i = 0, n = Math.round(sec / DT); i < n && !S.over; i++) step(DT);
}

// торпеда корабля owner в точке pos со скоростью vel; цель — первый корабль другой команды
export function putTorp(owner, pos, vel = [0, 0], extra = {}) {
  const team = S.ships[owner].team, target = S.ships.find(s => s.team !== team).id;
  const t = { id: S.nextId++, owner, team, target, pos: [...pos], vel: [...vel], fuel: 3900, age: 0, alive: true, hits: 0, heat: 0, acc: 0,
    trail: [], lastTrail: 0, ...extra };
  S.torps.push(t);
  return t;
}
