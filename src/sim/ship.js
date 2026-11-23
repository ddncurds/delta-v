// Корабль: создание, манёвры и шаг движения. Тяга расходует топливо (запас Δv),
// перегрузка копит усталость экипажа, а усталость замедляет выполнение приказов
import { G0, SHIP, FLAK, D2R } from '../config.js';
import { clamp, wrap } from '../lib/math.js';
import { S, sayTo, addFx } from './state.js';
import { fly, bodyHit } from './bodies.js';
import { nearestThreat, targetTrack } from './sensors.js';

// spec: id, team, name, ctrl ('human' или 'ai'), owner — чей компьютер управляет кораблём в сетевом бою.
// Экипаж, который устаёт от перегрузок, есть только у кораблей людей
export function newShip(x, y, h, spec) {
  return { id: spec.id, team: spec.team, name: spec.name, ctrl: spec.ctrl, owner: spec.owner || '',
    pos: [x, y], vel: [0, 0], heading: h, cmdHeading: h, cmdThrottle: 0,
    issuedThrottle: 0, issuedHeading: h, accG: 0, fuel: SHIP.dv, stress: 0,
    hp: 100, deathBy: '', aimAway: false, torps: SHIP.torps, flak: FLAK.charges, flakTimer: 0, flakCd: 0, orders: [], alive: true,
    crew: spec.ctrl === 'human', targetId: -1, spread: 5 * D2R, burnEnd: -1, ai: null };
}

export function reactionDelay(s) { if (!s.crew) return 0; const st = s.stress; return st > 40 ? (st - 40) / 60 * 2.5 : 0; }

// манёвр на заданное время: курс, тяга, длительность
export function startBurn(s, ang, g, dur) {
  s.cmdHeading = ang; s.cmdThrottle = g; s.burnEnd = S.t + dur;
  s.issuedThrottle = g; s.issuedHeading = ang;
}

// уклонение: рывок поперёк линии на торпеду (или на цель), в ту сторону, куда уже сносит
export function doDodge(s) {
  const th = nearestThreat(s), tr = th ? th.t : targetTrack(s);
  if (!tr) { sayTo(s.id, 'msg.noDodge'); return; }
  const lx = tr.pos[0] - s.pos[0], ly = tr.pos[1] - s.pos[1];
  const rvx = s.vel[0] - tr.vel[0], rvy = s.vel[1] - tr.vel[1];
  const R = Math.hypot(lx, ly) || 1;
  const px = -ly / R, py = lx / R;
  const sg = (rvx * px + rvy * py) >= 0 ? 1 : -1;
  startBurn(s, Math.atan2(py * sg, px * sg), 6, 5);
  sayTo(s.id, 'msg.dodge');
}

// курс кормой на ближайшую торпеду или на цель; без них — прежний курс
export function awayAngle(s) {
  const th = nearestThreat(s), tr = th ? th.t : targetTrack(s);
  if (!tr) return s.cmdHeading;
  return Math.atan2(-(tr.pos[1] - s.pos[1]), -(tr.pos[0] - s.pos[0]));
}

export function doPlume(s) {
  startBurn(s, awayAngle(s), 7, 6);
  s.aimAway = true;
  sayTo(s.id, 'msg.plume');
}

// гибель корабля: причина, вспышка на карте
export function killShip(s, why, byTeam) {
  s.alive = false; s.hp = 0; s.deathBy = why;
  addFx({ kind: 'boom', pos: [s.pos[0], s.pos[1]], dur: 4, r: 6000, team: byTeam });
}

// срок манёвра вышел: двигатель глохнет. now — время боя
export function endBurnIfDue(s, now) {
  if (s.burnEnd > 0 && now >= s.burnEnd) { s.cmdThrottle = 0; s.burnEnd = -1; s.aimAway = false; s.issuedThrottle = 0; }
}

// поворот к заданному курсу, тяга вдоль текущего курса, расход топлива и шаг в поле тяжести.
// Прогноз манёвра (plan.js) зовёт эту же функцию, поэтому план совпадает с исполнением
export function propel(s, dt) {
  const m = SHIP.turn * dt;
  s.heading = wrap(s.heading + clamp(wrap(s.cmdHeading - s.heading), -m, m));
  let a = clamp(s.cmdThrottle, 0, SHIP.maxG) * G0;
  if (s.fuel <= 0) a = 0; else if (a * dt > s.fuel) a = s.fuel / dt;
  s.fuel = Math.max(0, s.fuel - a * dt);
  s.accG = a / G0;
  fly(s.pos, s.vel, Math.cos(s.heading) * a, Math.sin(s.heading) * a, dt);
}

// усталость экипажа: копится от перегрузки от 3 g, спадает ниже 1,5 g
export function strain(s, dt) {
  if (!s.crew) return;
  const g = s.accG;
  if (g >= 3) s.stress += Math.pow(g - 2.5, 1.6) * 0.5 * dt;
  else if (g < 1.5) s.stress = Math.max(0, s.stress - 1.2 * dt);
}

export function stepShip(s, dt) {
  if (!s.alive) return;
  endBurnIfDue(s, S.t);
  if (s.aimAway) { s.cmdHeading = awayAngle(s); s.issuedHeading = s.cmdHeading; }
  propel(s, dt);
  const hb = bodyHit(s.pos[0], s.pos[1]);
  if (hb) {
    killShip(s, 'crash', 1 - s.team);
    for (const o of S.ships) if (o !== s) sayTo(o.id, o.team === s.team ? 'msg.allyCrashed' : 'msg.enemyCrashed', { name: s.name, body: hb.name });
    return;
  }
  s.flakCd = Math.max(0, s.flakCd - dt);
  if (s.flak < FLAK.charges && s.flakTimer > 0) {
    s.flakTimer -= dt;
    if (s.flakTimer <= 0) { s.flak++; s.flakTimer = s.flak < FLAK.charges ? FLAK.recharge : 0; }
  }
  strain(s, dt);
}
