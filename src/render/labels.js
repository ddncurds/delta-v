// Очередь подписей карты: собираются за кадр, рисуются в конце с тёмной подложкой
// и без наложения менее важных подписей на более важные (раскладка — label-layout.js)
import { C } from './theme.js';
import { labelRect, placeLabels } from './label-layout.js';

export const P = { BLOCK: -1, THREAT: 0, OWN: 1, ENV: 2 };
let queue = [];

export function queueLabel(priority, text, x, y, color, align = 'left') {
  queue.push({ p: priority, text: String(text), x, y, color, align });
}

// занять прямоугольник экрана: подписи карты на него не лягут
export function reserveRect(x0, y0, x1, y1) { queue.push({ p: P.BLOCK, text: '', rect: { x0, y0, x1, y1 } }); }

export function flushLabels(ctx) {
  const items = queue; queue = [];
  if (!items.length) return;
  ctx.textBaseline = 'middle';
  for (const it of items) if (it.p !== P.BLOCK) it.rect = labelRect(it.x, it.y, ctx.measureText(it.text).width, it.align);
  // сначала окружение, сверху — угрозы
  const shown = placeLabels(items).filter(it => it.p !== P.BLOCK).reverse();
  ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = C.paper;
  for (const it of shown) {
    ctx.textAlign = it.align;
    ctx.globalAlpha = 0.85; ctx.strokeText(it.text, it.x, it.y);
    ctx.globalAlpha = 1; ctx.fillStyle = it.color; ctx.fillText(it.text, it.x, it.y);
  }
}
