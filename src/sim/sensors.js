// Обнаружение: каждый корабль видит сам. S.tracks[o][e] — что корабль o знает о вражеском корабле e
// (для союзников и себя — null). Работающий двигатель видно издалека, корабль по инерции — только вблизи.
// Потерянный контакт ведём по баллистике с учётом притяжения тел
import { DETECT, FLAK } from '../config.js';
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

// pos/vel — оценка по баллистике (для ИИ и наведения торпед), seen/sv — где и с какой скоростью корабль видели в последний раз
// (это показываем игроку: без маневров оценка совпала бы с кораблём и выдала бы его).
// flak — когда наблюдатель видел выстрелы облаком этого корабля (время боя, с)
export const newTrack = e => ({ pos: [e.pos[0], e.pos[1]], vel: [e.vel[0], e.vel[1]], seen: [e.pos[0], e.pos[1]], sv: [e.vel[0], e.vel[1]], seenT: 0, exact: true, flak: [] });

// точка контакта для интерфейса: при потерянном контакте — последняя замеченная позиция
export const shownPos = tr => tr.exact || !tr.seen ? tr.pos : tr.seen;

// тело между точками a и b заслоняет прямую видимость
export function occluded(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  for (const c of S.bodies) {
    const k = Math.max(0, Math.min(1, ((c.pos[0] - a[0]) * dx + (c.pos[1] - a[1]) * dy) / L2));
    if (Math.hypot(a[0] + dx * k - c.pos[0], a[1] + dy * k - c.pos[1]) < c.r) return c;
  }
  return null;
}

// корабль s выстрелил облаком: выстрел замечают враги, которые видят его прямо сейчас
export function noteFlak(s) {
  for (const o of S.ships) {
    const tr = S.tracks[o.id]?.[s.id];
    if (!tr || !o.alive || !tr.exact) continue;
    (tr.flak ||= []).push(S.t);
    if (tr.flak.length > 20) tr.flak.shift();
  }
}

// сколько зарядов облака у корабля по треку tr: замеченные выстрелы и перезарядка (как в stepShip).
// Незамеченные выстрелы оценка не учитывает
export function flakLeft(tr) {
  let n = FLAK.charges, timer = 0, t = 0;
  const upTo = T => {
    while (timer > 0 && t + timer <= T) { t += timer; n++; timer = n < FLAK.charges ? FLAK.recharge : 0; }
    if (timer > 0) timer -= T - t;
    t = T;
  };
  for (const ts of tr.flak || []) { upTo(ts); n = Math.max(0, n - 1); if (timer <= 0) timer = FLAK.recharge; }
  upTo(S.t);
  return n;
}

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
      // планета или луна на линии взгляда скрывает корабль даже с работающим двигателем
      const hid = o.alive ? occluded(o.pos, e.pos) : null;
      const vis = o.alive && !hid && (e.accG > 0.3 || dist(o.pos, e.pos) < DETECT);
      if (vis) {
        if (!tr.exact && o.targetId === e.id) sayTo(o.id, 'msg.contact', { name: e.name });
        tr.pos = [e.pos[0], e.pos[1]]; tr.vel = [e.vel[0], e.vel[1]]; tr.seen = [e.pos[0], e.pos[1]]; tr.sv = [e.vel[0], e.vel[1]]; tr.seenT = S.t; tr.exact = true;
      } else {
        if (tr.exact && o.alive && o.targetId === e.id) sayTo(o.id, hid ? 'msg.contactHidden' : 'msg.contactLost', hid ? { name: e.name, body: hid.name } : { name: e.name });
        tr.exact = false;
        const g = gravAt(tr.pos[0], tr.pos[1]);
        tr.vel[0] += g[0] * dt; tr.vel[1] += g[1] * dt;
        tr.pos[0] += tr.vel[0] * dt; tr.pos[1] += tr.vel[1] * dt;
      }
    }
  }
}
