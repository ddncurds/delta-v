// Корабль: создание, манёвры и шаг движения. Топлива нет — реактор даёт тягу без ограничений,
// зато перегрузка копит усталость экипажа, а усталость замедляет выполнение приказов
import { G0, SHIP, FLAK, D2R } from '../config.js';
import { clamp, wrap } from '../lib/math.js';
import { S, sayTo, other } from './state.js';
import { fly, bodyHit } from './bodies.js';
import { nearestThreat } from './sensors.js';

export function newShip(x, y, h, key, crew) {
  return { pos: [x, y], vel: [0, 0], heading: h, cmdHeading: h, cmdThrottle: 0,
    issuedThrottle: 0, issuedHeading: h, accG: 0, stress: 0,
    hp: 100, deathBy: '', aimAway: false, torps: SHIP.torps, flak: FLAK.charges, flakTimer: 0, flakCd: 0, orders: [], alive: true,
    key, isPlayer: key === 'me', crew, spread: 5 * D2R, burnEnd: -1, ai: null };
}

export function reactionDelay(s) { if (!s.crew) return 0; const st = s.stress; return st > 40 ? (st - 40) / 60 * 2.5 : 0; }

// манёвр на заданное время: курс, тяга, длительность
export function startBurn(s, ang, g, dur) {
  s.cmdHeading = ang; s.cmdThrottle = g; s.burnEnd = S.t + dur;
  s.issuedThrottle = g; s.issuedHeading = ang;
}

// уклонение: рывок поперёк линии на торпеду (или на противника), в ту сторону, куда уже сносит
export function doDodge(s, key) {
  const th = nearestThreat(key);
  let lx, ly, rvx, rvy;
  if (th) {
    lx = th.t.pos[0] - s.pos[0]; ly = th.t.pos[1] - s.pos[1];
    rvx = s.vel[0] - th.t.vel[0]; rvy = s.vel[1] - th.t.vel[1];
  } else {
    const tr = S.tracks[key];
    lx = tr.pos[0] - s.pos[0]; ly = tr.pos[1] - s.pos[1];
    rvx = s.vel[0] - tr.vel[0]; rvy = s.vel[1] - tr.vel[1];
  }
  const R = Math.hypot(lx, ly) || 1;
  const px = -ly / R, py = lx / R;
  const sg = (rvx * px + rvy * py) >= 0 ? 1 : -1;
  startBurn(s, Math.atan2(py * sg, px * sg), 6, 5);
  sayTo(key, 'Уклонение: 6 g, 5 с');
}

// курс кормой на ближайшую торпеду или на противника
export function awayAngle(s, key) {
  const th = nearestThreat(key);
  const p = th ? th.t.pos : S.tracks[key].pos;
  return Math.atan2(-(p[1] - s.pos[1]), -(p[0] - s.pos[0]));
}

export function doPlume(s, key) {
  startBurn(s, awayAngle(s, key), 7, 6);
  s.aimAway = true;
  sayTo(key, 'Выхлоп на цель: 7 g, 6 с');
}

export function stepShip(s, dt) {
  if (!s.alive) return;
  if (s.burnEnd > 0 && S.t >= s.burnEnd) { s.cmdThrottle = 0; s.burnEnd = -1; s.aimAway = false; s.issuedThrottle = 0; }
  if (s.aimAway) { s.cmdHeading = awayAngle(s, s.key); s.issuedHeading = s.cmdHeading; }
  const m = SHIP.turn * dt;
  s.heading = wrap(s.heading + clamp(wrap(s.cmdHeading - s.heading), -m, m));
  const a = clamp(s.cmdThrottle, 0, SHIP.maxG) * G0;
  s.accG = a / G0;
  fly(s.pos, s.vel, Math.cos(s.heading) * a, Math.sin(s.heading) * a, dt);
  const hb = bodyHit(s.pos[0], s.pos[1]);
  if (hb) {
    s.alive = false; s.hp = 0; s.deathBy = 'crash';
    S.fx.push({ kind: 'boom', pos: [s.pos[0], s.pos[1]], t0: S.t, dur: 4, r: 6000, owner: other(s.key) });
    sayTo(other(s.key), 'Корабль противника разбился о ' + hb.name);
    return;
  }
  s.flakCd = Math.max(0, s.flakCd - dt);
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
