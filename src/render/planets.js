// Процедурные планеты и луны. Текстура — вид на полусферу: для каждого пикселя диска берём точку
// на единичной сфере (x, y, z) и красим её по трёхмерному шуму, поэтому рисунок ложится на шар без швов.
// Свет от солнца (LIGHT) запечён в кратеры и наложен поверх тенью ночной стороны
import { clamp } from '../lib/math.js';
import { fbm, noise3, rng } from '../lib/noise.js';
import { LIGHT, ATMO, C } from './theme.js';
import { rgba } from './glow.js';

const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const stops = list => list.map(([t, c]) => [t, hex(c)]);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// шум fbm собран около 0,5; растягиваем его на весь диапазон
const stretch = (h, k) => clamp((h - 0.5) * k + 0.5, 0, 1);

function ramp(st, t) {
  if (t <= st[0][0]) return st[0][1];
  for (let i = 1; i < st.length; i++) {
    if (t <= st[i][0]) { const [t0, c0] = st[i - 1], [t1, c1] = st[i]; return mix(c0, c1, (t - t0) / (t1 - t0)); }
  }
  return st[st.length - 1][1];
}

const PAL = {
  ocean: stops([[0, '#081a33'], [0.7, '#123a63'], [1, '#2a6d8c']]),
  land: stops([[0, '#c8b98a'], [0.06, '#4c7633'], [0.4, '#3a5c29'], [0.65, '#7a6743'], [0.85, '#a2998b'], [1, '#eef1f3']]),
  desert: stops([[0, '#3f1d12'], [0.3, '#7f3a20'], [0.55, '#b0603a'], [0.78, '#cf975f'], [1, '#ead0a6']]),
  ice: stops([[0, '#6f8ea6'], [0.5, '#bcd2e0'], [1, '#f3f8fb']]),
  gas: stops([[0, '#6e4129'], [0.3, '#a8744a'], [0.6, '#d9bd94'], [1, '#f2e7d1']]),
  rock: stops([[0, '#3e3f42'], [0.5, '#77787b'], [1, '#b5b4b0']]),
};
const CLOUD = hex('#f4f7f9'), CAP = hex('#e9f0f4'), CRACK = hex('#4b6b83'), STORM = hex('#b4472d'), MARE = hex('#35363a');

// раскраска точки сферы; ctx — заранее посчитанные для тела величины (пятно бури и т. п.)
const PAINT = {
  terra(x, y, z, seed) {
    const h = stretch(fbm(x * 1.8, y * 1.8, z * 1.8, seed, 6), 2.6);
    let c = h < 0.56 ? ramp(PAL.ocean, h / 0.56) : ramp(PAL.land, (h - 0.56) / 0.44);
    const cap = Math.abs(y) + (h - 0.5) * 0.25;
    if (cap > 0.84) c = mix(c, CAP, clamp((cap - 0.84) * 12, 0, 1));
    // облака вытянуты вдоль параллелей
    const cl = fbm(x * 3 + 7, y * 7, z * 3, seed + 101, 5);
    return mix(c, CLOUD, clamp((cl - 0.56) * 4, 0, 0.85));
  },
  desert(x, y, z, seed) {
    let c = ramp(PAL.desert, stretch(fbm(x * 2, y * 2, z * 2, seed, 7), 2.8));
    const cap = Math.abs(y) + (fbm(x * 4, y * 4, z * 4, seed + 5, 3) - 0.5) * 0.2;
    if (cap > 0.9) c = mix(c, CAP, clamp((cap - 0.9) * 15, 0, 0.9));
    return c;
  },
  ice(x, y, z, seed) {
    const c = ramp(PAL.ice, stretch(fbm(x * 2.2, y * 2.2, z * 2.2, seed, 5), 2));
    // трещины — линии, где шум пересекает середину; их рисунок искажён другим шумом, а яркость гуляет
    const wx = (fbm(x * 3, y * 3, z * 3, seed + 3, 3) - 0.5) * 1.5;
    const r = 1 - Math.abs(noise3(x * 5 + wx, y * 5 - wx, z * 5, seed + 9) - 0.5) * 2;
    const r2 = 1 - Math.abs(noise3(x * 13, y * 13 + wx, z * 13, seed + 11) - 0.5) * 2;
    const fade = fbm(x * 2, y * 2, z * 2, seed + 13, 2);
    let o = c;
    if (r > 0.955) o = mix(o, CRACK, (r - 0.955) / 0.045 * 0.8 * fade * 1.4);
    if (r2 > 0.97) o = mix(o, CRACK, (r2 - 0.97) / 0.03 * 0.45 * fade);
    return o;
  },
  gas(x, y, z, seed, ctx) {
    const turb = fbm(x * 4, y * 4, z * 4, seed, 5) - 0.5;
    const t = y * 7 + turb * 2.6 + Math.sin(y * 13 + ctx.phase) * 0.2;
    // широкие полосы плюс тонкая штриховка внутри них
    let c = ramp(PAL.gas, clamp(0.5 + 0.5 * Math.sin(t * Math.PI) + Math.sin(t * 9.7) * 0.07, 0, 1));
    const sx = x - ctx.spot[0], sy = (y - ctx.spot[1]) * 1.9, d = (sx * sx + sy * sy) / (ctx.spot[2] * ctx.spot[2]);
    if (d < 1) c = mix(c, STORM, (1 - d) * 0.8);
    return c;
  },
  rock(x, y, z, seed) {
    let c = ramp(PAL.rock, stretch(fbm(x * 2.5, y * 2.5, z * 2.5, seed, 6), 2));
    const m = fbm(x * 1.2, y * 1.2, z * 1.2, seed + 33, 3);
    if (m > 0.55) c = mix(c, MARE, clamp((m - 0.55) * 6, 0, 0.7));
    return c;
  },
};

const CRATERS = { rock: 80, desert: 55, ice: 10 };

function makeCraters(n, rand) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const z = rand() * 2 - 1, a = rand() * 2 * Math.PI, s = Math.sqrt(1 - z * z);
    const r = 0.015 + 0.11 * rand() ** 3;
    out.push({ x: s * Math.cos(a), y: s * Math.sin(a), z, r });
  }
  return out;
}

// множитель яркости от кратеров: дно темнее, стенка со стороны солнца в тени, дальняя освещена, вал приподнят
function craterShade(craters, x, y, z) {
  let k = 1;
  for (const c of craters) {
    const dx = x - c.x, dy = y - c.y, dz = z - c.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > c.r * c.r * 1.44) continue;
    const d = Math.sqrt(d2) / c.r, s = (dx * LIGHT[0] + dy * LIGHT[1]) / c.r;
    if (d < 1) k *= 0.86 - 0.35 * s;
    else k *= 1 + 0.6 * s * (1.2 - d);
  }
  return k;
}

// RGBA-пиксели диска size×size; чистая функция, работает и без DOM
export function paintSphere(size, look, seed) {
  const px = new Uint8ClampedArray(size * size * 4);
  const rand = rng(seed);
  const paint = PAINT[look] || PAINT.rock;
  const craters = makeCraters(CRATERS[look] || 0, rand);
  const ctx = { phase: rand() * 6, spot: [rand() * 0.8 - 0.4, rand() * 0.9 - 0.45, 0.1 + rand() * 0.08] };
  const half = size / 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / half - 1, y = (j + 0.5) / half - 1, d2 = x * x + y * y;
      if (d2 > 1) continue;
      const z = Math.sqrt(1 - d2);
      const c = paint(x, y, z, seed, ctx);
      // потемнение к краю диска придаёт объём
      const k = craterShade(craters, x, y, z) * (0.62 + 0.38 * Math.sqrt(z));
      const o = (j * size + i) * 4;
      px[o] = c[0] * k; px[o + 1] = c[1] * k; px[o + 2] = c[2] * k;
      px[o + 3] = clamp((1 - Math.sqrt(d2)) * half + 0.5, 0, 1) * 255;
    }
  }
  return px;
}

const cache = new Map();

function texture(b) {
  const key = b.look + ':' + b.seed;
  let t = cache.get(key);
  if (!t) {
    const size = b.kind === 'planet' ? 512 : 256;
    t = document.createElement('canvas');
    t.width = t.height = size;
    t.getContext('2d').putImageData(new ImageData(paintSphere(size, b.look, b.seed), size, size), 0, 0);
    cache.set(key, t);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
  }
  return t;
}

// тело с центром (x, y) и радиусом r в экранных пикселях
export function drawBody(ctx, b, x, y, r) {
  if (r < 2.5) {
    ctx.fillStyle = '#7d8a96'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill();
    return;
  }
  ctx.drawImage(texture(b), x - r, y - r, 2 * r, 2 * r);
  // ночная сторона: тень, сдвинутая от солнца
  const [lx, ly] = LIGHT;
  const g = ctx.createRadialGradient(x + lx * r * 0.55, y + ly * r * 0.55, 0, x + lx * r * 0.3, y + ly * r * 0.3, r * 1.45);
  g.addColorStop(0, 'rgba(255,248,230,0.10)'); g.addColorStop(0.38, 'rgba(0,0,0,0)');
  g.addColorStop(0.75, 'rgba(3,6,10,0.62)'); g.addColorStop(1, 'rgba(3,6,10,0.95)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  if (ATMO[b.look]) atmosphere(ctx, ATMO[b.look], x, y, r); else rim(ctx, x, y, r);
}

const SECTORS = 16;
const LIGHT_A = Math.atan2(LIGHT[1], LIGHT[0]);

// ореол атмосферы поверх диска: кольцо от r до 1,12·r, на дневной стороне вдвое ярче, чем на ночной.
// Кольцо режется на секторы, яркость сектора плавно меняется с углом к солнцу
function atmosphere(ctx, col, x, y, r) {
  const R = r * 1.12;
  const g = ctx.createRadialGradient(x, y, r * 0.985, x, y, R);
  g.addColorStop(0, rgba(col, 0.35)); g.addColorStop(0.4, rgba(col, 0.14)); g.addColorStop(1, rgba(col, 0));
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g;
  const da = 2 * Math.PI / SECTORS;
  for (let i = 0; i < SECTORS; i++) {
    const a0 = i * da, mid = a0 + da / 2;
    ctx.globalAlpha = 0.5 + 0.5 * Math.max(0, Math.cos(mid - LIGHT_A));
    ctx.beginPath(); ctx.arc(x, y, R, a0, a0 + da + 0.01); ctx.arc(x, y, r * 0.985, a0 + da + 0.01, a0, true); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = op;
}

// тело без атмосферы: тонкая светлая кромка на освещённой стороне
function rim(ctx, x, y, r) {
  ctx.strokeStyle = rgba(C.rim, 0.45); ctx.lineWidth = Math.min(1.5, Math.max(0.75, r * 0.02));
  ctx.beginPath(); ctx.arc(x, y, r - ctx.lineWidth / 2, LIGHT_A - 1.2, LIGHT_A + 1.2); ctx.stroke();
}
