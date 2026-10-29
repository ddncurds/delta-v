// Небесные тела: генерация, притяжение, столкновения и шаг интегратора движения в поле тяжести
import { G0, BODY } from '../config.js';
import { dist } from '../lib/math.js';
import { S } from './state.js';

// планета сбоку от линии боя и одна-две луны вокруг неё; тела неподвижны.
// look и seed задают внешний вид: по ним строится текстура, одинаковая у обоих игроков сетевого боя
export function makeBodies() {
  const R = ([a, b]) => a + Math.random() * (b - a);
  const any = a => a[Math.floor(Math.random() * a.length)];
  const names = BODY.names.slice().sort(() => Math.random() - .5);
  const mk = (kind, x, y, r, g) => ({ kind, look: any(BODY.looks[kind]), seed: Math.floor(Math.random() * 2 ** 31),
    name: names.pop(), pos: [x, y], r, mu: g * G0 * r * r });
  const side = Math.random() < .5 ? -1 : 1;
  const pl = mk('planet', R(BODY.planetX), side * R(BODY.planetY), R(BODY.planetR), R(BODY.planetG));
  const out = [pl];
  const moons = Math.random() < 0.4 ? 2 : 1;
  for (let i = 0; i < moons; i++) {
    const a = Math.random() * 2 * Math.PI, d = R(BODY.moonDist);
    out.push(mk('moon', pl.pos[0] + Math.cos(a) * d, pl.pos[1] + Math.sin(a) * d, R(BODY.moonR), R(BODY.moonG)));
  }
  return out;
}

export const surfaceG = b => b.mu / (b.r * b.r) / G0;

export function gravAt(x, y) {
  let ax = 0, ay = 0;
  for (const b of S.bodies) {
    const dx = b.pos[0] - x, dy = b.pos[1] - y, r2 = dx * dx + dy * dy;
    const k = b.mu / (Math.max(r2, b.r * b.r) * (Math.sqrt(r2) || 1));
    ax += dx * k; ay += dy * k;
  }
  return [ax, ay];
}

// шаг Верле: тяга (ax, ay) постоянна, гравитация берётся в начале и в конце шага — орбиты не расползаются
export function fly(p, v, ax, ay, dt) {
  const g0 = gravAt(p[0], p[1]);
  p[0] += (v[0] + (ax + g0[0]) * dt / 2) * dt; p[1] += (v[1] + (ay + g0[1]) * dt / 2) * dt;
  const g1 = gravAt(p[0], p[1]);
  v[0] += (ax + (g0[0] + g1[0]) / 2) * dt; v[1] += (ay + (g0[1] + g1[1]) / 2) * dt;
}

export function bodyHit(x, y) {
  for (const b of S.bodies) if (Math.hypot(x - b.pos[0], y - b.pos[1]) < b.r) return b;
  return null;
}

// тело с самым сильным притяжением в точке и высота над ним
export function mainBody(p) {
  let best = null, bg = -1;
  for (const b of S.bodies) {
    const d = dist(p, b.pos), g = b.mu / (d * d || 1);
    if (g > bg) { bg = g; best = { b, alt: d - b.r }; }
  }
  return best;
}
