// Очередь подписей карты: собираются за кадр, рисуются в конце с тёмной подложкой
// и без наложения менее важных подписей на более важные (раскладка — label-layout.js)
import { C } from './theme.js';
import { labelRect, placeLabels } from './label-layout.js';

export const P = { THREAT: 0, OWN: 1, ENV: 2 };
let queue = [];

export function queueLabel(priority, text, x, y, color, align = 'left') {
  queue.push({ p: priority, text: String(text), x, y, color, align });
}

export function flushLabels(ctx) {
  const items = queue; queue = [];
  if (!items.length) return;
  ctx.textBaseline = 'middle';
  for (const it of items) it.rect = labelRect(it.x, it.y, ctx.measureText(it.text).width, it.align);
  // сначала окружение, сверху — угрозы
  const shown = placeLabels(items).reverse();
  ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = C.paper;
  for (const it of shown) {
    ctx.textAlign = it.align;
    ctx.globalAlpha = 0.85; ctx.strokeText(it.text, it.x, it.y);
    ctx.globalAlpha = 1; ctx.fillStyle = it.color; ctx.fillText(it.text, it.x, it.y);
  }
}
