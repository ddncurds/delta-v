// Эффекты карты в реальном времени. Симуляция кладёт эффект в S.fx и через f.dur игровых секунд убирает,
// а рендер заводит на каждый объект свою запись (WeakMap по ссылке, поля S.fx не трогаем) и ведёт её
// по часам рендера clock.fx: эффект живёт одинаково при ×1 и ×30, замирает на паузе и доигрывает после боя
import { rng } from '../lib/noise.js';
import { C, HULL } from './theme.js';
import { clock, reducedMotion } from './clock.js';
import { glowSprite, drawGlow } from './glow.js';

// длительность эффекта, реальные секунды
export const FX_LIFE = { boom: 3.2, burst: 1.6, melt: 1.6, frag: 1.6, puff: 0.9, fizz: 0.9 };
export const MAX_PARTS = 400;
const life = r => FX_LIFE[r.kind] || 1;

const seen = new WeakMap();
let recs = [], parts = [], lastS = null;

// зерно частиц из позиции и времени эффекта: у хоста и гостя рисунок совпадает
const seedOf = f => (Math.round(f.pos[0]) * 73856093 ^ Math.round(f.pos[1]) * 19349663 ^ Math.round((f.t0 || 0) * 20) * 83492791) >>> 0;

// новые записи для эффектов из state.fx; возвращает только что заведённые. now — часы рендера (clock.fx)
export function syncFx(state, now = clock.fx) {
  if (state !== lastS) { recs = []; parts = []; lastS = state; }
  const fresh = [];
  for (const f of state.fx) {
    if (seen.has(f)) continue;
    const r = { kind: f.kind, pos: [f.pos[0], f.pos[1]], r: f.r, owner: f.team, born: now, seed: seedOf(f), drift: null };
    seen.set(f, r); recs.push(r); fresh.push(r);
    spawnParts(r);
  }
  recs = recs.filter(r => now - r.born < life(r));
  if (parts.length && parts[0].rec.born + life(parts[0].rec) <= now) parts = parts.filter(p => now - p.rec.born < life(p.rec));
  return fresh;
}

export const fxRecords = () => recs;
export const fxParticles = () => parts;
// возраст записи в реальных секундах и доля прожитого
export const fxAge = (r, now = clock.fx) => now - r.born;
export const fxAlive = (r, now = clock.fx) => now - r.born < life(r);

// частицы: обломки корабля и искры сбитой торпеды. Скорость в px/с, движение с торможением считается от возраста
function spawnParts(r) {
  const n = r.kind === 'boom' ? 24 : r.kind === 'burst' ? 8 : 0;
  if (!n) return;
  const rand = rng(r.seed);
  for (let i = 0; i < n; i++) {
    const a = (i + rand()) / n * 2 * Math.PI;
    parts.push(r.kind === 'boom'
      ? { rec: r, a, v: 40 + 100 * rand(), rot: rand() * 6.3, spin: (rand() - 0.5) * 8, len: 3 + 5 * rand(), bend: (rand() - 0.5) * 1.6, hot: rand() < 0.35 }
      : { rec: r, a, v: 70 + 110 * rand(), rot: a, spin: 0, len: 4 + 4 * rand(), bend: 0, hot: true });
  }
  if (parts.length > MAX_PARTS) parts.splice(0, parts.length - MAX_PARTS);
}

// путь частицы за время age при торможении k: v·(1 − e^(−k·age))/k
const travel = (v, age, k = 1.3) => v * (1 - Math.exp(-k * age)) / k;
const easeOut = u => 1 - (1 - u) * (1 - u);

// вспышка: без reduced-motion мерцает, с ним — плавно нарастает и спадает
function flash(age, dur) {
  if (age > dur) return 0;
  if (reducedMotion()) return Math.sin(Math.PI * age / dur);
  return (1 - age / dur) * (0.8 + 0.2 * Math.random());
}

// X, Y — мир → экран; mpp — метров на пиксель; colFor(team) — цвет стороны
export function drawFx(ctx, X, Y, mpp, colFor) {
  const now = clock.fx;
  for (const r of recs) {
    const age = now - r.born, u = age / life(r);
    if (u < 0 || u >= 1) continue;
    const x = X(r.pos[0]), y = Y(r.pos[1]), col = colFor(r.owner), rpx = r.r / mpp;
    switch (r.kind) {
      case 'boom': {
        // тлеющее облако, ударная волна и вспышка
        drawGlow(ctx, glowSprite(C.ember, 64), x, y, Math.max(34, rpx * 0.8) * (1 + 0.4 * u), 0.35 * (1 - u));
        if (age < 1.2) {
          const k = age / 1.2, R = Math.max(60, rpx * 1.2) * easeOut(k);
          ctx.strokeStyle = col; ctx.lineWidth = 3 - 2.5 * k; ctx.globalAlpha = 0.9 * (1 - k);
          ctx.beginPath(); ctx.arc(x, y, Math.max(2, R), 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
        }
        const fl = flash(age, 0.15), fc = Math.max(0, 1 - age / 0.6);
        drawGlow(ctx, glowSprite(col, 64), x, y, Math.max(40, rpx * 0.5), fc);
        drawGlow(ctx, glowSprite(C.white, 64), x, y, Math.max(40, rpx * 0.5), fl);
        break;
      }
      case 'burst': {
        drawGlow(ctx, glowSprite(col, 32), x, y, Math.max(24, rpx * 0.4), (1 - u) * 0.9);
        drawGlow(ctx, glowSprite(C.white, 32), x, y, 24, flash(age, 0.15));
        break;
      }
      case 'melt': {
        const d = r.drift || [0, 0], s = 40 * easeOut(u);
        drawGlow(ctx, glowSprite(C.plume, 32), x + d[0] * s, y + d[1] * s, Math.max(16, rpx * 0.3), 0.8 * (1 - u));
        break;
      }
      case 'frag': {
        const rr = Math.max(28, r.r * (0.2 + 0.8 * u) / mpp);
        drawGlow(ctx, glowSprite(col, 32), x, y, rr, 0.6 * (1 - u));
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.globalAlpha = 1 - u; ctx.beginPath();
        for (let k = 0; k < 20; k++) {
          const a = k * Math.PI / 10;
          ctx.moveTo(x + Math.cos(a) * rr * 0.55, y + Math.sin(a) * rr * 0.55); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.stroke(); ctx.globalAlpha = 1;
        break;
      }
      case 'puff': {
        const rr = Math.max(12, r.r * (0.3 + 0.7 * easeOut(u)) / mpp), rand = rng(r.seed);
        for (let k = 0; k < 3; k++) {
          const a = rand() * 6.3, o = rr * 0.35 * rand();
          drawGlow(ctx, glowSprite(C.puff, 32), x + Math.cos(a) * o, y + Math.sin(a) * o, rr * (0.7 + 0.3 * rand()), 0.35 * (1 - u));
        }
        break;
      }
      default: { // fizz: торпеда выдохлась — тусклое кольцо
        ctx.strokeStyle = C.ink2; ctx.lineWidth = 1; ctx.globalAlpha = 0.5 * (1 - u);
        ctx.beginPath(); ctx.arc(x, y, Math.max(8, r.r * (0.2 + 0.8 * u) / mpp), 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
  }
  // обломки и искры: короткие ломаные, вращаются и гаснут
  ctx.lineWidth = 1.2;
  for (const p of parts) {
    const r = p.rec, age = now - r.born, u = age / life(r);
    if (u < 0 || u >= 1) continue;
    const d = travel(p.v, age), cx = X(r.pos[0]) + Math.cos(p.a) * d, cy = Y(r.pos[1]) + Math.sin(p.a) * d;
    const rot = p.rot + p.spin * age, h = p.len / 2, c = Math.cos(rot), s = Math.sin(rot);
    const c2 = Math.cos(rot + p.bend), s2 = Math.sin(rot + p.bend);
    ctx.globalAlpha = (1 - u) * (r.kind === 'burst' ? 1 : 0.9);
    ctx.strokeStyle = p.hot ? (u < 0.4 ? C.white : C.plume) : HULL.light;
    ctx.beginPath(); ctx.moveTo(cx - c * h, cy - s * h); ctx.lineTo(cx, cy); ctx.lineTo(cx + c2 * h, cy + s2 * h); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
