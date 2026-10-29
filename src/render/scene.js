// Кадр тактической карты: фон, тела, прогноз курса, оружие, корабли, эффекты и подписи
import { G0, FLAK, PLUME } from '../config.js';
import { dist } from '../lib/math.js';
import { fmtDist } from '../lib/format.js';
import { S, predictPath, mainBody, surfaceG, timeToImpact } from '../sim/index.js';
import { run } from '../run.js';
import { pointer, COARSE } from '../ui/pointer.js';
import { C, FONT } from './theme.js';
import { cam, camCenter, screenToWorld } from './camera.js';
import { updateStars, drawStars } from './stars.js';
import { drawBody } from './planets.js';
import { drawShipModel, shipLength } from './ship-models.js';

const GRAV_RINGS = [0.5, 0.2, 0.1, 0.05];   // линии равного притяжения, в g
const PREDICT = { T: 240, h: 0.5 };          // горизонт и шаг прогноза курса, с
const MODEL_MIN_PX = 22;                     // короче этого корабль рисуется значком

let ctx = null, vx = 0, vy = 0;
const X = x => (x - vx) / cam.mpp + cam.w / 2;
const Y = y => cam.h / 2 - (y - vy) / cam.mpp;

export function initScene(canvas) { ctx = canvas.getContext('2d'); }

export function draw() {
  ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, cam.w, cam.h);
  [vx, vy] = camCenter();
  updateStars(vx, vy);
  drawStars(ctx, cam.w, cam.h);
  ctx.font = '500 12px ' + FONT; ctx.textBaseline = 'middle';
  const gridStep = drawGrid();
  drawRangeRings();
  drawScaleBar(gridStep);
  drawBodies();
  if (S.me.alive) drawPrediction();
  drawFlakCone();
  drawPellets();
  drawTorps();
  drawShips();
  drawFx();
  drawEdgeMarkers();
  drawCaptions();
}

function niceStep(x) {
  const e = Math.pow(10, Math.floor(Math.log10(x))), m = x / e;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
}

function drawGrid() {
  const W = cam.w, H = cam.h, step = niceStep(cam.mpp * 110);
  ctx.lineWidth = 1; ctx.strokeStyle = C.grid; ctx.beginPath();
  const i0 = Math.floor((vx - W / 2 * cam.mpp) / step), i1 = Math.ceil((vx + W / 2 * cam.mpp) / step);
  for (let i = i0; i <= i1; i++) { const sx = Math.round(X(i * step)) + .5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
  const j0 = Math.floor((vy - H / 2 * cam.mpp) / step), j1 = Math.ceil((vy + H / 2 * cam.mpp) / step);
  for (let j = j0; j <= j1; j++) { const sy = Math.round(Y(j * step)) + .5; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
  ctx.stroke();
  return step;
}

// дальномерные круги вокруг своего корабля
function drawRangeRings() {
  const me = S.me, rs = niceStep(cam.mpp * 200), sx0 = X(me.pos[0]), sy0 = Y(me.pos[1]);
  const mx = Math.hypot(cam.w, cam.h) / 2 + Math.hypot(sx0 - cam.w / 2, sy0 - cam.h / 2);
  ctx.strokeStyle = C.line; ctx.setLineDash([2, 5]); ctx.fillStyle = C.ink2; ctx.textAlign = 'left';
  for (let k = 1; k * rs / cam.mpp < mx && k < 40; k++) {
    const r = k * rs / cam.mpp;
    ctx.beginPath(); ctx.arc(sx0, sy0, r, 0, 7); ctx.stroke();
    if (r > 40) ctx.fillText(fmtDist(k * rs), sx0 + r * 0.7071 + 4, sy0 - r * 0.7071);
  }
  ctx.setLineDash([]);
}

function drawScaleBar(step) {
  const H = cam.h, sl = step / cam.mpp;
  ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.5; ctx.beginPath();
  ctx.moveTo(16, H - 20); ctx.lineTo(16 + sl, H - 20); ctx.moveTo(16, H - 25); ctx.lineTo(16, H - 15); ctx.moveTo(16 + sl, H - 25); ctx.lineTo(16 + sl, H - 15); ctx.stroke();
  ctx.fillStyle = C.ink2; ctx.textAlign = 'left'; ctx.fillText(fmtDist(step), 16 + sl + 8, H - 20);
}

function drawBodies() {
  for (const b of S.bodies) {
    const bx = X(b.pos[0]), by = Y(b.pos[1]), br = b.r / cam.mpp;
    ctx.strokeStyle = C.ink2; ctx.fillStyle = C.ink2; ctx.lineWidth = 1; ctx.setLineDash([1, 6]); ctx.globalAlpha = 0.5;
    for (const gl of GRAV_RINGS) {
      const rr = Math.sqrt(b.mu / (gl * G0)) / cam.mpp;
      if (rr <= br * 1.05) continue;
      ctx.beginPath(); ctx.arc(bx, by, rr, 0, 7); ctx.stroke();
      if (rr > 40) { ctx.textAlign = 'left'; ctx.fillText(gl + ' g', bx + rr * 0.7071 + 4, by + rr * 0.7071); }
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    const m = br * 1.1;
    if (bx + m < 0 || bx - m > cam.w || by + m < 0 || by - m > cam.h) continue;
    drawBody(ctx, b, bx, by, br);
    ctx.fillStyle = C.ink2; ctx.textAlign = 'center';
    ctx.fillText(b.name + ', ' + surfaceG(b).toFixed(1) + ' g', bx, by + Math.max(3, br) + 14);
  }
}

// прогноз курса: с тягой — сплошная линия, дальше по инерции — пунктир с отметками каждые 10 с
function drawPrediction() {
  const { T, h } = PREDICT, pp = predictPath(S.me, T, h), P = pp.pts;
  const line = (i0, i1) => {
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) i > i0 ? ctx.lineTo(X(P[i][0]), Y(P[i][1])) : ctx.moveTo(X(P[i][0]), Y(P[i][1]));
    ctx.stroke();
  };
  ctx.strokeStyle = C.me; ctx.fillStyle = C.me;
  if (pp.burnN > 0) { ctx.lineWidth = 2; line(0, pp.burnN); }
  ctx.lineWidth = 1.2; ctx.globalAlpha = 0.55; ctx.setLineDash([4, 5]);
  line(pp.burnN, P.length - 1);
  ctx.setLineDash([]);
  const tick = Math.round(10 / h);
  for (let i = tick; i < P.length; i += tick) {
    const t = i * h, x = X(P[i][0]), y = Y(P[i][1]), lab = t === 30 || t % 60 === 0;
    ctx.beginPath(); ctx.arc(x, y, lab ? 2.5 : 1.5, 0, 7); ctx.fill();
    if (lab) { ctx.textAlign = 'left'; ctx.fillText(t + ' с', x + 6, y - 8); }
  }
  ctx.globalAlpha = 1;
  if (pp.hit) {
    const e = P[P.length - 1], x = X(e[0]), y = Y(e[1]);
    ctx.strokeStyle = C.foe; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.stroke();
    ctx.fillStyle = C.foe; ctx.textAlign = 'left'; ctx.fillText('столкновение через ' + Math.round(pp.hitT) + ' с', x + 10, y + 10);
    return;
  }
  // самая низкая точка над поверхностью — по ней видно, как манёвр меняет орбиту
  let lo = null;
  for (let i = 1; i < P.length - 1; i++) {
    const mb = mainBody(P[i]);
    if (mb && mb.alt < mb.b.r * 2 && (!lo || mb.alt < lo.alt)) lo = { alt: mb.alt, i };
  }
  if (lo && lo.i > 2 && lo.i < P.length - 2) {
    const x = X(P[lo.i][0]), y = Y(P[lo.i][1]);
    ctx.strokeStyle = C.warn; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.stroke();
    ctx.fillStyle = C.warn; ctx.textAlign = 'left'; ctx.fillText('мин. высота ' + fmtDist(lo.alt) + ', ' + Math.round(lo.i * h) + ' с', x + 8, y + 10);
  }
}

// сектор, в который уйдёт облако шариков при выстреле по курсору
function drawFlakCone() {
  const me = S.me;
  if (!run.started || S.over || !pointer.valid || !me.alive || me.flak <= 0 || (COARSE && !pointer.aim)) return;
  const cx = X(me.pos[0]), cy = Y(me.pos[1]);
  const w = screenToWorld(pointer.x, pointer.y), a = Math.atan2(w[1] - me.pos[1], w[0] - me.pos[0]), R = Math.min(30000 / cam.mpp, 5000);
  ctx.fillStyle = C.flak; ctx.strokeStyle = C.flak; ctx.lineWidth = 1;
  ctx.globalAlpha = 0.09; ctx.beginPath(); ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, -(a + me.spread), -(a - me.spread)); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
}

function drawPellets() {
  ctx.fillStyle = C.flak;
  for (const p of S.pellets) {
    ctx.globalAlpha = 1 - 0.7 * p.age / FLAK.life;
    ctx.fillRect(X(p.pos[0]) - 1, Y(p.pos[1]) - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawTorps() {
  for (const t of S.torps) {
    const col = t.owner === 'me' ? C.me : C.foe;
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = 0.35; ctx.beginPath();
    t.trail.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
    ctx.lineTo(X(t.pos[0]), Y(t.pos[1])); ctx.stroke(); ctx.globalAlpha = 1;
    const ang = Math.atan2(t.vel[1], t.vel[0]), ts = Math.max(1, 8 / cam.mpp / 10);
    ctx.save(); ctx.translate(X(t.pos[0]), Y(t.pos[1])); ctx.rotate(-ang); ctx.scale(ts, ts);
    ctx.fillStyle = t.heat > 5 ? C.plume : col; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, 3.5); ctx.lineTo(-4, -3.5); ctx.closePath(); ctx.fill();
    if (t.acc > 1) { ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-10, 0); ctx.stroke(); }
    ctx.restore();
    if (t.owner === 'foe') {
      const g = timeToImpact(t, S.me);
      ctx.fillStyle = col; ctx.textAlign = 'left';
      ctx.fillText((g ? Math.round(g) + ' с' : '—') + ', Δv ' + Math.round(t.fuel) + (t.heat > 5 ? ', нагрев ' + Math.min(99, Math.round(t.heat)) + '%' : ''), X(t.pos[0]) + 9, Y(t.pos[1]) - 9);
    }
  }
}

// факел двигателя в масштабе карты: зона, где выхлоп плавит торпеды и корпус
function drawPlume(s) {
  if (!s.alive || s.accG < 0.5) return;
  const L = PLUME.perG * s.accG, cx0 = X(s.pos[0]), cy0 = Y(s.pos[1]);
  const ax = -Math.cos(s.heading), ay = -Math.sin(s.heading);
  const x0 = cx0 + ax * 23 / cam.mpp, y0 = cy0 - ay * 23 / cam.mpp;
  const x1 = cx0 + ax * L / cam.mpp, y1 = cy0 - ay * L / cam.mpp;
  const hw = Math.max(1.5, (PLUME.base + (L - 23) * Math.tan(PLUME.half)) / cam.mpp);
  ctx.fillStyle = C.plume;
  for (const k of [1, 0.6, 0.3]) {
    ctx.globalAlpha = 0.2; ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + (x1 - x0) * k + ay * hw * k, y0 + (y1 - y0) * k + ax * hw * k);
    ctx.lineTo(x0 + (x1 - x0) * k - ay * hw * k, y0 + (y1 - y0) * k - ax * hw * k);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// турели ПОО следят за ближайшей вражеской торпедой, а без неё — за противником
function turretAim(s) {
  let best = null, bd = 30000;
  for (const t of S.torps) if (t.owner !== s.key) { const d = dist(t.pos, s.pos); if (d < bd) { bd = d; best = t.pos; } }
  if (!best) {
    const o = s.key === 'me' ? S.foe : S.me;
    if (o.alive && (s.key !== 'me' || S.tracks.me.exact)) best = o.pos;
  }
  return best ? Math.atan2(best[1] - s.pos[1], best[0] - s.pos[0]) : s.heading;
}

function drawShip(s, col) {
  const Lp = shipLength(s) / cam.mpp, x = X(s.pos[0]), y = Y(s.pos[1]);
  if (Lp >= MODEL_MIN_PX) { drawShipModel(ctx, s, col, Lp, x, y, turretAim(s)); return; }
  ctx.save(); ctx.translate(x, y); ctx.rotate(-s.heading);
  ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, 7); ctx.lineTo(-4, 0); ctx.lineTo(-8, -7); ctx.closePath();
  ctx.fillStyle = col; ctx.fill();
  if (s.accG > 0.05) { ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-10 - s.accG * 4, 0); ctx.stroke(); }
  ctx.restore();
}

function drawShips() {
  const me = S.me, foe = S.foe, tr = S.tracks.me;
  drawPlume(me); drawPlume(foe);
  if (me.alive) drawShip(me, C.me);
  if (!foe.alive) return;
  if (tr.exact) {
    drawShip(foe, C.foe);
    ctx.fillStyle = C.foe; ctx.textAlign = 'left';
    ctx.fillText('корпус ' + Math.round(foe.hp) + '%', X(foe.pos[0]) + 14, Y(foe.pos[1]) + 16);
    return;
  }
  // контакт потерян: последняя позиция, ведомая по баллистике, и круг неопределённости
  const age = S.t - tr.seenT, ur = Math.min(80000, 0.5 * 15 * age * age), tx = X(tr.pos[0]), ty = Y(tr.pos[1]);
  ctx.strokeStyle = C.foe; ctx.lineWidth = 1; ctx.globalAlpha = 0.5; ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.arc(tx, ty, Math.max(8, ur / cam.mpp), 0, 7); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(tx, ty - 8); ctx.lineTo(tx + 8, ty); ctx.lineTo(tx, ty + 8); ctx.lineTo(tx - 8, ty); ctx.closePath(); ctx.stroke();
  ctx.fillStyle = C.foe; ctx.textAlign = 'left';
  ctx.fillText('последняя позиция, ' + Math.round(age) + ' с назад', tx + 12, ty + 14);
}

function drawFx() {
  for (const f of S.fx) {
    const u = (S.t - f.t0) / f.dur; if (u < 0 || u > 1) continue;
    const col = f.kind === 'puff' ? C.flak : f.kind === 'fizz' ? C.ink2 : f.kind === 'melt' ? C.plume : (f.owner === 'me' ? C.me : C.foe);
    const fx0 = X(f.pos[0]), fy0 = Y(f.pos[1]), rr = Math.max(6, f.r * (0.2 + 0.8 * u) / cam.mpp);
    ctx.strokeStyle = col; ctx.globalAlpha = 1 - u; ctx.lineWidth = f.kind === 'boom' ? 3 : 1.5;
    ctx.beginPath(); ctx.arc(fx0, fy0, rr, 0, 7); ctx.stroke();
    if (f.kind === 'frag') {
      ctx.beginPath();
      for (let k = 0; k < 20; k++) { const a = k * Math.PI / 10; ctx.moveTo(fx0 + Math.cos(a) * rr * 0.55, fy0 + Math.sin(a) * rr * 0.55); ctx.lineTo(fx0 + Math.cos(a) * rr, fy0 + Math.sin(a) * rr); }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// стрелка у края экрана на объект за его пределами
function edgeMarker(pos, col, label, big) {
  const W = cam.w, H = cam.h, dx = X(pos[0]) - W / 2, dy = Y(pos[1]) - H / 2, m = 26;
  if (Math.abs(dx) < W / 2 - m && Math.abs(dy) < H / 2 - m) return;
  const k = Math.min((W / 2 - m) / (Math.abs(dx) || 1e-9), (H / 2 - m) / (Math.abs(dy) || 1e-9));
  const ex = W / 2 + dx * k, ey = H / 2 + dy * k, z = big ? 1.4 : 1;
  ctx.save(); ctx.translate(ex, ey); ctx.rotate(Math.atan2(dy, dx)); ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(9 * z, 0); ctx.lineTo(-5 * z, 6 * z); ctx.lineTo(-5 * z, -6 * z); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.fillStyle = col; ctx.textAlign = ex > W / 2 ? 'right' : 'left';
  ctx.fillText(label, ex + (ex > W / 2 ? -14 : 14), ey + (ey > H / 2 ? -12 : 12));
}

function drawEdgeMarkers() {
  const me = S.me, foe = S.foe, tr = S.tracks.me;
  for (const b of S.bodies) {
    const bx = X(b.pos[0]), by = Y(b.pos[1]), br = b.r / cam.mpp;
    if (bx + br < 0 || bx - br > cam.w || by + br < 0 || by - br > cam.h) edgeMarker(b.pos, C.ink2, b.name + ', ' + fmtDist(Math.max(0, dist(me.pos, b.pos) - b.r)));
  }
  if (me.alive) edgeMarker(me.pos, C.me, 'вы', true);
  if (foe.alive) {
    const fp = tr.exact ? foe.pos : tr.pos;
    edgeMarker(fp, C.foe, (tr.exact ? 'цель, ' : 'цель (устар.), ') + fmtDist(dist(me.pos, fp)), true);
  }
  for (const t of S.torps) {
    if (t.owner === 'foe') { const g = timeToImpact(t, me); edgeMarker(t.pos, C.foe, 'торпеда' + (g ? ', ' + Math.round(g) + ' с' : '')); }
    else edgeMarker(t.pos, C.me, 'своя торпеда');
  }
}

function drawCaptions() {
  const W = cam.w, H = cam.h, me = S.me, tr = S.tracks.me;
  if (!cam.follow) {
    ctx.textAlign = 'center'; ctx.fillStyle = C.warn; ctx.font = '500 13px ' + FONT;
    ctx.fillText('Камера свободна: нажмите ⌖ или C, чтобы вернуться к кораблю', W / 2, H - 68);
  }
  const sp = Math.hypot(me.vel[0], me.vel[1]) / 1000;
  ctx.textAlign = 'center'; ctx.fillStyle = C.ink; ctx.font = '600 24px ' + FONT;
  ctx.fillText(sp.toFixed(2) + ' км/с', W / 2, H - 40);
  if (S.foe.alive) {
    const rx = tr.pos[0] - me.pos[0], ry = tr.pos[1] - me.pos[1], rr = Math.hypot(rx, ry) || 1;
    const cl = -(rx * (tr.vel[0] - me.vel[0]) + ry * (tr.vel[1] - me.vel[1])) / rr / 1000;
    ctx.font = '500 13px ' + FONT; ctx.fillStyle = C.ink2;
    ctx.fillText((cl >= 0 ? 'сближение с целью ' : 'расхождение с целью ') + Math.abs(cl).toFixed(2) + ' км/с', W / 2, H - 18);
  }
}
