// Звёздный фон с параллаксом: три слоя смещаются с разной скоростью
import { hash3 } from '../lib/noise.js';
import { cam } from './camera.js';

// k: сдвиг звёзд в px на метр при полёте корабля; f: доля сдвига карты при перетаскивании (px на px)
const LAYERS = [{ k: 0.004, f: 0.05, n: 16, s: 1, a: 0.45 }, { k: 0.012, f: 0.12, n: 9, s: 1.4, a: 0.65 }, { k: 0.03, f: 0.22, n: 4, s: 2, a: 0.9 }];
const COLORS = ['#ffffff', '#cfe0ff', '#ffe6c2'];
const TILE = 400;
const off = LAYERS.map(() => [0, 0]);
let prev = null, prevFollow = true;

export function resetStars() { prev = null; }

// (vx, vy) — центр камеры в метрах
export function updateStars(vx, vy) {
  if (prev && prevFollow === cam.follow) {
    const dx = vx - prev[0], dy = vy - prev[1];
    LAYERS.forEach((L, i) => {
      const k = cam.follow ? L.k : L.f / cam.mpp;
      off[i][0] += dx * k; off[i][1] -= dy * k;
    });
  }
  prev = [vx, vy]; prevFollow = cam.follow;
}

export function drawStars(ctx, W, H) {
  LAYERS.forEach((L, li) => {
    const ox = off[li][0], oy = off[li][1];
    const i0 = Math.floor(ox / TILE), i1 = Math.floor((ox + W) / TILE), j0 = Math.floor(oy / TILE), j1 = Math.floor((oy + H) / TILE);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let n = 0; n < L.n; n++) {
      const x = i * TILE + hash3(i, j, n * 3 + li * 101) * TILE - ox;
      const y = j * TILE + hash3(i, j, n * 3 + 1 + li * 101) * TILE - oy;
      const b = hash3(i, j, n * 3 + 2 + li * 101);
      ctx.globalAlpha = L.a * (0.4 + 0.6 * b);
      ctx.fillStyle = COLORS[Math.floor(b * 7) % 3];
      const sz = L.s * (b > 0.9 ? 1.6 : 1);
      ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
    }
  });
  ctx.globalAlpha = 1;
}
