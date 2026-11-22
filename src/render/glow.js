// Свечение заранее нарисованными радиальными спрайтами: shadowBlur в кадре дорог,
// а спрайт с режимом 'lighter' стоит одного drawImage. Холсты создаются лениво при первом обращении
const cache = new Map();

// '#rrggbb' → 'rgba(r,g,b,a)'
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

function makeCanvas(size) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(size, size);
  if (globalThis.document?.createElement) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }
  return null;
}

// спрайт цвета color для радиуса около radiusPx: в центре непрозрачность 1, к краю спадает до 0
export function glowSprite(color, radiusPx = 32) {
  const r = Math.min(64, Math.max(8, 2 ** Math.ceil(Math.log2(Math.max(1, radiusPx)))));
  const key = color + ':' + r;
  if (cache.has(key)) return cache.get(key);
  const cv = makeCanvas(r * 2), g2 = cv?.getContext('2d');
  if (g2) {
    const g = g2.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, rgba(color, 1)); g.addColorStop(0.25, rgba(color, 0.55));
    g.addColorStop(0.6, rgba(color, 0.15)); g.addColorStop(1, rgba(color, 0));
    g2.fillStyle = g; g2.fillRect(0, 0, r * 2, r * 2);
  }
  cache.set(key, cv);
  return cv;
}

// спрайт с центром (x, y) и радиусом sizePx; режим наложения возвращается прежним
export function drawGlow(ctx, sprite, x, y, sizePx, alpha = 1) {
  if (!sprite || alpha <= 0.003 || sizePx <= 0.5) return;
  const op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(sprite, x - sizePx, y - sizePx, sizePx * 2, sizePx * 2);
  ctx.globalCompositeOperation = op; ctx.globalAlpha = ga;
}
