// Эффекты карты в реальном времени. Симуляция кладёт эффект в S.fx и через f.dur игровых секунд убирает,
// а рендер заводит на каждый объект свою запись (WeakMap по ссылке, поля S.fx не трогаем) и ведёт её
// по часам рендера clock.fx: эффект живёт одинаково при ×1 и ×30, замирает на паузе и доигрывает после боя
import { rng } from '../lib/noise.js';
import { C } from './theme.js';
import { clock } from './clock.js';
import { glowSprite, drawGlow } from './glow.js';
import { explode, stepExplosions, drawExplosions } from './explosion.js';

// длительность записи эффекта, реальные секунды (сами взрывы ведёт explosion.js, им запись нужна для подписи и сети)
export const FX_LIFE = { boom: 3.2, burst: 1.6, melt: 1.6, frag: 1.6, puff: 0.9, fizz: 0.9, hit: 0.6 };
// эффекты-взрывы: по ним explosion.js строит вспышку, газ, искры и обломки
const BLAST = new Set(['boom', 'burst', 'frag', 'hit']);
const life = r => FX_LIFE[r.kind] || 1;

const seen = new WeakMap();
let recs = [], lastS = null;

// зерно рисунка из позиции и времени эффекта: у хоста и гостя рисунок совпадает
const seedOf = f => (Math.round(f.pos[0]) * 73856093 ^ Math.round(f.pos[1]) * 19349663 ^ Math.round((f.t0 || 0) * 20) * 83492791) >>> 0;

// новые записи для эффектов из state.fx; возвращает только что заведённые. now — часы рендера (clock.fx)
export function syncFx(state, now = clock.fx) {
  if (state !== lastS) { recs = []; lastS = state; }
  stepExplosions(state, now);
  const fresh = [];
  for (const f of state.fx) {
    if (seen.has(f)) continue;
    const r = { kind: f.kind, pos: [f.pos[0], f.pos[1]], r: f.r, owner: f.team, born: now, seed: seedOf(f), drift: null, en: f.en ?? 0 };
    seen.set(f, r); recs.push(r); fresh.push(r);
    if (BLAST.has(f.kind)) explode({ ...f, seed: f.seed ?? r.seed }, now);
  }
  recs = recs.filter(r => now - r.born < life(r));
  return fresh;
}

export const fxRecords = () => recs;
// возраст записи в реальных секундах и доля прожитого
export const fxAge = (r, now = clock.fx) => now - r.born;
export const fxAlive = (r, now = clock.fx) => now - r.born < life(r);

const easeOut = u => 1 - (1 - u) * (1 - u);

// X, Y — мир → экран; mpp — метров на пиксель; colFor(team) — цвет стороны; W, H — размер экрана, px
export function drawFx(ctx, X, Y, mpp, colFor, W = 1e9, H = 1e9) {
  const now = clock.fx;
  drawExplosions(ctx, X, Y, mpp, W, H, now);
  for (const r of recs) {
    const age = now - r.born, u = age / life(r);
    if (u < 0 || u >= 1) continue;
    const x = X(r.pos[0]), y = Y(r.pos[1]), col = colFor(r.owner), rpx = r.r / mpp;
    switch (r.kind) {
      case 'boom': case 'burst': case 'hit': break;   // взрывы рисует explosion.js
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
}
