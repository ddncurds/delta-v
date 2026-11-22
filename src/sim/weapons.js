// Оружие: торпеды, облако шариков и выхлоп двигателя как оружие ближнего боя.
// Своих оружие не задевает: шарики, осколки и факел опасны только кораблям и торпедам другой команды
import { FLAK, TORP, PLUME, D2R } from '../config.js';
import { clamp, dist, closestDist, solveIntercept } from '../lib/math.js';
import { S, sayTo, addFx } from './state.js';
import { gravAt, bodyHit } from './bodies.js';
import { nearestThreat, targetTrack, noteFlak } from './sensors.js';
import { killShip } from './ship.js';

// угол выстрела облаком по ближайшей вражеской торпеде с упреждением; null, если торпед нет
export function autoAim(s) {
  const th = nearestThreat(s);
  if (!th) return null;
  return solveIntercept(s.pos, s.vel, th.t.pos, th.t.vel, FLAK.speed);
}

export function fireFlak(s, ang) {
  if (s.flak <= 0 || s.flakCd > 0) { sayTo(s.id, 'msg.flakNotReady'); return false; }
  s.flak--; s.flakCd = FLAK.cd;
  s.fuel = Math.max(0, s.fuel - FLAK.mass);
  if (s.flakTimer <= 0) s.flakTimer = FLAK.recharge;
  // уставший экипаж целится хуже
  const jit = s.crew ? Math.max(0, (s.stress - 60) / 40) * 4 * D2R : 0;
  const base = ang + (Math.random() * 2 - 1) * jit;
  const spread = s.spread, b = S.nextId++;
  for (let i = 0; i < FLAK.n; i++) {
    const a = base + (Math.random() * 2 - 1) * spread;
    const sp = FLAK.speed * (0.85 + Math.random() * 0.3);
    S.pellets.push({ owner: s.id, team: s.team, age: 0, dead: false, b, i,
      pos: [s.pos[0], s.pos[1]],
      vel: [s.vel[0] + Math.cos(a) * sp, s.vel[1] + Math.sin(a) * sp] });
  }
  s.vel[0] -= Math.cos(base) * FLAK.recoil; s.vel[1] -= Math.sin(base) * FLAK.recoil;
  addFx({ kind: 'puff', pos: [s.pos[0], s.pos[1]], dur: 2, r: 1500, team: s.team });
  noteFlak(s);
  return true;
}

// ang — начальный курс торпеды; по умолчанию прямо на цель по треку
export function launchTorp(s, ang) {
  if (s.torps <= 0) { sayTo(s.id, 'msg.noTorps'); return false; }
  const tr = targetTrack(s);
  if (!tr) { sayTo(s.id, 'msg.noTorpTarget'); return false; }
  s.torps--; S.stats[s.id].launched++;
  ang ??= Math.atan2(tr.pos[1] - s.pos[1], tr.pos[0] - s.pos[0]);
  S.torps.push({ id: S.nextId++, owner: s.id, team: s.team, target: s.targetId, pos: [s.pos[0], s.pos[1]],
    vel: [s.vel[0] + Math.cos(ang) * 100, s.vel[1] + Math.sin(ang) * 100],
    fuel: TORP.dv, age: 0, alive: true, hits: 0, heat: 0, acc: 0, trail: [], lastTrail: 0 });
  const tgt = S.ships[s.targetId];
  sayTo(s.id, 'msg.torpLaunched', { name: tgt.name }); sayTo(tgt.id, 'msg.enemyLaunched', { name: s.name });
  return true;
}

// цель погибла раньше торпеды: торпеда берёт ближайший живой корабль противника по данным пустившего её корабля
function retarget(t) {
  let best = -1, bd = Infinity;
  for (const e of S.ships) {
    if (!e.alive || e.team === t.team) continue;
    const d = dist(t.pos, S.tracks[t.owner][e.id].pos);
    if (d < bd) { bd = d; best = e.id; }
  }
  t.target = best;
  return best >= 0;
}

// торпеда: пропорциональное наведение по треку цели, вблизи — по головке самонаведения.
// У торпеды запас Δv ограничен
export function stepTorp(t, dt) {
  if (!S.ships[t.target]?.alive && !retarget(t)) { fizzle(t); return; }
  const tgt = S.ships[t.target], tr = S.tracks[t.owner][t.target];
  let tp = tr.pos, tv = tr.vel;
  if (dist(t.pos, tgt.pos) < TORP.seeker) { tp = tgt.pos; tv = tgt.vel; }
  const rx = tp[0] - t.pos[0], ry = tp[1] - t.pos[1];
  const R = Math.max(Math.hypot(rx, ry), 1);
  const lx = rx / R, ly = ry / R;
  const vx = tv[0] - t.vel[0], vy = tv[1] - t.vel[1];
  const Vc = -(rx * vx + ry * vy) / R;
  const lamd = (rx * vy - ry * vx) / (R * R);
  const lat = clamp(TORP.N * Math.max(Vc, 300) * lamd, -TORP.acc, TORP.acc);
  const lon = Vc < TORP.vmin ? Math.sqrt(Math.max(0, TORP.acc * TORP.acc - lat * lat)) : 0;
  let ax = lx * lon - ly * lat, ay = ly * lon + lx * lat;
  let a = Math.hypot(ax, ay);
  if (t.fuel <= 0) { ax = ay = a = 0; }
  else if (a * dt > t.fuel) { const k = t.fuel / (a * dt); ax *= k; ay *= k; a *= k; }
  t.fuel = Math.max(0, t.fuel - a * dt);
  t.acc = a;
  const vx0 = t.vel[0], vy0 = t.vel[1], g = gravAt(t.pos[0], t.pos[1]);
  t.vel[0] += (ax + g[0]) * dt; t.vel[1] += (ay + g[1]) * dt;
  t.pos[0] += (vx0 + t.vel[0]) / 2 * dt; t.pos[1] += (vy0 + t.vel[1]) / 2 * dt;
  t.age += dt;
  const hb = bodyHit(t.pos[0], t.pos[1]);
  if (hb) {
    fizzle(t);
    sayTo(t.owner, 'msg.torpCrashed', { body: hb.name });
    return;
  }
  if (t.age - t.lastTrail >= 1) { t.lastTrail = t.age; t.trail.push([t.pos[0], t.pos[1]]); if (t.trail.length > 90) t.trail.shift(); }
  if (t.age > 2) {
    // взрыватель срабатывает рядом с любым кораблём противника, не только с целью
    for (const e of S.ships) {
      if (!e.alive || e.team === t.team) continue;
      const rvx = t.vel[0] - e.vel[0], rvy = t.vel[1] - e.vel[1];
      if (closestDist(t.pos[0] - e.pos[0] - rvx * dt, t.pos[1] - e.pos[1] - rvy * dt, rvx, rvy, dt) < TORP.blast) {
        t.alive = false;
        killShip(e, 'torp', t.team);
        sayTo(t.owner, 'msg.torpHit', { name: e.name });
        return;
      }
    }
    // промах: торпеда прошла точку минимального сближения с целью. Развернуться ей не хватит Δv, поэтому она взрывается
    const rvx = t.vel[0] - tgt.vel[0], rvy = t.vel[1] - tgt.vel[1];
    const px = t.pos[0] - tgt.pos[0] - rvx * dt, py = t.pos[1] - tgt.pos[1] - rvy * dt;
    const closingStart = px * rvx + py * rvy < 0, closingEnd = (px + rvx * dt) * rvx + (py + rvy * dt) * rvy < 0;
    if (closingStart && !closingEnd) {
      detonateMiss(t, tgt, closestDist(px, py, rvx, rvy, dt));
      return;
    }
  }
  if (t.fuel <= 0 && Vc < 0) fizzle(t);
  else if (t.age > 600) t.alive = false;
}

function fizzle(t) {
  t.alive = false;
  addFx({ kind: 'fizz', pos: [t.pos[0], t.pos[1]], dur: 2, r: 1200, team: t.team });
}

// подрыв при промахе: осколки разлетаются кольцом, по кораблю попадает доля, обратная расстоянию
function detonateMiss(t, tgt, dmin) {
  t.alive = false;
  const p = dmin < TORP.fuse ? Math.min(1, 2 * FLAK.shipR / (2 * Math.PI * Math.max(dmin, 50))) : 0;
  let hits = 0;
  for (let i = 0; i < TORP.frags; i++) if (Math.random() < p) hits++;
  const dmg = hits * TORP.fragDmg;
  addFx({ kind: 'frag', pos: [t.pos[0], t.pos[1]], dur: 2.5, r: Math.min(3000, Math.max(900, dmin * 1.4)), team: t.team });
  const dist = Math.round(dmin);
  if (dmg > 0) {
    tgt.hp -= dmg;
    sayTo(t.owner, 'msg.fragOwn', { dist, name: tgt.name, dmg });
    sayTo(tgt.id, 'msg.fragHit', { dist, dmg });
    if (tgt.hp <= 0) killShip(tgt, 'frag', t.team);
  } else {
    sayTo(t.owner, 'msg.missOwn', { dist });
    sayTo(tgt.id, 'msg.missHit', { dist });
  }
}

export function stepPellets(dt) {
  const hitNow = new Map();   // корабль → кто по нему попал
  for (const p of S.pellets) {
    p.age += dt;
    const g = gravAt(p.pos[0], p.pos[1]);
    p.vel[0] += g[0] * dt; p.vel[1] += g[1] * dt;
    p.pos[0] += p.vel[0] * dt; p.pos[1] += p.vel[1] * dt;
    if (p.age > FLAK.life || bodyHit(p.pos[0], p.pos[1])) { p.dead = true; continue; }
    for (const tg of S.ships) {
      if (!tg.alive || tg.team === p.team) continue;
      const svx = p.vel[0] - tg.vel[0], svy = p.vel[1] - tg.vel[1];
      if (closestDist(p.pos[0] - tg.pos[0] - svx * dt, p.pos[1] - tg.pos[1] - svy * dt, svx, svy, dt) >= FLAK.shipR) continue;
      p.dead = true; tg.hp -= FLAK.dmg; hitNow.set(tg, p.owner);
      logHit(p);
      if (tg.hp <= 0) killShip(tg, 'flak', p.team);
      break;
    }
    if (p.dead) continue;
    for (const t of S.torps) {
      if (!t.alive || t.team === p.team) continue;
      const rvx = p.vel[0] - t.vel[0], rvy = p.vel[1] - t.vel[1];
      const px = p.pos[0] - t.pos[0] - rvx * dt, py = p.pos[1] - t.pos[1] - rvy * dt;
      if (closestDist(px, py, rvx, rvy, dt) < FLAK.hitR) {
        p.dead = true; t.hits++;
        logHit(p);
        if (t.hits >= FLAK.kill) {
          t.alive = false;
          addFx({ kind: 'burst', pos: [t.pos[0], t.pos[1]], dur: 2.5, r: 2500, team: t.team });
          if (S.stats[p.owner]) S.stats[p.owner].kills++;
          sayTo(p.owner, 'msg.torpDowned'); sayTo(t.owner, 'msg.ownTorpDowned');
        }
        break;
      }
    }
  }
  S.pellets = S.pellets.filter(p => !p.dead);
  for (const [tg, by] of hitNow) {
    if (S.t - S.lastHit[tg.id] > 2) {
      S.lastHit[tg.id] = S.t;
      sayTo(tg.id, 'msg.flakHitMe'); sayTo(by, 'msg.flakHitThem', { name: tg.name });
    }
  }
}

// шарик пропал от попадания: сетевым гостям надо убрать его у себя
function logHit(p) { if (S.mp) S.hitLog.push([p.b, p.i, ++S.hitSeq]); }

// насколько точка p внутри факела корабля s: 0 — вне факела, 1 — у самого сопла
export function plumeFactor(s, p) {
  if (s.accG < 0.5) return 0;
  const L = PLUME.perG * s.accG;
  const dx = p[0] - s.pos[0], dy = p[1] - s.pos[1];
  const ax = -Math.cos(s.heading), ay = -Math.sin(s.heading);
  const d = dx * ax + dy * ay;
  if (d <= 0 || d > L) return 0;
  const lat = Math.abs(-dx * ay + dy * ax);
  if (lat > PLUME.base + d * Math.tan(PLUME.half)) return 0;
  return 1 - d / L;
}

export function stepPlumes(dt) {
  for (const s of S.ships) {
    if (!s.alive || s.accG < 0.5) continue;
    for (const t of S.torps) {
      if (!t.alive || t.team === s.team) continue;
      const f = plumeFactor(s, t.pos);
      if (f <= 0) continue;
      t.heat += PLUME.rate * s.accG * f * dt;
      if (t.heat >= PLUME.melt) {
        t.alive = false;
        addFx({ kind: 'melt', pos: [t.pos[0], t.pos[1]], dur: 2.5, r: 2500, team: t.team });
        S.stats[s.id].kills++;
        sayTo(s.id, 'msg.torpMelted'); sayTo(t.owner, 'msg.ownTorpMelted');
      }
    }
    for (const tgt of S.ships) {
      if (!tgt.alive || tgt.team === s.team) continue;
      const f = plumeFactor(s, tgt.pos);
      if (f <= 0) continue;
      tgt.hp -= PLUME.shipRate * s.accG * f * dt;
      if (S.t - S.lastHit[tgt.id] > 2) { S.lastHit[tgt.id] = S.t; sayTo(tgt.id, 'msg.plumeMe'); sayTo(s.id, 'msg.plumeThem', { name: tgt.name }); }
      if (tgt.hp <= 0) killShip(tgt, 'plume', s.team);
    }
  }
}
