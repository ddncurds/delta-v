// Прогноз траектории в поле тяжести тел
import { G0, SHIP } from '../config.js';
import { clamp, wrap } from '../lib/math.js';
import { S, shipOf } from './state.js';
import { fly, bodyHit } from './bodies.js';

// пока идёт текущий манёвр (без срока — первые 20 с) корабль летит с тягой, дальше по инерции.
// burnN — индекс последней точки манёвра; hit и hitT — тело и время столкновения, если оно будет
export function predictPath(s, T, h) {
  const p = [s.pos[0], s.pos[1]], v = [s.vel[0], s.vel[1]];
  let hd = s.heading, burnN = 0, hit = null, hitT = 0;
  const burnT = s.cmdThrottle > 0.05 ? (s.burnEnd > 0 ? Math.max(0, s.burnEnd - S.t) : 20) : 0;
  const pts = [[p[0], p[1]]];
  for (let t = 0; t < T; t += h) {
    let a = 0;
    if (t < burnT) {
      hd = wrap(hd + clamp(wrap(s.cmdHeading - hd), -SHIP.turn * h, SHIP.turn * h));
      a = Math.min(s.cmdThrottle, SHIP.maxG) * G0;
    }
    fly(p, v, Math.cos(hd) * a, Math.sin(hd) * a, h);
    pts.push([p[0], p[1]]);
    if (t < burnT) burnN = pts.length - 1;
    const b = bodyHit(p[0], p[1]);
    if (b) { hit = b; hitT = t + h; break; }
  }
  return { pts, burnN, hit, hitT };
}

// грозит ли кораблю стороны key столкновение с телом в ближайшие T секунд
export function impactIn(key, T) {
  const s = shipOf(key);
  if (!s.alive || !S.bodies.length) return null;
  const pp = predictPath(s, T, 1);
  return pp.hit ? pp : null;
}
