// Снимки состояния: хост считает бой и шлёт гостю картину глазами гостя (стороны me и foe переставлены),
// гость применяет снимок и между снимками продолжает движение по инерции
import { G0, SHIP, FLAK, BODY } from '../config.js';
import { clamp, wrap } from '../lib/math.js';
import { S, gravAt, bodyHit, fly } from '../sim/index.js';

// свой корабль гость получает целиком, корабль хоста — только когда тот виден
const SHIP_FULL = ['pos', 'vel', 'heading', 'cmdHeading', 'cmdThrottle', 'issuedThrottle', 'issuedHeading', 'accG', 'stress',
  'hp', 'deathBy', 'aimAway', 'torps', 'flak', 'flakTimer', 'flakCd', 'alive', 'burnEnd', 'spread'];
const SHIP_PUB = ['pos', 'vel', 'heading', 'accG', 'hp', 'alive', 'deathBy'];

const pick = (o, ks) => { const r = {}; for (const k of ks) r[k] = o[k]; return r; };
const mirror = k => k === 'me' ? 'foe' : k === 'foe' ? 'me' : k;

// снимок для гостя; эффекты и новые шарики уходят один раз, дальше гость ведёт их сам
export function makeSnapshot({ scale, pauseReason, ack, say, result }) {
  const tr = S.tracks.foe;
  const fx = S.fx.filter(f => !f.sent);
  fx.forEach(f => { f.sent = true; });
  const fresh = new Map();
  for (const p of S.pellets) {
    if (p.sent) continue;
    p.sent = true;
    let g = fresh.get(p.b);
    if (!g) fresh.set(p.b, g = { b: p.b, o: mirror(p.owner), age: p.age, p: [] });
    g.p.push([p.i, p.pos[0], p.pos[1], p.vel[0], p.vel[1]]);
  }
  const m = { type: 'snap', t: S.t, sc: scale, pa: mirror(pauseReason), ack,
    me: pick(S.foe, SHIP_FULL),
    foe: tr.exact || S.over ? pick(S.me, SHIP_PUB) : { alive: S.me.alive },
    tr: { pos: tr.pos, vel: tr.vel, seenT: tr.seenT, exact: tr.exact },
    torps: S.torps.map(t => ({ id: t.id, owner: mirror(t.owner), pos: t.pos, vel: t.vel, fuel: t.fuel, heat: t.heat, acc: t.acc })),
    fx: fx.map(f => ({ kind: f.kind, pos: f.pos, t0: f.t0, dur: f.dur, r: f.r, owner: mirror(f.owner) })),
    fl: [...fresh.values()], pd: S.hitLog.splice(0), say,
    stats: { me: S.stats.foe, foe: S.stats.me } };
  if (S.over) { m.ov = true; m.res = result; }
  return m;
}

// keepIssued: хост ещё не получил последние приказы гостя — не откатываем ползунок тяги и заданный курс
export function applySnapshot(m, keepIssued) {
  const me = S.me, foe = S.foe, ih = me.issuedHeading, it = me.issuedThrottle;
  Object.assign(me, m.me);
  if (keepIssued) { me.issuedHeading = ih; me.issuedThrottle = it; }
  if (m.foe.pos) Object.assign(foe, m.foe); else { foe.alive = m.foe.alive; foe.accG = 0; }
  S.tracks.me = m.tr;
  const prev = new Map(S.torps.map(t => [t.id, t]));
  S.torps = m.torps.map(t => Object.assign(prev.get(t.id) || { trail: [], lastTrail: -1e9, hits: 0 }, t, { alive: true }));
  for (const f of m.fx) S.fx.push(f);
  for (const g of m.fl) for (const [i, x, y, vx, vy] of g.p) S.pellets.push({ owner: g.o, age: g.age, b: g.b, i, dead: false, pos: [x, y], vel: [vx, vy] });
  if (m.pd.length) { const dead = new Set(m.pd.map(([b, i]) => b + ':' + i)); S.pellets = S.pellets.filter(p => !dead.has(p.b + ':' + p.i)); }
  S.t = m.t; S.stats = m.stats;
  if (m.ov && !S.over) { S.over = true; S.result = m.res; }
}

// гость между снимками продолжает движение по инерции, без попаданий
export function guestStep(dt) {
  S.t += dt;
  const me = S.me, m = SHIP.turn * dt;
  if (me.alive) me.heading = wrap(me.heading + clamp(wrap(me.cmdHeading - me.heading), -m, m));
  for (const s of [me, S.foe]) {
    if (!s.alive) continue;
    const a = s.accG * G0;
    fly(s.pos, s.vel, Math.cos(s.heading) * a, Math.sin(s.heading) * a, dt);
  }
  for (const t of S.torps) {
    const g = gravAt(t.pos[0], t.pos[1]);
    t.vel[0] += g[0] * dt; t.vel[1] += g[1] * dt;
    t.pos[0] += t.vel[0] * dt; t.pos[1] += t.vel[1] * dt;
    if (S.t - t.lastTrail >= 1) { t.lastTrail = S.t; t.trail.push([t.pos[0], t.pos[1]]); if (t.trail.length > 90) t.trail.shift(); }
  }
  for (const p of S.pellets) {
    const g = gravAt(p.pos[0], p.pos[1]);
    p.age += dt; p.vel[0] += g[0] * dt; p.vel[1] += g[1] * dt; p.pos[0] += p.vel[0] * dt; p.pos[1] += p.vel[1] * dt;
  }
  S.pellets = S.pellets.filter(p => p.age <= FLAK.life && !bodyHit(p.pos[0], p.pos[1]));
  S.fx = S.fx.filter(f => S.t - f.t0 < f.dur);
  const tr = S.tracks.me;
  if (!tr.exact) {
    const g = gravAt(tr.pos[0], tr.pos[1]);
    tr.vel[0] += g[0] * dt; tr.vel[1] += g[1] * dt; tr.pos[0] += tr.vel[0] * dt; tr.pos[1] += tr.vel[1] * dt;
  }
}

// тела из сообщения хоста: проверяем поля, лишнее отбрасываем
const LOOKS = new Set([...BODY.looks.planet, ...BODY.looks.moon]);
export function netBodies(a) {
  if (!Array.isArray(a)) return [];
  return a.slice(0, 8)
    .filter(b => b && Array.isArray(b.pos) && [b.pos[0], b.pos[1], b.r, b.mu, b.seed].every(Number.isFinite) && b.r > 0 && b.mu >= 0)
    .map(b => ({ kind: b.kind === 'planet' ? 'planet' : 'moon', look: LOOKS.has(b.look) ? b.look : 'rock', seed: b.seed | 0,
      name: String(b.name || '').slice(0, 16), pos: [b.pos[0], b.pos[1]], r: b.r, mu: b.mu }));
}
