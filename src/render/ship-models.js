// Детальные модели кораблей для крупного масштаба. Координаты в долях длины корпуса:
// нос в +x (0,5), корма в −x, ось y — поперёк корпуса. Модели симметричны относительно оси x
import { HULL } from './theme.js';

export const shipLength = s => s.isPlayer ? 46 : 55;

const mirrorY = top => top.concat(top.slice().reverse().map(([x, y]) => [x, -y]));
const flipY = pts => pts.map(([x, y]) => [x, -y]);

function path(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); }
function fill(ctx, pts, style, alpha = 1) { ctx.globalAlpha = alpha; ctx.fillStyle = style; path(ctx, pts); ctx.fill(); ctx.globalAlpha = 1; }
function both(ctx, pts, style, alpha) { fill(ctx, pts, style, alpha); fill(ctx, flipY(pts), style, alpha); }
function rect(ctx, x0, y0, x1, y1, style, alpha = 1) { ctx.globalAlpha = alpha; ctx.fillStyle = style; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.globalAlpha = 1; }
function line(ctx, x0, y0, x1, y1, style, w, alpha = 1) {
  ctx.globalAlpha = alpha; ctx.strokeStyle = style; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.globalAlpha = 1;
}
function dot(ctx, x, y, r, style, alpha = 1) { ctx.globalAlpha = alpha; ctx.fillStyle = style; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }

// объёмная заливка корпуса: верхний борт светлее
function hullShade(ctx, w) {
  const g = ctx.createLinearGradient(0, -w, 0, w);
  g.addColorStop(0, HULL.light); g.addColorStop(0.45, HULL.mid); g.addColorStop(1, HULL.dark);
  return g;
}

// факел из раструба: x — срез сопла, hw — полуширина, hot — 0…1
function flame(ctx, x, y, hw, hot) {
  if (hot < 0.02) return;
  const len = 0.08 + 0.3 * hot;
  const g = ctx.createLinearGradient(x, 0, x - len, 0);
  g.addColorStop(0, 'rgba(255,244,220,0.95)'); g.addColorStop(0.25, 'rgba(255,178,80,0.85)'); g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g; path(ctx, [[x, y + hw], [x - len, y + hw * 0.25], [x - len, y - hw * 0.25], [x, y - hw]]); ctx.fill();
  dot(ctx, x - 0.004, y, hw * 0.8, 'rgba(255,236,200,1)', 0.5 * hot);
}

// турель ПОО: основание и ствол в направлении look (единичный вектор в осях модели)
function pdc(ctx, x, y, look, r) {
  dot(ctx, x, y, r, HULL.dark);
  ctx.strokeStyle = HULL.light; ctx.lineWidth = r * 0.3; ctx.beginPath(); ctx.arc(x, y, r * 0.85, 0, 7); ctx.stroke();
  line(ctx, x, y, x + look[0] * r * 2.6, y + look[1] * r * 2.6, HULL.light, r * 0.45);
  dot(ctx, x, y, r * 0.35, HULL.seam);
}

/* ---------- корвет игрока в духе «Росинанта» ---------- */
const ROCI = {
  hull: [[0.5, 0]].concat(mirrorY([[0.47, 0.012], [0.42, 0.03], [0.34, 0.048], [0.30, 0.052], [0.29, 0.064], [0.16, 0.074],
    [0.15, 0.086], [0.02, 0.092], [0.0, 0.1], [-0.10, 0.104], [-0.12, 0.112], [-0.24, 0.118], [-0.27, 0.128],
    [-0.295, 0.15], [-0.325, 0.181], [-0.35, 0.2], [-0.368, 0.207], [-0.396, 0.207], [-0.406, 0.19], [-0.41, 0.15],
    [-0.425, 0.125], [-0.43, 0.1], [-0.45, 0.075]])),
  // кормовые пилоны с посадочными опорами
  pylon: [[-0.27, 0.128], [-0.295, 0.15], [-0.325, 0.181], [-0.35, 0.2], [-0.368, 0.207], [-0.396, 0.207], [-0.406, 0.19],
    [-0.41, 0.15], [-0.425, 0.125], [-0.30, 0.12]],
  bell: [[-0.45, 0.05], [-0.535, 0.088], [-0.535, -0.088], [-0.45, -0.05]],
  cockpit: [[0.418, 0.008], [0.378, 0.026], [0.346, 0.031], [0.346, 0.01]],
  seams: [0.29, 0.15, 0.0, -0.12, -0.27],
  ports: [0.245, 0.215, 0.185, 0.105, 0.075, 0.045],
  pdcs: [[0.33, 0.046], [0.06, 0.09], [-0.205, 0.114], [-0.38, 0.196]],
};

function drawRocinante(ctx, o) {
  const { col, px, hot, look } = o;
  flame(ctx, -0.535, 0, 0.075, hot);
  fill(ctx, ROCI.bell, HULL.engine);
  line(ctx, -0.535, -0.088, -0.535, 0.088, HULL.mid, px * 1.5);
  // рельсотрон: ствол торчит из носа
  rect(ctx, 0.47, -0.0045, 0.535, 0.0045, HULL.engine);
  fill(ctx, ROCI.hull, hullShade(ctx, 0.2));
  ctx.save(); path(ctx, ROCI.hull); ctx.clip();
  rect(ctx, 0.15, -0.3, 0.29, 0.3, '#ffffff', 0.07);
  rect(ctx, -0.27, -0.3, -0.12, 0.3, HULL.dark, 0.35);
  both(ctx, ROCI.pylon, HULL.dark, 0.55);
  // опознавательные полосы цвета стороны
  rect(ctx, -0.168, -0.3, -0.142, 0.3, col, 0.9);
  rect(ctx, 0.296, -0.3, 0.31, 0.3, col, 0.9);
  rect(ctx, -0.402, 0.186, -0.352, 0.21, col, 0.9); rect(ctx, -0.402, -0.21, -0.352, -0.186, col, 0.9);
  // киль рельсотрона от машинного отделения до носа
  rect(ctx, -0.12, -0.006, 0.5, 0.006, HULL.engine, 0.85);
  line(ctx, -0.11, 0, 0.49, 0, HULL.mid, px);
  // кольцо крепления двигателя и посадочные опоры в пилонах
  rect(ctx, -0.45, -0.3, -0.425, 0.3, HULL.engine, 0.6);
  for (const sg of [1, -1]) {
    line(ctx, -0.3, sg * 0.135, -0.385, sg * 0.198, HULL.seam, px * 1.6, 0.8);
    line(ctx, -0.33, sg * 0.135, -0.4, sg * 0.175, HULL.seam, px * 1.2, 0.6);
  }
  for (const x of ROCI.seams) line(ctx, x, -0.3, x, 0.3, HULL.seam, px, 0.8);
  for (const sg of [1, -1]) {
    line(ctx, 0.15, sg * 0.05, -0.27, sg * 0.05, HULL.seam, px, 0.45);
    for (const x of ROCI.ports) dot(ctx, x, sg * 0.064, 0.0055, HULL.glass, 0.85);
    for (const x of [-0.17, -0.195, -0.22]) line(ctx, x, sg * 0.06, x, sg * 0.1, HULL.seam, px * 1.3, 0.7);
  }
  both(ctx, ROCI.cockpit, HULL.glass, 0.9);
  rect(ctx, -0.035, 0.08, 0.01, 0.101, HULL.dark, 0.9);
  ctx.restore();
  ctx.strokeStyle = HULL.seam; ctx.lineWidth = px * 1.3; path(ctx, ROCI.hull); ctx.stroke();
  for (const [x, y] of ROCI.pdcs) { pdc(ctx, x, y, look, 0.016); pdc(ctx, x, -y, look, 0.016); }
  navLights(ctx, -0.38, 0.207, o.blink);
}

/* ---------- фрегат противника ---------- */
const FRIGATE = {
  hull: [[0.5, 0]].concat(mirrorY([[0.46, 0.03], [0.40, 0.045], [0.38, 0.085], [0.30, 0.095], [0.28, 0.07], [0.12, 0.075],
    [0.06, 0.12], [-0.18, 0.165], [-0.28, 0.165], [-0.31, 0.11], [-0.40, 0.105], [-0.42, 0.13], [-0.48, 0.13], [-0.48, 0.035]])),
  wing: [[0.06, 0.12], [-0.18, 0.165], [-0.28, 0.165], [-0.31, 0.11], [-0.05, 0.09]],
  edge: [[0.06, 0.12], [-0.18, 0.165], [-0.2, 0.15], [0.04, 0.108]],
  sponson: [[0.38, 0.085], [0.30, 0.095], [0.29, 0.075], [0.37, 0.07]],
  bell: [[-0.48, 0.118], [-0.555, 0.128], [-0.555, 0.032], [-0.48, 0.042]],
  bridge: [0.255, 0.232, 0.209, 0.186],
  seams: [0.38, 0.28, 0.12, -0.05, -0.18, -0.31, -0.40],
  pdcs: [[0.34, 0.083], [-0.1, 0.142], [-0.445, 0.122]],
};

function drawFrigate(ctx, o) {
  const { col, px, hot, look } = o;
  for (const sg of [1, -1]) {
    flame(ctx, -0.555, sg * 0.08, 0.045, hot);
    fill(ctx, sg > 0 ? FRIGATE.bell : flipY(FRIGATE.bell), HULL.engine);
  }
  fill(ctx, FRIGATE.hull, hullShade(ctx, 0.2));
  ctx.save(); path(ctx, FRIGATE.hull); ctx.clip();
  rect(ctx, -0.4, -0.022, 0.4, 0.022, HULL.dark, 0.55);
  both(ctx, FRIGATE.wing, HULL.dark, 0.45);
  both(ctx, FRIGATE.edge, col, 0.9);
  both(ctx, FRIGATE.sponson, col, 0.85);
  rect(ctx, -0.42, -0.3, -0.405, 0.3, col, 0.8);
  for (const x of FRIGATE.seams) line(ctx, x, -0.3, x, 0.3, HULL.seam, px, 0.75);
  for (const sg of [1, -1]) {
    line(ctx, 0.28, sg * 0.05, -0.4, sg * 0.05, HULL.seam, px, 0.45);
    for (const x of FRIGATE.bridge) rect(ctx, x - 0.008, sg * 0.03 - 0.005, x + 0.008, sg * 0.03 + 0.005, HULL.glass, 0.85);
    for (let x = -0.14; x > -0.27; x -= 0.025) line(ctx, x, sg * 0.1, x - 0.02, sg * 0.14, HULL.seam, px * 1.2, 0.6);
  }
  ctx.restore();
  ctx.strokeStyle = HULL.seam; ctx.lineWidth = px * 1.3; path(ctx, FRIGATE.hull); ctx.stroke();
  // главная башня со спаренными стволами
  dot(ctx, 0.17, 0, 0.042, HULL.dark);
  ctx.strokeStyle = HULL.light; ctx.lineWidth = px * 1.2; ctx.beginPath(); ctx.arc(0.17, 0, 0.036, 0, 7); ctx.stroke();
  const nx = -look[1], ny = look[0];
  for (const sg of [1, -1]) line(ctx, 0.17 + nx * 0.012 * sg, ny * 0.012 * sg, 0.17 + nx * 0.012 * sg + look[0] * 0.1, ny * 0.012 * sg + look[1] * 0.1, HULL.light, 0.009);
  for (const [x, y] of FRIGATE.pdcs) { pdc(ctx, x, y, look, 0.016); pdc(ctx, x, -y, look, 0.016); }
  navLights(ctx, -0.23, 0.167, o.blink);
}

// ходовые огни: красный по левому борту, зелёный по правому, мигают
function navLights(ctx, x, y, on) {
  dot(ctx, x, y, 0.009, '#ff4d4d', on ? 1 : 0.25);
  dot(ctx, x, -y, 0.009, '#5dff8a', on ? 1 : 0.25);
}

// корабль s в точке (x, y) экрана; Lp — длина корпуса в пикселях; aim — мировой угол, куда смотрят турели
export function drawShipModel(ctx, s, col, Lp, x, y, aim) {
  const d = aim - s.heading;
  const o = { col, px: 1 / Lp, hot: Math.min(1, s.accG / 2), look: [Math.cos(d), -Math.sin(d)], blink: Math.floor(performance.now() / 700) % 2 === 0 };
  ctx.save(); ctx.translate(x, y); ctx.rotate(-s.heading); ctx.scale(Lp, Lp);
  (s.isPlayer ? drawRocinante : drawFrigate)(ctx, o);
  ctx.restore();
}
