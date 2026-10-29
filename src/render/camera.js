// Камера карты: масштаб (метров на пиксель), слежение за кораблём или свободный центр
import { clamp } from '../lib/math.js';
import { S } from '../sim/index.js';

// w, h — размер холста в CSS-пикселях; mppT — целевой масштаб, к которому плавно тянется mpp
export const cam = { w: 300, h: 300, dpr: 1, mpp: 450, mppT: 450, prevMpp: 450, follow: true, c: [0, 0] };

const MPP_MIN = 0.2, MPP_MAX = 3000;

export const camCenter = () => cam.follow ? S.me.pos : cam.c;

export function screenToWorld(x, y) {
  const c = camCenter();
  return [c[0] + (x - cam.w / 2) * cam.mpp, c[1] - (y - cam.h / 2) * cam.mpp];
}

export function resizeCamera(w, h, dpr) { cam.w = w; cam.h = h; cam.dpr = dpr; }

// стартовый масштаб: на узком экране отдаляемся, чтобы оба корабля помещались
export function fitInitialZoom() { cam.mpp = cam.mppT = cam.prevMpp = Math.round(450 * Math.max(1, 820 / cam.w)); }

export const zoomBy = f => { cam.mppT = clamp(cam.mppT * f, MPP_MIN, MPP_MAX); };
export const zoomTo = m => { cam.mppT = cam.mpp = clamp(m, MPP_MIN, MPP_MAX); };

// плавное приближение к целевому масштабу в логарифмической шкале
export function easeZoom(dtReal) {
  cam.mpp = Math.exp(Math.log(cam.mpp) + (Math.log(cam.mppT) - Math.log(cam.mpp)) * Math.min(1, dtReal * 10));
}

export function recenter() { cam.follow = true; }

export function toggleShipView() {
  cam.follow = true;
  if (cam.mppT > 2) { cam.prevMpp = cam.mppT; cam.mppT = 0.5; } else cam.mppT = cam.prevMpp > 2 ? cam.prevMpp : 450;
}

// перетаскивание карты: камера отцепляется от корабля и сдвигается на (dx, dy) экранных пикселей
export function panBy(dx, dy) {
  if (cam.follow) { cam.c = [S.me.pos[0], S.me.pos[1]]; cam.follow = false; }
  cam.c[0] -= dx * cam.mpp; cam.c[1] += dy * cam.mpp;
}
