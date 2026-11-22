// Обломки корпуса при гибели корабля. План разлёта детерминирован по seed взрыва: хост и гость строят одни и те же
// обломки, а рендер — те же куски корпуса. Опасные (тяжёлые) обломки живут в S.debris и летят по прямой без затухания
import { FX_CONFIG } from '../config.js';
import { rng } from '../lib/noise.js';
import { S } from './state.js';

// скорость осколка: v0 = vMin·e^(rand·k)·√energy
export const fragSpeed = (u, en) => FX_CONFIG.vMin * Math.exp(u * FX_CONFIG.k) * Math.sqrt(en);

// план обломков взрыва ev ({pos, vel, en, h, seed}): корпус режется на сектора вокруг центра,
// a0…a1 — углы сектора в осях корабля, depth — какая доля радиуса от борта к центру ушла в кусок
export function debrisPlan(ev) {
  const D = FX_CONFIG.debris, en = ev.en ?? 1, rand = rng((ev.seed ^ 0x9e3779b9) >>> 0);
  const vel = ev.vel || [0, 0], h = ev.h || 0;
  const n = Math.round(D.n0 + D.nPerE * en), w = [];
  let sum = 0;
  for (let i = 0; i < n; i++) { const x = 0.4 + rand(); w.push(x); sum += x; }
  const out = [];
  let a = rand() * 2 * Math.PI;
  for (let i = 0; i < n; i++) {
    const span = w[i] / sum * 2 * Math.PI, depth = 0.3 + 0.7 * rand();
    const dir = h + a + span / 2 + (rand() - 0.5) * span * 0.5;
    const v0 = fragSpeed(rand(), en), spin = (rand() * 2 - 1) * D.spin;
    const m = D.hullMass * D.frac * (w[i] / sum) * (1 - (1 - depth) ** 2);
    out.push({ i, a0: a, a1: a + span, depth, dir, v0, spin, m, big: m >= D.bigMass,
      vx: vel[0] + Math.cos(dir) * v0, vy: vel[1] + Math.sin(dir) * v0 });
    a += span;
  }
  return out;
}

// опасные обломки взрыва f в S.debris; now — время, к которому они уже успели разлететься (гость получает взрыв позже)
export function spawnDebris(f, now = S.t) {
  const dt = now - f.t0;
  for (const p of debrisPlan(f)) {
    if (!p.big) continue;
    S.debris.push({ b: f.id, i: p.i, team: f.team, m: p.m, v0: p.v0, t0: f.t0, dead: false,
      pos: [f.pos[0] + p.vx * dt, f.pos[1] + p.vy * dt], vel: [p.vx, p.vy] });
  }
}

// обломок улетел дальше simRadius от центра взрыва (центр летит со скоростью корабля)
export const debrisGone = (d, t = S.t) => (t - d.t0) * d.v0 > FX_CONFIG.simRadius;
