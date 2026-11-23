// Кадр тактической карты: фон, тела, прогноз курса, оружие, корабли, эффекты и подписи.
// Светится только то, что излучает энергию: двигатели, торпеды, взрывы; сетка и кольца — самый тихий слой
import { G0, FLAK, PLUME, SHIP, DETECT } from '../config.js';
import { draft, draftForecast } from '../maneuver.js';
import { dist } from '../lib/math.js';
import { fmtDist } from '../lib/format.js';
import { S, predictPath, mainBody, surfaceG, timeToImpact, myShip, viewShip, PLAN_STEP } from '../sim/index.js';
import { run } from '../run.js';
import { pointer, COARSE } from '../ui/pointer.js';
import { C, FONT } from './theme.js';
import { t as txt } from '../i18n.js';
import { cam, camCenter, screenToWorld, addShake, updateShake } from './camera.js';
import { updateStars, drawStars } from './stars.js';
import { drawBody } from './planets.js';
import { drawShipModel, drawShipIcon, shipLength } from './ship-models.js';
import { iconLen, modelMix } from './lod.js';
import { clock, tickClock, pulse, reducedMotion } from './clock.js';
import { glowSprite, drawGlow, rgba } from './glow.js';
import { queueLabel, flushLabels, reserveRect, P } from './labels.js';
import { syncFx, drawFx } from './fx.js';
import { newTrails, updateTrails, trailOf } from './trails.js';

const GRAV_RINGS = [0.5, 0.2, 0.1, 0.05];   // линии равного притяжения, в g
const PREDICT = { T: 240, h: 0.5 };          // горизонт и шаг прогноза курса, с
const SIGNATURE_G = 0.3;                     // с такой тяги двигатель выдаёт корабль на любой дистанции (sensors.js)
const TORP_PX = 10;                          // длина значка торпеды, px
const TICK_LABELS = [30, 60, 120, 240];      // подписанные отметки времени на прогнозе, с
const TICK_GAP = 64;                         // подписи отметок не ближе этого друг к другу и к кораблю, px
const TORP_TRAIL = 12;                       // след торпеды: последние точки (раз в секунду)
const PLUME_EASE = 0.12;                     // постоянная времени разгорания и затухания факела на экране, реальные с

// view — корабль, чьими глазами смотрим (свой, а после гибели — союзник); его команда — «свои»
let ctx = null, vx = 0, vy = 0, view = null, perf = null;
const sideCol = team => team === view.team ? C.me : C.foe;
const X = x => (x - vx) / cam.mpp + cam.w / 2;
const Y = y => cam.h / 2 - (y - vy) / cam.mpp;
const trails = newTrails();

export function initScene(canvas) {
  ctx = canvas.getContext('2d');
  // ?perf=1 — время draw() в углу карты
  try { if (/[?&]perf=1\b/.test(globalThis.location?.search || '')) perf = { ms: 0 }; } catch (_) {}
}

// dtReal — реальные секунды с прошлого кадра
export function draw(dtReal = 0) {
  const t0 = perf ? performance.now() : 0;
  tickClock(dtReal, run.paused);
  updateShake(dtReal);
  ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, cam.w, cam.h);
  view = viewShip();
  [vx, vy] = camCenter();
  updateStars(vx, vy);
  drawStars(ctx, cam.w, cam.h);
  watchFx();
  // тряска сдвигает только карту; DOM-интерфейс, линейка и крупные подписи внизу стоят на месте
  ctx.save(); ctx.translate(cam.sx, cam.sy);
  ctx.font = '500 12px ' + FONT; ctx.textBaseline = 'middle';
  const gridStep = drawGrid();
  drawRangeRings();
  drawBodies();
  drawTrails();
  easePlumes();
  const plan = draft.open && myShip().alive ? draftForecast() : null;
  if (plan) drawPlan(plan, myShip());
  else if (myShip().alive) drawPrediction(myShip());
  drawFlakCone();
  drawPellets();
  drawTorps();
  drawShips();
  drawFx(ctx, X, Y, cam.mpp, sideCol, Math.min(cam.w, cam.h) * 0.22);
  drawEdgeMarkers();
  // место крупной скорости и сближения внизу по центру
  reserveRect(cam.w / 2 - 130 - cam.sx, cam.h - 56 - cam.sy, cam.w / 2 + 130 - cam.sx, cam.h - cam.sy);
  flushLabels(ctx);
  ctx.restore();
  drawScaleBar(gridStep);
  drawCaptions();
  if (perf) drawPerf(t0);
}

function drawPerf(t0) {
  perf.ms += (performance.now() - t0 - perf.ms) * 0.1;
  ctx.font = '500 12px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = perf.ms > 6 ? C.warn : C.ink2;
  ctx.fillText('draw ' + perf.ms.toFixed(2) + ' ms', 16, cam.h - 44);
}

// новые эффекты и попадания: тряска камеры, снос свечения расплавленной торпеды вдоль факела
let prevMe = null;
function watchFx() {
  const me = myShip(), fresh = syncFx(S);
  const mx = X(me.pos[0]), my = Y(me.pos[1]);
  for (const r of fresh) {
    if (r.kind === 'melt') {
      // торпеду расплавил факел ближайшего корабля другой стороны: свечение сносит от него
      let src = null, bd = Infinity;
      for (const s of S.ships) if (s.team !== r.owner) { const d = dist(s.pos, r.pos); if (d < bd) { bd = d; src = s; } }
      if (src) { const dx = r.pos[0] - src.pos[0], dy = r.pos[1] - src.pos[1], l = Math.hypot(dx, dy) || 1; r.drift = [dx / l, -dy / l]; }
    }
    if (r.kind === 'boom' || r.kind === 'burst' || r.kind === 'frag') {
      const d = Math.hypot(X(r.pos[0]) - mx, Y(r.pos[1]) - my), big = r.kind === 'boom' ? 6 : 3;
      if (d < 300) addShake(big * (1 - d / 300));
    }
  }
  // попадания по своему кораблю (шарики, выхлоп, осколки) и своя гибель
  if (prevMe && prevMe.S === S && prevMe.id === me.id) {
    if (prevMe.alive && !me.alive) addShake(10);
    else if (me.hp < prevMe.hp - 0.01) addShake(Math.min(2, 1 + (prevMe.hp - me.hp) / 5));
  }
  prevMe = { S, id: me.id, hp: me.hp, alive: me.alive };
}

function niceStep(x) {
  const e = Math.pow(10, Math.floor(Math.log10(x))), m = x / e;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
}

// сетка с запасом за край экрана, чтобы при тряске не было видно её конца
function drawGrid() {
  const W = cam.w, H = cam.h, step = niceStep(cam.mpp * 110), pad = 12;
  ctx.lineWidth = 1; ctx.strokeStyle = C.grid; ctx.beginPath();
  const i0 = Math.floor((vx - (W / 2 + pad) * cam.mpp) / step), i1 = Math.ceil((vx + (W / 2 + pad) * cam.mpp) / step);
  for (let i = i0; i <= i1; i++) { const sx = Math.round(X(i * step)) + .5; ctx.moveTo(sx, -pad); ctx.lineTo(sx, H + pad); }
  const j0 = Math.floor((vy - (H / 2 + pad) * cam.mpp) / step), j1 = Math.ceil((vy + (H / 2 + pad) * cam.mpp) / step);
  for (let j = j0; j <= j1; j++) { const sy = Math.round(Y(j * step)) + .5; ctx.moveTo(-pad, sy); ctx.lineTo(W + pad, sy); }
  ctx.stroke();
  return step;
}

// дальномерные круги вокруг своего корабля и граница обнаружения
function drawRangeRings() {
  const me = view, rs = niceStep(cam.mpp * 200), sx0 = X(me.pos[0]), sy0 = Y(me.pos[1]);
  const mx = Math.hypot(cam.w, cam.h) / 2 + Math.hypot(sx0 - cam.w / 2, sy0 - cam.h / 2);
  ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.setLineDash([2, 5]); ctx.globalAlpha = 0.7;
  for (let k = 1; k * rs / cam.mpp < mx && k < 40; k++) {
    const r = k * rs / cam.mpp;
    ctx.beginPath(); ctx.arc(sx0, sy0, r, 0, 7); ctx.stroke();
    if (r > 40) queueLabel(P.ENV, fmtDist(k * rs), sx0 + r * 0.7071 + 4, sy0 - r * 0.7071, C.ink2);
  }
  ctx.globalAlpha = 1;
  const dr = DETECT / cam.mpp;
  if (dr > 30 && dr < mx) {
    ctx.strokeStyle = C.me; ctx.globalAlpha = 0.35; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(sx0, sy0, dr, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    queueLabel(P.ENV, txt('map.detect'), sx0 - dr * 0.7071 - 4, sy0 - dr * 0.7071, C.me, 'right');
  }
  ctx.setLineDash([]);
}

function drawScaleBar(step) {
  const H = cam.h, sl = step / cam.mpp;
  ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.5; ctx.beginPath();
  ctx.moveTo(16, H - 20); ctx.lineTo(16 + sl, H - 20); ctx.moveTo(16, H - 25); ctx.lineTo(16, H - 15); ctx.moveTo(16 + sl, H - 25); ctx.lineTo(16 + sl, H - 15); ctx.stroke();
  ctx.font = '500 12px ' + FONT;
  queueLabel(P.ENV, fmtDist(step), 16 + sl + 8, H - 20, C.ink2);
  flushLabels(ctx);
}

function drawBodies() {
  const main = mainBody(view.pos)?.b;
  for (const b of S.bodies) {
    const bx = X(b.pos[0]), by = Y(b.pos[1]), br = b.r / cam.mpp;
    // поле тяжести: мягкое свечение до радиуса, где притяжение 0,1 g
    const rf = Math.sqrt(b.mu / (0.1 * G0)) / cam.mpp;
    if (rf > br * 1.1 && bx + rf > 0 && bx - rf < cam.w && by + rf > 0 && by - rf < cam.h) {
      const g = ctx.createRadialGradient(bx, by, br, bx, by, rf);
      g.addColorStop(0, rgba(C.field, 0.06)); g.addColorStop(1, rgba(C.field, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, rf, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = C.ink2; ctx.lineWidth = 1; ctx.setLineDash([1, 6]);
    GRAV_RINGS.forEach((gl, i) => {
      const rr = Math.sqrt(b.mu / (gl * G0)) / cam.mpp;
      if (rr <= br * 1.05) return;
      ctx.globalAlpha = 0.35 - 0.22 * i / (GRAV_RINGS.length - 1);
      ctx.beginPath(); ctx.arc(bx, by, rr, 0, 7); ctx.stroke();
      if (b === main && rr > 60) queueLabel(P.ENV, gl + ' g', bx + rr * 0.7071 + 4, by + rr * 0.7071, C.ink2);
    });
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    const m = br * 1.15;
    if (bx + m < 0 || bx - m > cam.w || by + m < 0 || by - m > cam.h) continue;
    drawBody(ctx, b, bx, by, br);
    queueLabel(P.ENV, b.name + ', ' + surfaceG(b).toFixed(1) + ' g', bx, by + Math.max(3, br) + 14, C.ink2, 'center');
  }
}

// следы кораблей: свои всегда, противник — пока контакт точный. Яркость гаснет от корабля к хвосту
function drawTrails() {
  const tr = S.tracks[view.id], seen = s => s.team === view.team || !!tr?.[s.id]?.exact;
  updateTrails(trails, S, seen);
  ctx.lineWidth = 1.5;
  for (const s of S.ships) {
    const segs = trailOf(trails, s.id);
    if (!segs.length) continue;
    const pts = [];
    segs.forEach((g, gi) => { for (const p of g) pts.push([X(p[0]), Y(p[1]), gi]); });
    // корабль виден — след тянется до него
    if (s.alive && seen(s)) pts.push([X(s.pos[0]), Y(s.pos[1]), segs.length - 1]);
    ctx.strokeStyle = s.team === view.team ? (s === myShip() ? C.me : C.ally) : C.foe;
    const n = pts.length;
    for (let i = 0; i < n - 1; i += 8) {
      ctx.globalAlpha = 0.5 * Math.min(1, (i + 8) / n);
      ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]);
      for (let j = i + 1; j <= Math.min(n - 1, i + 8); j++) {
        if (pts[j][2] !== pts[j - 1][2]) ctx.moveTo(pts[j][0], pts[j][1]); else ctx.lineTo(pts[j][0], pts[j][1]);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// полилиния по точкам мира pts[i0…i1]
function polyline(pts, i0, i1) {
  ctx.beginPath();
  for (let i = i0; i <= i1; i++) i > i0 ? ctx.lineTo(X(pts[i][0]), Y(pts[i][1])) : ctx.moveTo(X(pts[i][0]), Y(pts[i][1]));
  ctx.stroke();
}

// та же линия, но прозрачность плавно меняется от a0 к a1: дальние участки прогноза тише ближних.
// Смещение штриха переносится между кусками, чтобы пунктир не сбивался
function fadedLine(pts, i0, i1, a0, a1, chunk = 10) {
  let dash = 0;
  for (let i = i0; i < i1; i += chunk) {
    const j = Math.min(i1, i + chunk);
    ctx.globalAlpha = a0 + (a1 - a0) * (i - i0) / Math.max(1, i1 - i0);
    ctx.lineDashOffset = -dash; polyline(pts, i, j);
    for (let k = i + 1; k <= j; k++) dash += Math.hypot(X(pts[k][0]) - X(pts[k - 1][0]), Y(pts[k][1]) - Y(pts[k - 1][1]));
  }
  ctx.lineDashOffset = 0; ctx.globalAlpha = 1;
}

// точка на экране и вдали от уже подписанных
const onScreen = (x, y, m = 20) => x > m && x < cam.w - m && y > m && y < cam.h - m;
const farFrom = (x, y, list) => list.every(([a, b]) => Math.hypot(x - a, y - b) >= TICK_GAP);

// отметки времени на прогнозе: точки каждые 10 с гаснут с удалением, подписаны только 30, 60, 120 и 240 с,
// и только если подпись не налезает на корабль и соседнюю отметку
function timeTicks(pts, h, col, a0) {
  const tick = Math.round(10 / h), placed = [[X(pts[0][0]), Y(pts[0][1])]];
  ctx.fillStyle = col;
  for (let i = tick; i < pts.length; i += tick) {
    const t = Math.round(i * h), x = X(pts[i][0]), y = Y(pts[i][1]), lab = TICK_LABELS.includes(t);
    ctx.globalAlpha = a0 * (1 - 0.7 * i / pts.length);
    ctx.beginPath(); ctx.arc(x, y, lab ? 2.5 : 1.5, 0, 7); ctx.fill();
    if (lab && onScreen(x, y) && farFrom(x, y, placed)) { placed.push([x, y]); queueLabel(P.OWN, txt('map.sec', { t }), x + 6, y - 8, col); }
  }
  ctx.globalAlpha = 1;
}

// столкновение в конце прогноза: крест и время
function collisionMark(pts, hitT) {
  const e = pts[pts.length - 1], x = X(e[0]), y = Y(e[1]);
  ctx.strokeStyle = C.foe; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.stroke();
  queueLabel(P.THREAT, txt('map.collision', { s: hitT }), x + 10, y + 10, C.foe);
}

// самая низкая точка над поверхностью — по ней видно, как манёвр меняет орбиту
function lowPoint(pts, h, col = C.warn) {
  let lo = null;
  for (let i = 1; i < pts.length - 1; i++) {
    const mb = mainBody(pts[i]);
    if (mb && mb.alt < mb.b.r * 2 && (!lo || mb.alt < lo.alt)) lo = { alt: mb.alt, i };
  }
  if (!lo || lo.i <= 2 || lo.i >= pts.length - 2) return;
  const x = X(pts[lo.i][0]), y = Y(pts[lo.i][1]);
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.stroke();
  queueLabel(P.THREAT, txt('map.minAlt', { alt: lo.alt, s: lo.i * h }), x + 8, y + 10, col);
}

// прогноз курса: участок с тягой — сплошная яркая линия, полёт по инерции — пунктир, который гаснет вдали
function drawPrediction(me) {
  const { T, h } = PREDICT, pp = predictPath(me, T, h), pts = pp.pts;
  ctx.strokeStyle = C.me;
  if (pp.burnN > 0) { ctx.lineWidth = 2; ctx.globalAlpha = 0.95; polyline(pts, 0, pp.burnN); ctx.globalAlpha = 1; }
  ctx.lineWidth = 1.2; ctx.setLineDash([4, 5]);
  fadedLine(pts, pp.burnN, pts.length - 1, 0.7, 0.12);
  ctx.setLineDash([]);
  timeTicks(pts, h, C.me, 0.8);
  if (pp.hit) collisionMark(pts, pp.hitT);
  else lowPoint(pts, h);
}

// стрелка на конце траектории
function arrowHead(pts, col) {
  const n = pts.length - 1;
  if (n < 2) return;
  const x = X(pts[n][0]), y = Y(pts[n][1]), a = Math.atan2(y - Y(pts[n - 2][1]), x - X(pts[n - 2][0]));
  ctx.fillStyle = col; ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-6, 5); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill(); ctx.restore();
}

// подпись линии в точке на доле frac её длины, если точка на экране
function lineLabel(pts, frac, text, col, dy = -12) {
  const p = pts[Math.min(pts.length - 1, Math.max(0, Math.round((pts.length - 1) * frac)))], x = X(p[0]), y = Y(p[1]);
  if (onScreen(x, y, 40)) queueLabel(P.OWN, text, x + 8, y + dy, col);
}

// план манёвра на паузе: текущий курс — тихий пунктир, курс после манёвра — сплошная линия цвета плана,
// участок тяги — янтарный, на нём — расход и параметры. Прогноз считает plan.js; на карте только его итог
function drawPlan(f, me) {
  const cur = f.cur.pts, nx = f.next, pts = nx.pts, h = PLAN_STEP;
  ctx.strokeStyle = C.me; ctx.lineWidth = 1.2; ctx.setLineDash([4, 6]);
  fadedLine(cur, 0, cur.length - 1, 0.5, 0.1);
  ctx.setLineDash([]);
  lineLabel(cur, 0.3, txt('map.planCur'), C.ink2, 12);
  // направление тяги от корабля
  const sx = X(me.pos[0]), sy = Y(me.pos[1]);
  ctx.strokeStyle = C.warn; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(draft.ang) * 48, sy - Math.sin(draft.ang) * 48); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.strokeStyle = C.plan; ctx.lineWidth = 2;
  fadedLine(pts, Math.max(0, nx.burnTo), pts.length - 1, 1, 0.3);
  if (nx.burnFrom > 0) { ctx.strokeStyle = C.plan; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5; polyline(pts, 0, nx.burnFrom); ctx.globalAlpha = 1; }
  if (nx.burnFrom >= 0) {
    ctx.strokeStyle = C.warn; ctx.lineWidth = 3; polyline(pts, nx.burnFrom, nx.burnTo);
    const b = pts[nx.burnFrom], bx = X(b[0]), by = Y(b[1]);
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(bx, by, 4, 0, 7); ctx.stroke();
    queueLabel(P.THREAT, txt('map.planBurn', { dv: nx.dv, d: draft.dur, g: draft.g.toFixed(1) }), bx + 10, by - 14, C.warn);
  }
  if (!nx.hit) arrowHead(pts, C.plan);
  lineLabel(pts, 0.55, txt('map.planNew'), C.plan);
  timeTicks(pts, h, C.plan, 0.7);
  if (nx.hit) collisionMark(pts, nx.hitT);
  else lowPoint(pts, h);
  // ближайшее сближение с целью по её последнему треку
  if (nx.near && nx.near.t > 1) {
    const i = Math.min(pts.length - 1, Math.round(nx.near.t / h)), ox = X(pts[i][0]), oy = Y(pts[i][1]);
    const tx = X(nx.near.pos[0]), ty = Y(nx.near.pos[1]);
    ctx.strokeStyle = C.foe; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    diamond(tx, ty, 5, C.foe);
    if (onScreen(tx, ty, 30)) queueLabel(P.OWN, txt('map.near', { d: nx.near.d }), tx + 9, ty + 10, C.foe);
  }
}

// полый ромб: потерянный контакт, опасная торпеда, точка сближения
function diamond(x, y, r, col, w = 1.5) {
  ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke();
}

// сектор, в который уйдёт облако шариков при выстреле по курсору
function drawFlakCone() {
  const me = myShip();
  if (!run.started || S.over || !pointer.valid || !me.alive || me.flak <= 0 || (COARSE && !pointer.aim)) return;
  const cx = X(me.pos[0]), cy = Y(me.pos[1]);
  const w = screenToWorld(pointer.x, pointer.y), a = Math.atan2(w[1] - me.pos[1], w[0] - me.pos[0]), R = Math.min(30000 / cam.mpp, 5000);
  ctx.fillStyle = C.flak; ctx.strokeStyle = C.flak; ctx.lineWidth = 1;
  ctx.globalAlpha = 0.09; ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, -(a + me.spread), -(a - me.spread)); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
}

// шарики: штрих назад по скорости на 0,12 с, короткий — точка; свежий залп светится
function drawPellets() {
  ctx.fillStyle = C.flak; ctx.strokeStyle = C.flak; ctx.lineWidth = 1;
  const glow = glowSprite(C.flak, 8);
  for (const p of S.pellets) {
    const a = 0.8 * (1 - 0.7 * p.age / FLAK.life), x = X(p.pos[0]), y = Y(p.pos[1]);
    const bx = X(p.pos[0] - p.vel[0] * 0.12), by = Y(p.pos[1] - p.vel[1] * 0.12);
    ctx.globalAlpha = a;
    if (Math.hypot(x - bx, y - by) < 2) ctx.fillRect(x - 1, y - 1, 2, 2);
    else { ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(x, y); ctx.stroke(); }
    if (p.age < 2) drawGlow(ctx, glow, x, y, 4, 0.5 * (1 - p.age / 2));
  }
  ctx.globalAlpha = 1;
}

// торпеды: короткий гаснущий след, треугольник по скорости, у вражеской на подлёте — ромб и пульс угрозы
function drawTorps() {
  const rm = reducedMotion();
  for (const t of S.torps) {
    const col = sideCol(t.team), x = X(t.pos[0]), y = Y(t.pos[1]);
    const tail = t.trail.slice(-TORP_TRAIL), n = tail.length;
    ctx.strokeStyle = col; ctx.lineWidth = 1.2;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = tail[i], [bx, by] = i + 1 < n ? tail[i + 1] : t.pos;
      ctx.globalAlpha = 0.55 * (i + 1) / n;
      ctx.beginPath(); ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(bx), Y(by)); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const ang = Math.atan2(t.vel[1], t.vel[0]), ca = Math.cos(ang), sa = Math.sin(ang);
    const foe = t.team !== view.team, g = foe ? timeToImpact(t, view) : null, danger = foe && g && g < 30;
    if (danger) {
      diamond(x, y, 11, col);
      drawGlow(ctx, glowSprite(C.threat, 16), x, y, 14, rm ? 0.5 : 0.25 + 0.45 * pulse(0.8));
    }
    if (t.acc > 1) drawGlow(ctx, glowSprite(C.plume, 16), x - ca * 6, y + sa * 6, 8, 0.7);
    if (t.heat > 5) drawGlow(ctx, glowSprite(C.plume, 16), x, y, 7, Math.min(1, t.heat / 40) * 0.8);
    const k = TORP_PX / 10;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-ang); ctx.scale(k, k);
    ctx.fillStyle = t.heat > 5 ? C.plume : col; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, 3.5); ctx.lineTo(-4, -3.5); ctx.closePath(); ctx.fill();
    if (t.acc > 1) { ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-10, 0); ctx.stroke(); }
    ctx.restore();
    if (foe) {
      queueLabel(P.THREAT, txt('map.torp', { eta: g ? txt('map.sec', { t: Math.round(g) }) : '—', dv: t.fuel })
        + (t.heat > 5 ? txt('map.heat', { h: Math.min(99, Math.round(t.heat)) }) : ''), x + 13, y - 11, col);
    }
  }
}

// длина корабля на экране: силуэт не короче порога, крупнее — настоящий масштаб
const shipPx = s => iconLen(shipLength(s) / cam.mpp, s.team);

// факел на экране разгорается и гаснет за PLUME_EASE реальных секунд, а на паузе замирает.
// Это только картинка: зону поражения считает weapons.js по настоящей тяге
const plumeShown = new Map();
let plumeClock = { S: null, fx: 0 };
function easePlumes() {
  if (plumeClock.S !== S) { plumeShown.clear(); plumeClock = { S, fx: clock.fx }; }
  const dt = clock.fx - plumeClock.fx, k = 1 - Math.exp(-Math.max(0, dt) / PLUME_EASE);
  plumeClock.fx = clock.fx;
  for (const s of S.ships) {
    const want = s.alive ? s.accG : 0, was = plumeShown.get(s.id) ?? want;
    plumeShown.set(s.id, was + (want - was) * k);
  }
}

// факел двигателя в масштабе карты: тёплая полупрозрачная оболочка по конусу поражения и яркое узкое ядро у сопла.
// Длина и яркость — от тяги. При защите выхлопом свой корабль показывает пунктиром настоящую зону поражения
function drawPlume(s) {
  const lvl = plumeShown.get(s.id) ?? s.accG;
  if (!s.alive || lvl < 0.15) return;
  const L = PLUME.perG * lvl, cx0 = X(s.pos[0]), cy0 = Y(s.pos[1]), p = Math.min(1, lvl / SHIP.maxG);
  const ax = -Math.cos(s.heading), ay = -Math.sin(s.heading), noz = Math.max(23 / cam.mpp, shipPx(s) * 0.5);
  const x0 = cx0 + ax * noz, y0 = cy0 - ay * noz;
  const x1 = cx0 + ax * L / cam.mpp, y1 = cy0 - ay * L / cam.mpp;
  const hw = Math.max(1.5, (PLUME.base + L * Math.tan(PLUME.half)) / cam.mpp), nb = Math.max(1, Math.min(hw * 0.3, shipPx(s) * 0.1));
  const shimmer = reducedMotion() ? 1 : 0.94 + 0.06 * pulse(0.16);
  const cone = (xa, ya, xb, yb, wa, wb) => {
    ctx.beginPath(); ctx.moveTo(xa + ay * wa, ya + ax * wa); ctx.lineTo(xb + ay * wb, yb + ax * wb);
    ctx.lineTo(xb - ay * wb, yb - ax * wb); ctx.lineTo(xa - ay * wa, ya - ax * wa); ctx.closePath(); ctx.fill();
  };
  // оболочка; вблизи она гаснет на экранной длине, а дальше факел показывает только контур зоны поражения
  const Lpx = Math.hypot(x1 - x0, y1 - y0) || 1, ke = Math.min(1, Math.max(160, 14 * shipPx(s)) / Lpx);
  const env = ctx.createLinearGradient(x0, y0, x0 + (x1 - x0) * ke, y0 + (y1 - y0) * ke);
  env.addColorStop(0, rgba(C.plume, 0.3 + 0.3 * p)); env.addColorStop(0.35, rgba(C.plume, 0.16 + 0.1 * p)); env.addColorStop(1, rgba(C.plume, 0));
  ctx.fillStyle = env; ctx.globalAlpha = shimmer; cone(x0, y0, x1, y1, nb, hw);
  // ядро: светлее и короче, с наложением 'lighter'
  // ядро не длиннее шести корпусов: вблизи факел остаётся ярким только у сопла
  const kc = Math.min(0.45, 6 * shipPx(s) / Lpx);
  const xc = x0 + (x1 - x0) * kc, yc = y0 + (y1 - y0) * kc, core = ctx.createLinearGradient(x0, y0, xc, yc);
  core.addColorStop(0, rgba(C.white, 0.85 * (0.4 + 0.6 * p))); core.addColorStop(0.3, rgba(C.plume, 0.5)); core.addColorStop(1, rgba(C.plume, 0));
  const op = ctx.globalCompositeOperation; ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = core; cone(x0, y0, xc, yc, nb * 0.6, Math.max(0.8, Math.min(hw * 0.25, shipPx(s) * 0.2)));
  ctx.globalCompositeOperation = op; ctx.globalAlpha = 1;
  if (s === myShip() && s.aimAway && s.accG >= 0.5) plumeZone(s, cx0, cy0, ax, ay);
  drawGlow(ctx, glowSprite(C.plume, 32), x0, y0, Math.max(6, shipPx(s) * (0.2 + 0.3 * p)), (0.3 + 0.5 * p) * shimmer);
  drawGlow(ctx, glowSprite(C.white, 16), x0, y0, Math.max(2.5, shipPx(s) * 0.1), (0.3 + 0.4 * p) * shimmer);
}

// контур зоны поражения выхлопом — та же геометрия, что в plumeFactor (weapons.js), по настоящей тяге
function plumeZone(s, cx0, cy0, ax, ay) {
  const L = PLUME.perG * s.accG, x1 = cx0 + ax * L / cam.mpp, y1 = cy0 - ay * L / cam.mpp;
  const base = PLUME.base / cam.mpp, end = (PLUME.base + L * Math.tan(PLUME.half)) / cam.mpp;
  ctx.strokeStyle = rgba(C.warn, 0.75); ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(cx0 + ay * base, cy0 + ax * base);
  ctx.lineTo(x1 + ay * end, y1 + ax * end); ctx.lineTo(x1 - ay * end, y1 - ax * end);
  ctx.lineTo(cx0 - ay * base, cy0 - ax * base); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  // подпись у кромки зоны, не дальше 140 px от корабля, чтобы она была на экране
  const d = Math.min(L / cam.mpp / 2, 140), w = (PLUME.base + d * cam.mpp * Math.tan(PLUME.half)) / cam.mpp;
  if (L / cam.mpp > 60) queueLabel(P.THREAT, txt('map.plumeZone'), cx0 + ax * d + ay * w + 8, cy0 - ay * d + ax * w, C.warn);
}

// турели ПОО следят за ближайшей вражеской торпедой, а без неё — за целью корабля
function turretAim(s) {
  let best = null, bd = 30000;
  for (const t of S.torps) if (t.team !== s.team) { const d = dist(t.pos, s.pos); if (d < bd) { bd = d; best = t.pos; } }
  if (!best) {
    const e = S.ships[s.targetId], tr = e && S.tracks[s.id]?.[e.id];
    if (e && e.alive && tr && (s.team !== view.team || tr.exact)) best = s.team === view.team ? tr.pos : e.pos;
  }
  return best ? Math.atan2(best[1] - s.pos[1], best[0] - s.pos[0]) : s.heading;
}

// корабль: при работающем двигателе — пульсирующий ореол (такой корабль видит противник), на выбеге корпус приглушён.
// Мелко — силуэт, крупно — подробная модель; на пороге они плавно перетекают друг в друга
function drawShip(s, col) {
  const Lp = shipLength(s) / cam.mpp, len = iconLen(Lp, s.team), x = X(s.pos[0]), y = Y(s.pos[1]);
  const lit = s.accG > SIGNATURE_G, dim = lit ? 1 : 0.8;
  if (lit) drawGlow(ctx, glowSprite(col, 32), x, y, Math.max(14, len * 0.75), 0.15 + 0.2 * pulse(1.6));
  const k = modelMix(Lp, s.team);
  if (k > 0) drawShipModel(ctx, s, col, len, x, y, turretAim(s), dim * k);
  if (k < 1) drawShipIcon(ctx, s, col, len, x, y, dim * (1 - k));
}

// подпись у корабля или контакта, справа-снизу от силуэта
function label(text, col, x, y, off = 14) { queueLabel(P.OWN, text, x + off, y + off + 2, col); }

// Угловые скобки цели не закрывают силуэт и отличаются от кольца своего корабля.
function targetMark(x, y, r = 19) {
  ctx.strokeStyle = C.foe; ctx.lineWidth = 2; ctx.beginPath();
  const arm = Math.min(10, r * 0.45);
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
    ctx.moveTo(x + dx * (r - arm), y + dy * r);
    ctx.lineTo(x + dx * r, y + dy * r);
    ctx.lineTo(x + dx * r, y + dy * (r - arm));
  }
  ctx.stroke();
}

function drawShips() {
  const me = myShip(), tr = S.tracks[view.id], team = S.ships.length > 2;
  for (const s of S.ships) if (s.team === view.team || tr[s.id]?.exact) drawPlume(s);
  for (const s of S.ships) {
    if (!s.alive) continue;
    const x = X(s.pos[0]), y = Y(s.pos[1]), half = shipPx(s) / 2;
    if (s.team === view.team) {
      if (s === me) {
        ctx.strokeStyle = rgba(C.me, 0.65); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, Math.max(22, half + 9), 0, Math.PI * 2); ctx.stroke();
      }
      drawShip(s, s === me ? C.me : C.ally);
      if (s !== me) label(s.name + (s.ctrl === 'human' ? '' : txt('map.ai')), C.ally, x, y, Math.max(14, half));
      continue;
    }
    const t = tr[s.id], isTarget = me.alive && s.id === me.targetId;
    if (t.exact) {
      drawShip(s, C.foe);
      label((team ? s.name + ', ' : '') + txt('map.hull', { hp: Math.round(s.hp) }), C.foe, x, y, Math.max(14, half + 4));
      if (isTarget) targetMark(x, y, Math.max(17, half + 4));
      continue;
    }
    // контакт потерян: «дышащая» зона вероятности вокруг последней позиции, ведомой по баллистике
    const age = S.t - t.seenT, ur = Math.min(80000, 0.5 * 15 * age * age), tx = X(t.pos[0]), ty = Y(t.pos[1]);
    const R = Math.max(8, ur / cam.mpp), breath = reducedMotion() ? 1 : 1 + 0.15 * Math.sin(clock.real * 2 * Math.PI / 3);
    if (R > 10) {
      const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, R);
      g.addColorStop(0, rgba(C.foe, 0.18 * breath)); g.addColorStop(1, rgba(C.foe, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx, ty, R, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = C.foe; ctx.lineWidth = 1; ctx.globalAlpha = 0.35; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(tx, ty, R, 0, 7); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    diamond(tx, ty, 8, C.foe);
    label((team ? s.name + ': ' : '') + txt('map.lastPos', { ago: age }), C.foe, tx, ty - 2);
    if (isTarget) targetMark(tx, ty);
  }
}

// стрелка у края экрана на объект за его пределами
function edgeMarker(pos, col, text, big, pri = P.OWN) {
  const W = cam.w, H = cam.h, dx = X(pos[0]) - W / 2, dy = Y(pos[1]) - H / 2, m = 26;
  if (Math.abs(dx) < W / 2 - m && Math.abs(dy) < H / 2 - m) return;
  const k = Math.min((W / 2 - m) / (Math.abs(dx) || 1e-9), (H / 2 - m) / (Math.abs(dy) || 1e-9));
  const ex = W / 2 + dx * k, ey = H / 2 + dy * k, z = big ? 1.4 : 1;
  ctx.save(); ctx.translate(ex, ey); ctx.rotate(Math.atan2(dy, dx)); ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(9 * z, 0); ctx.lineTo(-5 * z, 6 * z); ctx.lineTo(-5 * z, -6 * z); ctx.closePath(); ctx.fill(); ctx.restore();
  queueLabel(pri, text, ex + (ex > W / 2 ? -14 : 14), ey + (ey > H / 2 ? -12 : 12), col, ex > W / 2 ? 'right' : 'left');
}

function drawEdgeMarkers() {
  const me = myShip(), tr = S.tracks[view.id];
  for (const b of S.bodies) {
    const bx = X(b.pos[0]), by = Y(b.pos[1]), br = b.r / cam.mpp;
    if (bx + br < 0 || bx - br > cam.w || by + br < 0 || by - br > cam.h) edgeMarker(b.pos, C.ink2, b.name + ', ' + fmtDist(Math.max(0, dist(view.pos, b.pos) - b.r)), false, P.ENV);
  }
  if (me.alive) edgeMarker(me.pos, C.me, txt('map.you'), true);
  for (const s of S.ships) {
    if (!s.alive || s === me) continue;
    if (s.team === view.team) { edgeMarker(s.pos, C.ally, s.name); continue; }
    const t = tr[s.id], p = t.exact ? s.pos : t.pos, isTarget = s.id === me.targetId;
    edgeMarker(p, C.foe, (isTarget ? txt('map.target') : s.name) + (t.exact ? ', ' : txt('map.stale') + ', ') + fmtDist(dist(view.pos, p)), isTarget);
  }
  for (const t of S.torps) {
    if (t.team !== view.team) { const g = timeToImpact(t, view); edgeMarker(t.pos, C.foe, txt('map.torpedo') + (g ? ', ' + txt('map.sec', { t: Math.round(g) }) : ''), false, P.THREAT); }
    else if (t.owner === me.id) edgeMarker(t.pos, C.me, txt('map.ownTorp'));
  }
}

function drawCaptions() {
  const W = cam.w, H = cam.h, me = view, e = S.ships[me.targetId], tr = e && S.tracks[me.id][e.id];
  if (!cam.follow) {
    ctx.textAlign = 'center'; ctx.fillStyle = C.warn; ctx.font = '500 13px ' + FONT;
    ctx.fillText(txt('map.freeCam'), W / 2, H - 68);
  }
  const sp = Math.hypot(me.vel[0], me.vel[1]) / 1000;
  ctx.textAlign = 'center'; ctx.fillStyle = C.ink; ctx.font = '600 24px ' + FONT;
  ctx.fillText(sp.toFixed(2) + ' ' + txt('u.kms'), W / 2, H - 40);
  if (e && e.alive && tr) {
    const rx = tr.pos[0] - me.pos[0], ry = tr.pos[1] - me.pos[1], rr = Math.hypot(rx, ry) || 1;
    const cl = -(rx * (tr.vel[0] - me.vel[0]) + ry * (tr.vel[1] - me.vel[1])) / rr / 1000;
    ctx.font = '500 13px ' + FONT; ctx.fillStyle = C.ink2;
    ctx.fillText(txt(cl >= 0 ? 'map.closing' : 'map.opening', { v: Math.abs(cl).toFixed(2) }), W / 2, H - 18);
  }
}
