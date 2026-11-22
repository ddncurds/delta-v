// Обнаружение: каждый корабль видит сам. S.tracks[o][e] — что корабль o знает о вражеском корабле e
// (для союзников и себя — null). Работающий двигатель видно издалека, корабль по инерции — только вблизи.
// Потерянный контакт ведём по баллистике с учётом притяжения тел
import { DETECT } from '../config.js';
import { dist } from '../lib/math.js';
import { S, sayTo, enemiesOf } from './state.js';
import { gravAt } from './bodies.js';

// время до встречи торпеды t с кораблём s; null, если она не сближается
export function timeToImpact(t, s) {
  const rx = t.pos[0] - s.pos[0], ry = t.pos[1] - s.pos[1], R = Math.hypot(rx, ry) || 1;
  const vc = -(rx * (t.vel[0] - s.vel[0]) + ry * (t.vel[1] - s.vel[1])) / R;
  return vc > 1 ? R / vc : null;
}

// ближайшая по времени подлёта вражеская торпеда для корабля s
export function nearestThreat(s) {
  let best = null, bt = 1e12;
  for (const t of S.torps) {
    if (t.team === s.team || !t.alive) continue;
    const rx = t.pos[0] - s.pos[0], ry = t.pos[1] - s.pos[1];
    const R = Math.hypot(rx, ry) || 1;
    const vx = t.vel[0] - s.vel[0], vy = t.vel[1] - s.vel[1];
    const vc = -(rx * vx + ry * vy) / R;
    const ttg = vc > 1 ? R / vc : 1e9 + R;
    if (ttg < bt) { bt = ttg; best = t; }
  }
  return best ? { t: best, ttg: bt } : null;
}

export const newTrack = e => ({ pos: [e.pos[0], e.pos[1]], vel: [e.vel[0], e.vel[1]], seenT: 0, exact: true });

// треки всех кораблей: на старте все видят всех
export function initTracks() {
  S.tracks = S.ships.map(o => S.ships.map(e => e.team !== o.team ? newTrack(e) : null));
}

// трек цели корабля s, если цель ещё жива
export function targetTrack(s) {
  const e = S.ships[s.targetId];
  return e && e.alive && e.team !== s.team ? S.tracks[s.id][e.id] : null;
}

// ближайший живой противник по данным самого корабля; точные контакты важнее устаревших
export function pickTarget(s) {
  let best = -1, bd = Infinity;
  for (const e of enemiesOf(s)) {
    if (!e.alive) continue;
    const tr = S.tracks[s.id][e.id], d = dist(s.pos, tr.pos) * (tr.exact ? 1 : 3);
    if (d < bd) { bd = d; best = e.id; }
  }
  return best;
}

export function updateTracks(dt) {
  for (const o of S.ships) {
    for (const e of S.ships) {
      const tr = S.tracks[o.id][e.id];
      if (!tr || !e.alive) continue;
      const vis = o.alive && (e.accG > 0.3 || dist(o.pos, e.pos) < DETECT);
      if (vis) {
        if (!tr.exact && o.targetId === e.id) sayTo(o.id, 'Контакт: двигатель корабля ' + e.name);
        tr.pos = [e.pos[0], e.pos[1]]; tr.vel = [e.vel[0], e.vel[1]]; tr.seenT = S.t; tr.exact = true;
      } else {
        if (tr.exact && o.alive && o.targetId === e.id) sayTo(o.id, 'Контакт потерян: ' + e.name + ' идёт по инерции');
        tr.exact = false;
        const g = gravAt(tr.pos[0], tr.pos[1]);
        tr.vel[0] += g[0] * dt; tr.vel[1] += g[1] * dt;
        tr.pos[0] += tr.vel[0] * dt; tr.pos[1] += tr.vel[1] * dt;
      }
    }
  }
}
