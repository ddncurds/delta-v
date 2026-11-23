// Раскладка подписей без холста: прямоугольник подписи, пересечение и отбор по приоритету.
// Приоритет: 0 — угрозы, 1 — свои объекты и цель, 2 — окружение
export const LABEL_H = 14;

// прямоугольник подписи шириной w с якорем (x, y), выравнивание по горизонтали align, по вертикали — середина
export function labelRect(x, y, w, align = 'left', h = LABEL_H) {
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  return { x0, y0: y - h / 2, x1: x0 + w, y1: y + h / 2 };
}

export const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

const NUDGE = [1, -1, 2, -2, 3, -3];          // сдвиги важной подписи, в высотах строки

const shifted = (r, dy) => ({ x0: r.x0, y0: r.y0 + dy, x1: r.x1, y1: r.y1 + dy });

// items: [{ p, rect, y, ... }] в порядке поступления. Возвращает принятые подписи.
// p = −1 — занятое место без текста (крупные подписи внизу карты): на него не ложится ничто.
// Угрозы (0) и свои объекты с целью (1) не накрывают друг друга: подпись сдвигается вверх или вниз на свободную строку.
// Угроза видна всегда; своя подпись пропускается, если места рядом нет и мешает угроза;
// подпись окружения (2) пропускается, если пересекает любую более важную
export function placeLabels(items) {
  const order = items.map((it, i) => [it, i]).sort((a, b) => a[0].p - b[0].p || a[1] - b[1]).map(a => a[0]);
  const out = [];
  for (const it of order) {
    if (it.p < 0) { out.push(it); continue; }
    if (it.p <= 1) {
      const busy = r => out.some(o => o.p <= it.p && overlap(o.rect, r));
      if (busy(it.rect)) {
        const k = NUDGE.find(n => !busy(shifted(it.rect, n * LABEL_H)));
        if (k !== undefined) { const dy = k * LABEL_H; it.rect = shifted(it.rect, dy); if (it.y !== undefined) it.y += dy; }
        else if (it.p > 0) continue;
      }
      out.push(it);
      continue;
    }
    if (out.some(o => o.p < it.p && overlap(o.rect, it.rect))) continue;
    out.push(it);
  }
  return out;
}
