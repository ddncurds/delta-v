// Обнаружение: кого видно, где был противник и какая торпеда ближе всех
import { DETECT } from '../config.js';
import { dist } from '../lib/math.js';
import { S, sayTo, shipOf, other } from './state.js';
import { gravAt } from './bodies.js';

// время до встречи торпеды t с кораблём s; null, если она не сближается
export function timeToImpact(t, s) {
  const rx = t.pos[0] - s.pos[0], ry = t.pos[1] - s.pos[1], R = Math.hypot(rx, ry) || 1;
  const vc = -(rx * (t.vel[0] - s.vel[0]) + ry * (t.vel[1] - s.vel[1])) / R;
  return vc > 1 ? R / vc : null;
}

// ближайшая по времени подлёта вражеская торпеда для стороны key
export function nearestThreat(key) {
  const s = shipOf(key);
  let best = null, bt = 1e12;
  for (const t of S.torps) {
    if (t.owner === key || !t.alive) continue;
    const rx = t.pos[0] - s.pos[0], ry = t.pos[1] - s.pos[1];
    const R = Math.hypot(rx, ry) || 1;
    const vx = t.vel[0] - s.vel[0], vy = t.vel[1] - s.vel[1];
    const vc = -(rx * vx + ry * vy) / R;
    const ttg = vc > 1 ? R / vc : 1e9 + R;
    if (ttg < bt) { bt = ttg; best = t; }
  }
  return best ? { t: best, ttg: bt } : null;
}

// работающий двигатель видно издалека, корабль по инерции — только вблизи.
// Потерянный контакт ведём по баллистике с учётом притяжения тел
export function updateTracks(dt) {
  for (const key of ['me', 'foe']) {
    const obs = shipOf(key), tgt = shipOf(other(key)), tr = S.tracks[key];
    const vis = tgt.accG > 0.3 || dist(obs.pos, tgt.pos) < DETECT;
    if (vis) {
      if (!tr.exact) sayTo(key, 'Контакт: двигатель противника');
      tr.pos = [tgt.pos[0], tgt.pos[1]]; tr.vel = [tgt.vel[0], tgt.vel[1]]; tr.seenT = S.t; tr.exact = true;
    } else {
      if (tr.exact) sayTo(key, 'Контакт потерян: противник идёт по инерции');
      tr.exact = false;
      const g = gravAt(tr.pos[0], tr.pos[1]);
      tr.vel[0] += g[0] * dt; tr.vel[1] += g[1] * dt;
      tr.pos[0] += tr.vel[0] * dt; tr.pos[1] += tr.vel[1] * dt;
    }
  }
}
