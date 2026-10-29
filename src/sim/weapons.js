// Оружие: торпеды, облако шариков и выхлоп двигателя как оружие ближнего боя
import { FLAK, TORP, PLUME, D2R } from '../config.js';
import { clamp, dist, closestDist, solveIntercept } from '../lib/math.js';
import { S, sayTo, other, shipOf } from './state.js';
import { gravAt, bodyHit } from './bodies.js';
import { nearestThreat } from './sensors.js';

// угол выстрела облаком по ближайшей вражеской торпеде с упреждением; null, если торпед нет
export function autoAim(key) {
  const th = nearestThreat(key);
  if (!th) return null;
  const s = shipOf(key);
  return solveIntercept(s.pos, s.vel, th.t.pos, th.t.vel, FLAK.speed);
}

export function fireFlak(s, key, ang) {
  if (s.flak <= 0 || s.flakCd > 0) { sayTo(key, 'Облако не готово'); return false; }
  s.flak--; s.flakCd = FLAK.cd;
  if (s.flakTimer <= 0) s.flakTimer = FLAK.recharge;
  // уставший экипаж целится хуже
  const jit = s.crew ? Math.max(0, (s.stress - 60) / 40) * 4 * D2R : 0;
  const base = ang + (Math.random() * 2 - 1) * jit;
  const spread = s.spread, b = S.nextId++;
  for (let i = 0; i < FLAK.n; i++) {
    const a = base + (Math.random() * 2 - 1) * spread;
    const sp = FLAK.speed * (0.85 + Math.random() * 0.3);
    S.pellets.push({ owner: key, age: 0, dead: false, b, i,
      pos: [s.pos[0], s.pos[1]],
      vel: [s.vel[0] + Math.cos(a) * sp, s.vel[1] + Math.sin(a) * sp] });
  }
  s.vel[0] -= Math.cos(base) * FLAK.recoil; s.vel[1] -= Math.sin(base) * FLAK.recoil;
  S.fx.push({ kind: 'puff', pos: [s.pos[0], s.pos[1]], t0: S.t, dur: 2, r: 1500, owner: key });
  return true;
}

export function launchTorp(s, key) {
  if (s.torps <= 0) { sayTo(key, 'Торпеды закончились'); return false; }
  s.torps--; S.stats[key].launched++;
  const tr = S.tracks[key];
  const ang = Math.atan2(tr.pos[1] - s.pos[1], tr.pos[0] - s.pos[0]);
  S.torps.push({ id: S.nextId++, owner: key, pos: [s.pos[0], s.pos[1]],
    vel: [s.vel[0] + Math.cos(ang) * 100, s.vel[1] + Math.sin(ang) * 100],
    fuel: TORP.dv, age: 0, alive: true, hits: 0, heat: 0, acc: 0, trail: [], lastTrail: 0 });
  sayTo(key, 'Торпеда пущена'); sayTo(other(key), 'Противник пустил торпеду');
  return true;
}

// торпеда: пропорциональное наведение по треку цели, вблизи — по головке самонаведения.
// У торпеды, в отличие от корабля, запас Δv ограничен
export function stepTorp(t, dt) {
  const key = t.owner, tgt = shipOf(other(key)), tr = S.tracks[key];
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
    t.alive = false;
    S.fx.push({ kind: 'fizz', pos: [t.pos[0], t.pos[1]], t0: S.t, dur: 2, r: 1200, owner: key });
    sayTo(key, 'Ваша торпеда врезалась в ' + hb.name);
    return;
  }
  if (t.age - t.lastTrail >= 1) { t.lastTrail = t.age; t.trail.push([t.pos[0], t.pos[1]]); if (t.trail.length > 90) t.trail.shift(); }
  if (tgt.alive && t.age > 2) {
    const rvx = t.vel[0] - tgt.vel[0], rvy = t.vel[1] - tgt.vel[1];
    const px = t.pos[0] - tgt.pos[0] - rvx * dt, py = t.pos[1] - tgt.pos[1] - rvy * dt;
    const dmin = closestDist(px, py, rvx, rvy, dt);
    if (dmin < TORP.blast) {
      tgt.alive = false; tgt.hp = 0; tgt.deathBy = 'torp'; t.alive = false;
      S.fx.push({ kind: 'boom', pos: [tgt.pos[0], tgt.pos[1]], t0: S.t, dur: 4, r: 6000, owner: key });
      return;
    }
    // промах: торпеда прошла точку минимального сближения. Развернуться ей не хватит Δv, поэтому она взрывается
    const closingStart = px * rvx + py * rvy < 0, closingEnd = (px + rvx * dt) * rvx + (py + rvy * dt) * rvy < 0;
    if (closingStart && !closingEnd) {
      detonateMiss(t, tgt, dmin);
      return;
    }
  }
  if (t.fuel <= 0 && Vc < 0) { t.alive = false; S.fx.push({ kind: 'fizz', pos: [t.pos[0], t.pos[1]], t0: S.t, dur: 2, r: 1200, owner: key }); }
  else if (t.age > 600) t.alive = false;
}

// подрыв при промахе: осколки разлетаются кольцом, по кораблю попадает доля, обратная расстоянию
function detonateMiss(t, tgt, dmin) {
  const key = t.owner;
  t.alive = false;
  const p = dmin < TORP.fuse ? Math.min(1, 2 * FLAK.shipR / (2 * Math.PI * Math.max(dmin, 50))) : 0;
  let hits = 0;
  for (let i = 0; i < TORP.frags; i++) if (Math.random() < p) hits++;
  const dmg = hits * TORP.fragDmg;
  S.fx.push({ kind: 'frag', pos: [t.pos[0], t.pos[1]], t0: S.t, dur: 2.5, r: Math.min(3000, Math.max(900, dmin * 1.4)), owner: key });
  const d = Math.round(dmin), dtxt = d >= 1000 ? (d / 1000).toFixed(1) + ' км' : d + ' м';
  if (dmg > 0) {
    tgt.hp -= dmg;
    sayTo(key, 'Ваша торпеда взорвалась в ' + dtxt + ', осколки: −' + dmg + ' HP цели');
    sayTo(other(key), 'Торпеда взорвалась в ' + dtxt + ', осколки: −' + dmg + ' HP');
    if (tgt.hp <= 0) {
      tgt.hp = 0; tgt.alive = false; tgt.deathBy = 'frag';
      S.fx.push({ kind: 'boom', pos: [tgt.pos[0], tgt.pos[1]], t0: S.t, dur: 4, r: 6000, owner: key });
    }
  } else {
    sayTo(key, 'Ваша торпеда промахнулась на ' + dtxt + ' и взорвалась');
    sayTo(other(key), 'Торпеда промахнулась на ' + dtxt + ' и взорвалась');
  }
}

export function stepPellets(dt) {
  const dmgNow = { me: 0, foe: 0 };
  for (const p of S.pellets) {
    p.age += dt;
    const g = gravAt(p.pos[0], p.pos[1]);
    p.vel[0] += g[0] * dt; p.vel[1] += g[1] * dt;
    p.pos[0] += p.vel[0] * dt; p.pos[1] += p.vel[1] * dt;
    if (p.age > FLAK.life || bodyHit(p.pos[0], p.pos[1])) { p.dead = true; continue; }
    const tg = shipOf(other(p.owner));
    if (tg.alive) {
      const svx = p.vel[0] - tg.vel[0], svy = p.vel[1] - tg.vel[1];
      const spx = p.pos[0] - tg.pos[0] - svx * dt, spy = p.pos[1] - tg.pos[1] - svy * dt;
      if (closestDist(spx, spy, svx, svy, dt) < FLAK.shipR) {
        p.dead = true; tg.hp -= FLAK.dmg; dmgNow[tg.key] += FLAK.dmg;
        if (S.mp) S.hitLog.push([p.b, p.i]);
        if (tg.hp <= 0) {
          tg.hp = 0; tg.alive = false; tg.deathBy = 'flak';
          S.fx.push({ kind: 'boom', pos: [tg.pos[0], tg.pos[1]], t0: S.t, dur: 4, r: 6000, owner: p.owner });
        }
        continue;
      }
    }
    for (const t of S.torps) {
      if (!t.alive || t.owner === p.owner) continue;
      const rvx = p.vel[0] - t.vel[0], rvy = p.vel[1] - t.vel[1];
      const px = p.pos[0] - t.pos[0] - rvx * dt, py = p.pos[1] - t.pos[1] - rvy * dt;
      if (closestDist(px, py, rvx, rvy, dt) < FLAK.hitR) {
        p.dead = true; t.hits++;
        if (S.mp) S.hitLog.push([p.b, p.i]);
        if (t.hits >= FLAK.kill) {
          t.alive = false;
          S.fx.push({ kind: 'burst', pos: [t.pos[0], t.pos[1]], t0: S.t, dur: 2.5, r: 2500, owner: t.owner });
          S.stats[p.owner].kills++;
          sayTo(p.owner, 'Торпеда противника сбита'); sayTo(t.owner, 'Ваша торпеда сбита');
        }
        break;
      }
    }
  }
  S.pellets = S.pellets.filter(p => !p.dead);
  for (const k of ['me', 'foe']) {
    if (dmgNow[k] > 0 && S.t - S.lastHit[k] > 2) {
      S.lastHit[k] = S.t;
      sayTo(k, 'Облако противника попало по вашему кораблю'); sayTo(other(k), 'Ваше облако попало по кораблю противника');
    }
  }
}

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
  for (const key of ['me', 'foe']) {
    const s = shipOf(key), tgt = shipOf(other(key));
    if (!s.alive || s.accG < 0.5) continue;
    for (const t of S.torps) {
      if (!t.alive || t.owner === key) continue;
      const f = plumeFactor(s, t.pos);
      if (f <= 0) continue;
      t.heat += PLUME.rate * s.accG * f * dt;
      if (t.heat >= PLUME.melt) {
        t.alive = false;
        S.fx.push({ kind: 'melt', pos: [t.pos[0], t.pos[1]], t0: S.t, dur: 2.5, r: 2500, owner: t.owner });
        S.stats[key].kills++;
        sayTo(key, 'Торпеда противника расплавлена выхлопом'); sayTo(t.owner, 'Ваша торпеда расплавлена выхлопом противника');
      }
    }
    if (!tgt.alive) continue;
    const f = plumeFactor(s, tgt.pos);
    if (f <= 0) continue;
    const who = tgt.key;
    tgt.hp -= PLUME.shipRate * s.accG * f * dt;
    if (S.t - S.lastHit[who] > 2) { S.lastHit[who] = S.t; sayTo(who, 'Выхлоп противника плавит ваш корпус'); sayTo(key, 'Ваш выхлоп плавит корабль противника'); }
    if (tgt.hp <= 0) {
      tgt.hp = 0; tgt.alive = false; tgt.deathBy = 'plume';
      S.fx.push({ kind: 'boom', pos: [tgt.pos[0], tgt.pos[1]], t0: S.t, dur: 4, r: 6000, owner: key });
    }
  }
}
