// Корабль: создание, манёвры и шаг движения. Тяга расходует топливо (запас Δv),
// перегрузка копит усталость экипажа, а усталость замедляет выполнение приказов
import { G0, SHIP, FLAK, D2R, FX_CONFIG } from '../config.js';
import { clamp, wrap } from '../lib/math.js';
import { S, sayTo, addFx } from './state.js';
import { fly, bodyHit } from './bodies.js';
import { nearestThreat, targetTrack } from './sensors.js';
import { spawnDebris } from './debris.js';

// spec: id, team, name, ctrl ('human' или 'ai'), owner — чей компьютер управляет кораблём в сетевом бою.
// Экипаж, который устаёт от перегрузок, есть только у кораблей людей
export function newShip(x, y, h, spec) {
  return { id: spec.id, team: spec.team, name: spec.name, ctrl: spec.ctrl, owner: spec.owner || '',
    pos: [x, y], vel: [0, 0], heading: h, cmdHeading: h, cmdThrottle: 0,
    issuedThrottle: 0, issuedHeading: h, accG: 0, fuel: SHIP.dv, stress: 0,
    hp: 100, deathBy: '', aimAway: false, torps: SHIP.torps, torpTimer: 0, flak: FLAK.charges, flakTimer: 0, flakCd: 0, orders: [], alive: true,
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

// сила взрыва корабля: от торпеды рвутся баки — чем больше топлива, тем сильнее (до взрыва реактора)
export function shipEnergy(s, why) {
  const E = FX_CONFIG.energy;
  return why === 'torp' ? E.torp + s.fuel / SHIP.dv : E[why] ?? E.ship;
}

// гибель корабля: причина, взрыв на карте и обломки корпуса. По сети уходит только событие взрыва:
// скорость, сила, курс корпуса и seed — обломки каждый строит сам
export function killShip(s, why, byTeam) {
  s.alive = false; s.hp = 0; s.deathBy = why;
  const f = { kind: 'boom', pos: [s.pos[0], s.pos[1]], dur: 4, r: 6000, team: byTeam,
    vel: [s.vel[0], s.vel[1]], en: shipEnergy(s, why), h: s.heading, hull: s.team, seed: (Math.random() * 2 ** 32) >>> 0 };
  addFx(f);
  spawnDebris(f);
}

export function stepShip(s, dt) {
  if (!s.alive) return;
  if (s.burnEnd > 0 && S.t >= s.burnEnd) { s.cmdThrottle = 0; s.burnEnd = -1; s.aimAway = false; s.issuedThrottle = 0; }
  if (s.aimAway) { s.cmdHeading = awayAngle(s); s.issuedHeading = s.cmdHeading; }
  const m = SHIP.turn * dt;
  s.heading = wrap(s.heading + clamp(wrap(s.cmdHeading - s.heading), -m, m));
  let a = clamp(s.cmdThrottle, 0, SHIP.maxG) * G0;
  if (s.fuel <= 0) a = 0; else if (a * dt > s.fuel) a = s.fuel / dt;
  s.fuel = Math.max(0, s.fuel - a * dt);
  s.accG = a / G0;
  fly(s.pos, s.vel, Math.cos(s.heading) * a, Math.sin(s.heading) * a, dt);
  const hb = bodyHit(s.pos[0], s.pos[1]);
  if (hb) {
    killShip(s, 'crash', 1 - s.team);
    for (const o of S.ships) if (o !== s) sayTo(o.id, o.team === s.team ? 'msg.allyCrashed' : 'msg.enemyCrashed', { name: s.name, body: hb.name });
    return;
  }
  s.flakCd = Math.max(0, s.flakCd - dt);
  // запас торпед пополняется по одной, пока не станет полным
  if (s.torps < SHIP.torps && s.torpTimer > 0) {
    s.torpTimer -= dt;
    if (s.torpTimer <= 0) { s.torps++; s.torpTimer = s.torps < SHIP.torps ? SHIP.torpReload : 0; }
  }
  if (s.flak < FLAK.charges && s.flakTimer > 0) {
    s.flakTimer -= dt;
    if (s.flakTimer <= 0) { s.flak++; s.flakTimer = s.flak < FLAK.charges ? FLAK.recharge : 0; }
  }
  if (s.crew) {
    const g = s.accG;
    if (g >= 3) s.stress += Math.pow(g - 2.5, 1.6) * 0.5 * dt;
    else if (g < 1.5) s.stress = Math.max(0, s.stress - 1.2 * dt);
  }
}
