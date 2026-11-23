// Процедурные планеты и луны. Поверхность один раз рисуется в развёртку (долгота × широта): каждой точке
// единичной сферы (x, y, z) — цвет по трёхмерному шуму, поэтому рисунок ложится на шар без швов.
// Диск на экране берётся из развёртки со сдвигом по долготе — так тело медленно вращается.
// Тень рельефа кратеров считается в осях экрана от солнца (LIGHT), поверх ложится тень ночной стороны
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

// рельеф кратера в точке сферы: чаша ниже поверхности, вал вокруг неё приподнят. 0 — вне кратеров
function craterHeight(craters, x, y, z) {
  let h = 0;
  for (const c of craters) {
    const dx = x - c.x, dy = y - c.y, dz = z - c.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > c.r * c.r * 1.44) continue;
    const d = Math.sqrt(d2) / c.r;
    h += d < 1 ? (d * d - 1) * c.r * 0.5 : c.r * 0.12 * (1.2 - d) / 0.2;
  }
  return h;
}

// развёртка поверхности w×h: долгота по x, широта по y. Ось вращения тела — вертикаль экрана (y).
// Цвет без освещения (RGB) и высота рельефа. Чистая функция, работает и без DOM
export function paintMap(w, h, look, seed) {
  const rgb = new Uint8ClampedArray(w * h * 3), height = new Float32Array(w * h);
  const rand = rng(seed);
  const paint = PAINT[look] || PAINT.rock;
  const craters = makeCraters(CRATERS[look] || 0, rand);
  const ctx = { phase: rand() * 6, spot: [rand() * 0.8 - 0.4, rand() * 0.9 - 0.45, 0.1 + rand() * 0.08] };
  for (let j = 0; j < h; j++) {
    const lat = ((j + 0.5) / h - 0.5) * Math.PI, y = Math.sin(lat), cl = Math.cos(lat);
    for (let i = 0; i < w; i++) {
      const lon = (i + 0.5) / w * 2 * Math.PI - Math.PI, x = cl * Math.sin(lon), z = cl * Math.cos(lon);
      const c = paint(x, y, z, seed, ctx), hh = craters.length ? craterHeight(craters, x, y, z) : 0;
      // дно кратера темнее окружающей поверхности
      const k = hh < 0 ? 0.88 : 1, o = j * w + i;
      rgb[o * 3] = c[0] * k; rgb[o * 3 + 1] = c[1] * k; rgb[o * 3 + 2] = c[2] * k;
      height[o] = hh;
    }
  }
  return { w, h, rgb, height, relief: craters.length > 0 };
}

// геометрия диска size×size: для каждого пикселя — место на развёртке без поворота, потемнение к краю и прозрачность
const discCache = new Map();
function disc(size, mw, mh) {
  const key = size + ':' + mw + ':' + mh;
  let d = discCache.get(key);
  if (d) return d;
  const n = size * size, u = new Float32Array(n), v = new Float32Array(n), limb = new Float32Array(n), alpha = new Uint8ClampedArray(n);
  const half = size / 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / half - 1, y = (j + 0.5) / half - 1, d2 = x * x + y * y, o = j * size + i;
      if (d2 > 1) continue;
      const z = Math.sqrt(1 - d2);
      u[o] = (Math.atan2(x, z) + Math.PI) / (2 * Math.PI) * mw - 0.5;
      v[o] = clamp((Math.asin(y) / Math.PI + 0.5) * mh - 0.5, 0, mh - 1);
      limb[o] = 0.62 + 0.38 * Math.sqrt(z);
      alpha[o] = clamp((1 - Math.sqrt(d2)) * half + 0.5, 0, 1) * 255;
    }
  }
  d = { u, v, limb, alpha, h: new Float32Array(n) };
  discCache.set(key, d);
  if (discCache.size > 8) discCache.delete(discCache.keys().next().value);
  return d;
}

const RELIEF = 0.55;  // сила тени рельефа
const LN = Math.hypot(LIGHT[0], LIGHT[1]), LX = LIGHT[0] / LN, LY = LIGHT[1] / LN;

// RGBA-пиксели диска size×size из развёртки map, повёрнутой на rot радиан вокруг вертикали.
// Тень рельефа считается в осях экрана, поэтому свет падает с той же стороны, что и у кораблей.
// out — массив для результата (переиспользуется между кадрами)
export function projectMap(map, size, rot, out = new Uint8ClampedArray(size * size * 4)) {
  const { w, h, rgb, height, relief } = map, d = disc(size, w, h), n = size * size;
  const shift = (((rot / (2 * Math.PI)) % 1) + 1) % 1 * w;
  for (let o = 0; o < n; o++) {
    const a = d.alpha[o];
    out[o * 4 + 3] = a;
    if (!a) continue;
    // билинейная выборка с переходом через линию смены дат
    let uu = d.u[o] + shift;
    uu -= Math.floor(uu / w) * w;
    const i0 = Math.floor(uu), fu = uu - i0, i1 = i0 + 1 === w ? 0 : i0 + 1;
    const j0 = Math.floor(d.v[o]), fv = d.v[o] - j0, j1 = Math.min(h - 1, j0 + 1);
    const p00 = j0 * w + i0, p10 = j0 * w + i1, p01 = j1 * w + i0, p11 = j1 * w + i1;
    const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv), w01 = (1 - fu) * fv, w11 = fu * fv, k = d.limb[o];
    for (let c = 0; c < 3; c++) out[o * 4 + c] = (rgb[p00 * 3 + c] * w00 + rgb[p10 * 3 + c] * w10 + rgb[p01 * 3 + c] * w01 + rgb[p11 * 3 + c] * w11) * k;
    if (relief) d.h[o] = height[p00] * w00 + height[p10] * w10 + height[p01] * w01 + height[p11] * w11;
  }
  if (relief) {
    // склон к солнцу светлее, от солнца — темнее; уклон в долях радиуса на пиксель
    const px = size / 2;
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        const o = j * size + i;
        if (!d.alpha[o]) continue;
        const gx = (d.h[o + 1] - d.h[o - 1]) * px / 2, gy = (d.h[o + size] - d.h[o - size]) * px / 2;
        const k = clamp(1 - RELIEF * (gx * LX + gy * LY), 0.55, 1.4);
        out[o * 4] *= k; out[o * 4 + 1] *= k; out[o * 4 + 2] *= k;
      }
    }
  }
  return out;
}

// RGBA-пиксели диска size×size, повёрнутого на rot радиан; чистая функция, работает и без DOM
export function paintSphere(size, look, seed, rot = 0) {
  return projectMap(paintMap(Math.max(64, size * 2), Math.max(32, size), look, seed), size, rot);
}

// вращение тела: период из зерна, у планет 3–5 мин, у лун 5–8 мин; направление тоже из зерна.
// t — часы рендера clock.fx: реальные секунды без пауз, поэтому скорость не зависит от ускорения времени
export function spinAt(b, t) {
  const r = rng(b.seed ^ 0x5f3759df), period = (b.kind === 'planet' ? 180 + 120 * r() : 300 + 180 * r());
  return (r() < 0.5 ? -1 : 1) * 2 * Math.PI * t / period;
}

const MAP_W = { planet: 768, moon: 384 };   // ширина развёртки: на диске 512 px видно полразвёртки, 384 точки
const STEP_PX = 0.5;      // диск пересчитывается, когда точка на экваторе сдвинулась на столько пикселей
const bodies = new Map();

// текстура тела для экранного радиуса r и угла поворота rot: развёртка рисуется один раз,
// диск пересчитывается, когда поворот сдвинул экватор на STEP_PX экранных пикселей или изменился размер
function texture(b, r, rot) {
  const key = b.look + ':' + b.seed + ':' + b.kind;
  let e = bodies.get(key);
  if (!e) {
    const w = MAP_W[b.kind] || 384;
    e = { map: paintMap(w, w / 2, b.look, b.seed), size: 0, rot: NaN, cv: null, px: null, img: null };
    bodies.set(key, e);
    if (bodies.size > 12) bodies.delete(bodies.keys().next().value);
  }
  const maxSize = b.kind === 'planet' ? 512 : 256;
  const size = Math.min(maxSize, Math.max(64, 2 ** Math.ceil(Math.log2(2 * r))));
  const turned = !(Math.abs(rot - e.rot) * r < STEP_PX);
  if (size !== e.size || turned) {
    if (size !== e.size) {
      e.cv = document.createElement('canvas'); e.cv.width = e.cv.height = size;
      // пишем прямо в img.data: некоторые реализации ImageData копируют переданный массив
      e.img = new ImageData(new Uint8ClampedArray(size * size * 4), size, size); e.px = e.img.data; e.size = size;
    }
    projectMap(e.map, size, rot, e.px);
    e.cv.getContext('2d').putImageData(e.img, 0, 0);
    e.rot = rot;
  }
  return e.cv;
}

// тело с центром (x, y) и радиусом r в экранных пикселях; t — часы рендера clock.fx: по ним тело вращается
export function drawBody(ctx, b, x, y, r, t = 0) {
  if (r < 2.5) {
    ctx.fillStyle = '#7d8a96'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill();
    return;
  }
  ctx.drawImage(texture(b, r, spinAt(b, t)), x - r, y - r, 2 * r, 2 * r);
  // ночная сторона: тень, сдвинутая от солнца; терминатор резче, ночь почти чёрная
  const [lx, ly] = LIGHT;
  const g = ctx.createRadialGradient(x + lx * r * 0.55, y + ly * r * 0.55, 0, x + lx * r * 0.3, y + ly * r * 0.3, r * 1.45);
  g.addColorStop(0, 'rgba(255,248,230,0.08)'); g.addColorStop(0.34, 'rgba(0,0,0,0)');
  g.addColorStop(0.62, 'rgba(3,6,10,0.72)'); g.addColorStop(0.8, 'rgba(3,6,10,0.93)'); g.addColorStop(1, 'rgba(3,6,10,0.98)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  // тела приглушены: фон не спорит с метками боя
  ctx.fillStyle = rgba(C.paper, 0.18); ctx.fill();
  if (ATMO[b.look]) atmosphere(ctx, ATMO[b.look], x, y, r); else rim(ctx, x, y, r);
}

const SECTORS = 16;
const LIGHT_A = Math.atan2(LIGHT[1], LIGHT[0]);

// тонкий ореол атмосферы поверх диска: кольцо от r до 1,06·r. Атмосфера есть только у планет
// земного типа, пустынных и газовых (ATMO); светится дневная сторона, ночная почти не видна.
// Кольцо режется на секторы, яркость сектора плавно меняется с углом к солнцу
function atmosphere(ctx, col, x, y, r) {
  const R = r * 1.06;
  const g = ctx.createRadialGradient(x, y, r * 0.985, x, y, R);
  g.addColorStop(0, rgba(col, 0.32)); g.addColorStop(0.45, rgba(col, 0.1)); g.addColorStop(1, rgba(col, 0));
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g;
  const da = 2 * Math.PI / SECTORS;
  for (let i = 0; i < SECTORS; i++) {
    const a0 = i * da, mid = a0 + da / 2;
    ctx.globalAlpha = 0.12 + 0.88 * Math.max(0, Math.cos(mid - LIGHT_A));
    ctx.beginPath(); ctx.arc(x, y, R, a0, a0 + da + 0.01); ctx.arc(x, y, r * 0.985, a0 + da + 0.01, a0, true); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = op;
}

// тело без атмосферы: тонкая светлая кромка на освещённой стороне
function rim(ctx, x, y, r) {
  ctx.strokeStyle = rgba(C.rim, 0.45); ctx.lineWidth = Math.min(1.5, Math.max(0.75, r * 0.02));
  ctx.beginPath(); ctx.arc(x, y, r - ctx.lineWidth / 2, LIGHT_A - 1.2, LIGHT_A + 1.2); ctx.stroke();
}
