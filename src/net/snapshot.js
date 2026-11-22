// Снимки состояния: хост считает бой и шлёт каждому гостю отдельный снимок — то, что видит его корабль.
// Союзники видны всегда, противник — только пока его видит корабль гостя (иначе гость получает лишь «жив/нет»).
// Гость применяет снимок и между снимками продолжает движение по инерции
import { G0, SHIP, FLAK, BODY, TEAM } from '../config.js';
import { spawnDebris, debrisGone } from '../sim/debris.js';
import { clamp, wrap } from '../lib/math.js';
import { S, gravAt, bodyHit, fly, normalizeRoster, eyeOf, endBattle } from '../sim/index.js';

// свой корабль гость получает целиком, остальные — только видимые снаружи поля
const SHIP_FULL = ['pos', 'vel', 'heading', 'cmdHeading', 'cmdThrottle', 'issuedThrottle', 'issuedHeading', 'accG', 'fuel', 'stress',
  'hp', 'deathBy', 'aimAway', 'torps', 'torpTimer', 'flak', 'flakTimer', 'flakCd', 'alive', 'burnEnd', 'spread', 'targetId', 'ctrl'];
const SHIP_PUB = ['pos', 'vel', 'heading', 'accG', 'hp', 'alive', 'deathBy', 'ctrl'];

const pick = (o, ks) => { const r = {}; for (const k of ks) r[k] = o[k]; return r; };

// что хост уже отправил гостю: эффекты, облака шариков и сбитые шарики уходят каждому гостю по одному разу
export const newPeerSync = () => ({ fxId: 0, pelB: 0, hitSeq: 0 });

// снимок для гостя, который управляет кораблём id; sync — его newPeerSync.
// say — сообщения экипажу [ключ, параметры], result — итог боя ключом: гость переводит их на свой язык.
// Обстановку гость видит глазами своего корабля, а после его гибели — глазами живого союзника
export function makeSnapshot(id, sync, { scale, pauseReason, ack, say, result }) {
  const me = S.ships[id], eye = eyeOf(me), tr = S.tracks[eye.id];
  const ships = S.ships.map(s => s === me ? pick(s, SHIP_FULL)
    : s.team === me.team || tr[s.id].exact || S.over ? pick(s, SHIP_PUB) : { alive: s.alive });
  const fx = S.fx.filter(f => f.id > sync.fxId);
  for (const f of fx) sync.fxId = Math.max(sync.fxId, f.id);
  const groups = new Map();
  for (const p of S.pellets) {
    if (p.b <= sync.pelB) continue;
    let g = groups.get(p.b);
    if (!g) groups.set(p.b, g = { b: p.b, o: p.owner, tm: p.team, age: p.age, p: [] });
    g.p.push([p.i, p.pos[0], p.pos[1], p.vel[0], p.vel[1]]);
  }
  for (const b of groups.keys()) sync.pelB = Math.max(sync.pelB, b);
  const pd = S.hitLog.filter(h => h[2] > sync.hitSeq).map(h => [h[0], h[1]]);
  sync.hitSeq = S.hitSeq;
  const m = { type: 'snap', t: S.t, sc: scale, pa: pauseReason, ack, ships, eye: eye.id,
    tr: tr.map(t => t && { pos: t.pos, vel: t.vel, ...(t.exact ? {} : { seen: t.seen, sv: t.sv }), seenT: t.seenT, exact: t.exact }),
    torps: S.torps.map(t => ({ id: t.id, owner: t.owner, team: t.team, target: t.target, pos: t.pos, vel: t.vel, fuel: t.fuel, heat: t.heat, acc: t.acc })),
    // взрыв уходит событием: скорость, сила, курс корпуса и seed — искры и обломки гость строит сам
    fx: fx.map(f => ({ id: f.id, kind: f.kind, pos: f.pos, t0: f.t0, dur: f.dur, r: f.r, team: f.team,
      vel: f.vel, en: f.en, h: f.h, hull: f.hull, seed: f.seed })),
    fl: [...groups.values()], pd, say, stats: S.stats };
  if (S.over) { m.ov = true; m.res = result; }
  return m;
}

// сбитые шарики, которые уже отдали всем гостям, хосту хранить незачем
export function pruneHitLog(minSeq) { S.hitLog = S.hitLog.filter(h => h[2] > minSeq); }

// keepIssued: хост ещё не получил последние приказы гостя — не откатываем ползунок тяги и заданный курс
export function applySnapshot(m, keepIssued) {
  const me = S.ships[S.myId], ih = me.issuedHeading, it = me.issuedThrottle;
  m.ships.forEach((d, i) => {
    const s = S.ships[i];
    if (!s) return;
    if (d.pos) Object.assign(s, d); else { s.alive = d.alive; s.accG = 0; }
  });
  if (keepIssued) { me.issuedHeading = ih; me.issuedThrottle = it; }
  if (S.ships[m.eye]) S.tracks[m.eye] = m.tr;
  const prev = new Map(S.torps.map(t => [t.id, t]));
  S.torps = m.torps.map(t => Object.assign(prev.get(t.id) || { trail: [], lastTrail: -1e9, hits: 0 }, t, { alive: true }));
  // обломки взрыва — те же, что у хоста: по seed, уже разлетевшиеся к моменту снимка
  for (const f of m.fx) { S.fx.push(f); if (f.kind === 'boom' && Number.isFinite(f.seed)) spawnDebris(f, m.t); }
  for (const g of m.fl) for (const [i, x, y, vx, vy] of g.p) S.pellets.push({ owner: g.o, team: g.tm, age: g.age, b: g.b, i, dead: false, pos: [x, y], vel: [vx, vy] });
  if (m.pd.length) {
    const dead = new Set(m.pd.map(([b, i]) => b + ':' + i)), gone = p => dead.has(p.b + ':' + p.i);
    S.pellets = S.pellets.filter(p => !gone(p));
    for (const d of S.debris) if (gone(d)) d.dead = true;
    S.debris = S.debris.filter(d => !d.dead);
  }
  S.t = m.t; S.stats = m.stats;
  if (m.ov && !S.over) endBattle(Array.isArray(m.res) ? [String(m.res[0]), m.res[1] || {}] : ['res.abort']);
}

// гость между снимками продолжает движение по инерции, без попаданий
export function guestStep(dt) {
  S.t += dt;
  const me = S.ships[S.myId], m = SHIP.turn * dt;
  if (me.alive) me.heading = wrap(me.heading + clamp(wrap(me.cmdHeading - me.heading), -m, m));
  for (const s of S.ships) {
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
  for (const d of S.debris) {
    d.pos[0] += d.vel[0] * dt; d.pos[1] += d.vel[1] * dt;
    if (debrisGone(d) || bodyHit(d.pos[0], d.pos[1])) d.dead = true;
  }
  if (S.debris.length) S.debris = S.debris.filter(d => !d.dead);
  S.fx = S.fx.filter(f => S.t - f.t0 < f.dur);
  for (const tr of S.tracks[eyeOf(me).id]) {
    if (!tr || tr.exact) continue;
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

// состав боя от хоста; null, если он негоден
export function netRoster(a) {
  if (!Array.isArray(a) || a.length > TEAM.max * 2) return null;
  try { return normalizeRoster(a.map(r => r && ({ team: r.team, ctrl: r.ctrl, name: r.name, owner: r.owner })).filter(Boolean)); }
  catch (_) { return null; }
}
