// Взрывы: вспышка, огненный шар, ударная волна, искры, обломки корпуса и вторичные вспышки (plans/delta-v-explosions-tz.md).
// Всё строится детерминированно по seed взрыва: у хоста и гостей картинка одна. Газ (вспышка, шар, волна) живёт
// по реальным часам clock.fx и при отдалении не меньше нескольких пикселей. Искры и обломки летят по-настоящему,
// в метрах, по игровым часам clock.game: pos = центр + v·(t − t0), без затухания. Горячесть hot = 1 → 0 идёт
// по реальным часам, остывшие искры остаются тёмной пылью и пропадают дальше FX_CONFIG.simRadius или в теле.
// Искры и клубы шара лежат в кольцевых буферах на typed arrays: в кадре нет выделений памяти, при переполнении
// пропадают самые старые
import { FX_CONFIG as F } from '../config.js';
import { rng } from '../lib/noise.js';
import { debrisPlan, fragSpeed } from '../sim/debris.js';
import { S, bodyHit } from '../sim/index.js';
import { FIRE, FX_COL, HULL } from './theme.js';
import { clock } from './clock.js';
import { glowSprite, drawGlow } from './glow.js';
import { hullOutline, shipLength } from './ship-models.js';

const TAU = 2 * Math.PI;
const lerp = (r, u) => r[0] + (r[1] - r[0]) * u;
const easeOut = u => 1 - (1 - u) * (1 - u);

/* ---------- качество ---------- */
let quality = 'high';
export const QUALITIES = Object.keys(F.quality);
export const getQuality = () => quality;
export function setQuality(q) { if (F.quality[q]) quality = q; }
const qk = () => F.quality[quality];

/* ---------- температурная шкала: таблица цветов '#rrggbb', индекс — горячесть ---------- */
const LUT_N = 32;
const hex2 = v => Math.round(v).toString(16).padStart(2, '0');
function mix(a, b, u) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const c = s => (x >> s & 255) + ((y >> s & 255) - (x >> s & 255)) * u;
  return '#' + hex2(c(16)) + hex2(c(8)) + hex2(c(0));
}
export function fireColor(hot) {
  for (let k = 1; k < FIRE.length; k++) {
    const [h1, c1] = FIRE[k - 1], [h0, c0] = FIRE[k];
    if (hot >= h0) return mix(c0, c1, (hot - h0) / (h1 - h0));
  }
  return FIRE[FIRE.length - 1][1];
}
const LUT = Array.from({ length: LUT_N }, (_, i) => fireColor(i / (LUT_N - 1)));
const lutIdx = hot => Math.max(0, Math.min(LUT_N - 1, Math.round(hot * (LUT_N - 1))));
// яркость сглажена: горячее держится дольше, к концу спадает мягко; u — доля прожитого
const glowCurve = u => { const h = 1 - u; return h * h * (3 - 2 * h); };

/* ---------- искры: кольцевой буфер ---------- */
const N = F.maxParts;
const sX = new Float64Array(N), sY = new Float64Array(N), sVX = new Float32Array(N), sVY = new Float32Array(N);
const sT0 = new Float64Array(N), sB0 = new Float64Array(N), sLife = new Float32Array(N), sSp = new Float32Array(N);
const sOn = new Uint8Array(N), sBk = new Uint8Array(N);
const bucketN = new Uint16Array(LUT_N);
let sHead = 0;

/* ---------- клубы огненного шара: кольцевой буфер ---------- */
const NB = 600;
const bX = new Float64Array(NB), bY = new Float64Array(NB), bVX = new Float32Array(NB), bVY = new Float32Array(NB);
const bT0 = new Float64Array(NB), bB0 = new Float64Array(NB), bLife = new Float32Array(NB), bOX = new Float32Array(NB), bOY = new Float32Array(NB);
const bR = new Float32Array(NB), bMin = new Float32Array(NB), bOn = new Uint8Array(NB);
let bHead = 0;

// взрывы (вспышка, волна, вторичные вспышки, свет) и куски корпуса — обычные объекты, их немного
let blasts = [], pieces = [], lastS = null;

export function resetExplosions() {
  sOn.fill(0); bOn.fill(0); sHead = bHead = 0; blasts = []; pieces = [];
}

export const sparkCount = () => { let n = 0; for (let i = 0; i < N; i++) n += sOn[i]; return n; };
export const explosionStats = () => ({ sparks: sparkCount(), blasts: blasts.length, pieces: pieces.length });
export const debrisPieces = () => pieces;

/* ---------- обломки: сектора контура корпуса ---------- */
// радиус корпуса по направлению: луч из центра до дальнего пересечения с контуром, таблица на 64 направления, м
const RAYS = 64, rayCache = new Map();
function hullRays(team) {
  if (rayCache.has(team)) return rayCache.get(team);
  const pts = hullOutline(team), L = shipLength({ team }), out = new Float32Array(RAYS);
  for (let k = 0; k < RAYS; k++) {
    const a = k / RAYS * TAU, dx = Math.cos(a), dy = Math.sin(a);
    let best = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length], ex = x2 - x1, ey = y2 - y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = (x1 * ey - y1 * ex) / den, u = (x1 * dy - y1 * dx) / den;
      if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
    }
    out[k] = best * L;
  }
  rayCache.set(team, out);
  return out;
}
function rayAt(rays, a) {
  const k = ((a / TAU * RAYS) % RAYS + RAYS) % RAYS, i = Math.floor(k), u = k - i;
  return rays[i] * (1 - u) + rays[(i + 1) % RAYS] * u;
}

// многоугольник куска: внешний край — борт, внутренний — рваный разлом; координаты от центра куска, м
function piecePoly(rays, p, rand) {
  const steps = Math.max(2, Math.ceil((p.a1 - p.a0) / 0.18)), xs = [], ys = [];
  for (let k = 0; k <= steps; k++) {
    const a = p.a0 + (p.a1 - p.a0) * k / steps, r = rayAt(rays, a);
    xs.push(Math.cos(a) * r); ys.push(Math.sin(a) * r);
  }
  for (let k = steps; k >= 0; k--) {
    const a = p.a0 + (p.a1 - p.a0) * k / steps, r = rayAt(rays, a) * (1 - p.depth) * (0.75 + 0.5 * rand());
    xs.push(Math.cos(a) * r); ys.push(Math.sin(a) * r);
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < xs.length; i++) { cx += xs[i]; cy += ys[i]; }
  cx /= xs.length; cy /= ys.length;
  const poly = new Float32Array(xs.length * 2);
  let rad = 0;
  for (let i = 0; i < xs.length; i++) {
    poly[2 * i] = xs[i] - cx; poly[2 * i + 1] = ys[i] - cy;
    rad = Math.max(rad, Math.hypot(poly[2 * i], poly[2 * i + 1]));
  }
  return { poly, cx, cy, rad };
}

/* ---------- взрыв ---------- */
// ev — эффект из S.fx: kind, pos, vel, en, seed, t0; у гибели корабля ещё h (курс), hull (модель корпуса), id
export function explode(ev, now = clock.fx) {
  const en = ev.en ?? 1, vel = ev.vel || [0, 0], t0 = ev.t0 || 0, x0 = ev.pos[0], y0 = ev.pos[1];
  const rand = rng((ev.seed ?? 1) >>> 0), q = qk();
  const blast = { x0, y0, vx: vel[0], vy: vel[1], t0, born: now, en,
    flash: lerp(F.flash.life, rand()), shock: lerp(F.shock.life, rand()), sec: [], end: 0 };
  let end = Math.max(blast.flash, blast.shock, F.light.life);
  // огненный шар: клубы со смещением, радиус растёт по ease-out
  const nb = Math.max(3, Math.round(lerp(F.fireball.n, rand()) * en * q)), rb = F.fireball.r * Math.sqrt(en);
  for (let k = 0; k < nb; k++) {
    const i = bHead; bHead = (bHead + 1) % NB;
    const a = rand() * TAU, d = rb * 0.9 * Math.sqrt(rand());
    bX[i] = x0; bY[i] = y0; bVX[i] = vel[0]; bVY[i] = vel[1]; bT0[i] = t0; bB0[i] = now;
    bLife[i] = lerp(F.fireball.life, rand()); bOX[i] = Math.cos(a) * d; bOY[i] = Math.sin(a) * d;
    bR[i] = rb * (0.45 + 0.6 * rand()); bMin[i] = F.fireball.minPx * Math.sqrt(en) * (0.6 + 0.5 * rand()); bOn[i] = 1;
    end = Math.max(end, bLife[i]);
  }
  // искры: v = v_источника + dir·v0
  const ns = Math.round(lerp(F.sparks.n, rand()) * en * q);
  for (let k = 0; k < ns; k++) {
    const i = sHead; sHead = (sHead + 1) % N;
    const a = rand() * TAU, sp = fragSpeed(rand(), en) * F.sparks.vMul;
    sX[i] = x0; sY[i] = y0; sVX[i] = vel[0] + Math.cos(a) * sp; sVY[i] = vel[1] + Math.sin(a) * sp;
    sSp[i] = sp; sT0[i] = t0; sB0[i] = now; sLife[i] = lerp(F.sparks.life, rand()); sOn[i] = 1;
  }
  // обломки корпуса — тот же план, что у симуляции; опасные связаны со своим обломком в S.debris
  if (ev.kind === 'boom' && ev.hull != null) {
    const rays = hullRays(ev.hull), h = ev.h || 0, plan = debrisPlan(ev), prand = rng(((ev.seed ?? 1) ^ 0x5bd1e995) >>> 0);
    const ch = Math.cos(h), sh = Math.sin(h);
    for (const p of plan) {
      const { poly, cx, cy, rad } = piecePoly(rays, p, prand);
      const ref = p.big ? S?.debris?.find(d => d.b === ev.id && d.i === p.i) || null : null;
      pieces.push({ x0: x0 + cx * ch - cy * sh, y0: y0 + cx * sh + cy * ch, vx: p.vx, vy: p.vy, v0: p.v0, t0, born: now,
        rot: h, spin: p.spin, poly, rad, big: p.big, ref, cool: lerp(F.debrisFx.cool, prand()), on: true });
    }
    if (pieces.length > F.debrisFx.max) pieces.splice(0, pieces.length - F.debrisFx.max);
    // вторичные вспышки на крупных обломках через 50–300 мс
    const big = plan.filter(p => p.big), n2 = Math.max(1, Math.round(lerp(F.secondary.n, rand()) * Math.min(1, en) * q));
    for (let k = 0; k < n2 && big.length; k++) {
      const p = big[Math.floor(rand() * big.length)], delay = lerp(F.secondary.delay, rand());
      blast.sec.push({ vx: p.vx, vy: p.vy, delay, size: 0.4 + 0.4 * rand() });
      end = Math.max(end, delay + F.secondary.life);
    }
  }
  blast.end = end;
  blasts.push(blast);
  return blast;
}

// подсветка точки мира вспышками, 0…1
export function lightAt(x, y, now = clock.fx) {
  let l = 0;
  for (const b of blasts) {
    const age = now - b.born;
    if (age < 0 || age > F.light.life) continue;
    const R = F.light.r * Math.sqrt(b.en), g = clock.game - b.t0;
    const d = Math.hypot(x - b.x0 - b.vx * g, y - b.y0 - b.vy * g);
    if (d < R) l += Math.min(1, b.en) * (1 - age / F.light.life) * (1 - d / R);
  }
  return Math.min(1, l);
}

// тела берём из текущего боя; без боя (тесты рендера) столкновений нет
const bodyHitSafe = (x, y) => !!S?.bodies?.length && !!bodyHit(x, y);

/* ---------- шаг: остывшее и улетевшее убираем, новый бой очищает ---------- */
export function stepExplosions(state = S, now = clock.fx) {
  if (state !== lastS) { resetExplosions(); lastS = state; }
  const g = clock.game, R = F.simRadius;
  for (let i = 0; i < N; i++) {
    if (!sOn[i]) continue;
    const dt = g - sT0[i];
    if (dt * sSp[i] > R || bodyHitSafe(sX[i] + sVX[i] * dt, sY[i] + sVY[i] * dt)) sOn[i] = 0;
  }
  for (let i = 0; i < NB; i++) if (bOn[i] && now - bB0[i] > bLife[i]) bOn[i] = 0;
  if (blasts.length) blasts = blasts.filter(b => now - b.born <= b.end);
  let dead = 0;
  for (const p of pieces) {
    const dt = g - p.t0;
    if (p.ref ? p.ref.dead : dt * p.v0 > R || bodyHitSafe(p.x0 + p.vx * dt, p.y0 + p.vy * dt)) { p.on = false; dead++; }
  }
  if (dead) pieces = pieces.filter(p => p.on);
}

/* ---------- отрисовка ---------- */
// X, Y — мир → экран; mpp — метров на пиксель; W, H — размер экрана, px
export function drawExplosions(ctx, X, Y, mpp, W, H, now = clock.fx) {
  const g = clock.game, op = ctx.globalCompositeOperation;
  // обломки: тёмный корпус, пока горячие — светятся по температурной шкале
  for (const p of pieces) {
    const dt = g - p.t0, x = X(p.x0 + p.vx * dt), y = Y(p.y0 + p.vy * dt), rp = p.rad / mpp;
    if (x < -rp - 20 || x > W + rp + 20 || y < -rp - 20 || y > H + rp + 20) continue;
    const hg = glowCurve(Math.min(1, (now - p.born) / p.cool)), col = LUT[lutIdx(hg)];
    if (rp < 1.5) {
      const s = p.big ? 2 : 1.4;
      ctx.globalAlpha = 0.85; ctx.fillStyle = hg > 0.05 ? col : HULL.mid;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      continue;
    }
    const rot = p.rot + p.spin * dt, c = Math.cos(rot), s = Math.sin(rot), k = 1 / mpp, pl = p.poly;
    ctx.beginPath();
    for (let i = 0; i < pl.length; i += 2) {
      const px = x + (pl[i] * c - pl[i + 1] * s) * k, py = y - (pl[i] * s + pl[i + 1] * c) * k;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = 1; ctx.fillStyle = HULL.dark; ctx.fill();
    ctx.strokeStyle = HULL.mid; ctx.lineWidth = 1; ctx.stroke();
    if (hg > 0.02) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85 * hg; ctx.fillStyle = col; ctx.fill();
      ctx.globalCompositeOperation = op;
      drawGlow(ctx, glowSprite(col, 32), x, y, Math.max(6, rp * 1.6), 0.5 * hg);
    }
  }
  ctx.globalAlpha = 1;
  // искры: горячие — штрихи от прошлой позиции к текущей, разложенные по цветам (один путь на цвет);
  // остывшие — тёмная пыль
  bucketN.fill(0);
  ctx.fillStyle = FX_COL.ash; ctx.globalAlpha = 0.18;
  for (let i = 0; i < N; i++) {
    sBk[i] = 255;
    if (!sOn[i]) continue;
    const dt = g - sT0[i], x = X(sX[i] + sVX[i] * dt), y = Y(sY[i] + sVY[i] * dt);
    if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
    const u = (now - sB0[i]) / sLife[i];
    if (u >= 1) { ctx.fillRect(x, y, 1, 1); continue; }
    const b = lutIdx(glowCurve(Math.max(0, u)));
    sBk[i] = b; bucketN[b]++;
  }
  ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  for (let b = LUT_N - 1; b >= 0; b--) {
    if (!bucketN[b]) continue;
    const hot = b / (LUT_N - 1), tail = F.sparks.tail[0] + (F.sparks.tail[1] - F.sparks.tail[0]) * hot;
    ctx.strokeStyle = LUT[b]; ctx.globalAlpha = 0.35 + 0.65 * hot;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      if (sBk[i] !== b) continue;
      const dt = g - sT0[i], vx = sVX[i], vy = sVY[i];
      const hx = X(sX[i] + vx * dt), hy = Y(sY[i] + vy * dt), tdt = Math.max(0, dt - tail);
      let tx = X(sX[i] + vx * tdt), ty = Y(sY[i] + vy * tdt);
      // штрих не короче пикселя: при отдалении искра всё равно видна
      if (Math.hypot(hx - tx, hy - ty) < 1) { const v = Math.hypot(vx, vy) || 1; tx = hx - vx / v; ty = hy + vy / v; }
      ctx.moveTo(tx, ty); ctx.lineTo(hx, hy);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = op; ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  // клубы огненного шара: мягкие спрайты по температурной шкале, газ к концу прозрачный
  for (let i = 0; i < NB; i++) {
    if (!bOn[i]) continue;
    const u = (now - bB0[i]) / bLife[i];
    if (u < 0 || u >= 1) continue;
    const dt = g - bT0[i], e = easeOut(u);
    // при отдалении шар не меньше bMin пикселей: смещения клубов растут в той же пропорции
    const mag = Math.max(1, bMin[i] / (bR[i] / mpp));
    const x = X(bX[i] + bVX[i] * dt) + bOX[i] * e * mag / mpp, y = Y(bY[i] + bVY[i] * dt) - bOY[i] * e * mag / mpp;
    const hot = glowCurve(u);
    drawGlow(ctx, glowSprite(LUT[lutIdx(hot)], 64), x, y, bR[i] * mag / mpp * (0.35 + 0.65 * e), 0.9 * hot);
  }
  // вспышка, ударная волна и вторичные вспышки
  for (const b of blasts) {
    const age = now - b.born, dt = g - b.t0, cx = X(b.x0 + b.vx * dt), cy = Y(b.y0 + b.vy * dt);
    if (age < b.flash) {
      const R = Math.max(F.flash.minPx * Math.sqrt(b.en), F.flash.r * F.shipR * b.en / mpp);
      drawGlow(ctx, glowSprite(FX_COL.flash, 64), cx, cy, R, 1 - age / b.flash);
    }
    if (age < b.shock) {
      const u = age / b.shock, R = Math.max(F.shock.minPx * Math.sqrt(b.en), F.shock.r * Math.sqrt(b.en) / mpp) * easeOut(u);
      ctx.strokeStyle = FX_COL.shock; ctx.lineWidth = 1.5; ctx.globalAlpha = F.shock.alpha * (1 - u);
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, R), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (const s of b.sec) {
      const a2 = age - s.delay;
      if (a2 < 0 || a2 > F.secondary.life) continue;
      const R = Math.max(F.flash.minPx * 0.5 * s.size, F.flash.r * F.shipR * 0.4 * s.size / mpp);
      drawGlow(ctx, glowSprite(LUT[LUT_N - 4], 32), X(b.x0 + s.vx * dt), Y(b.y0 + s.vy * dt), R, 1 - a2 / F.secondary.life);
    }
  }
}
