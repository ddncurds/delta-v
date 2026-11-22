// Раскладка подписей без холста: прямоугольник подписи, пересечение и отбор по приоритету.
// Приоритет: 0 — угрозы, 1 — свои объекты и цель, 2 — окружение
export const LABEL_H = 14;

// прямоугольник подписи шириной w с якорем (x, y), выравнивание по горизонтали align, по вертикали — середина
export function labelRect(x, y, w, align = 'left', h = LABEL_H) {
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  return { x0, y0: y - h / 2, x1: x0 + w, y1: y + h / 2 };
}

export const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// items: [{ p, rect, ... }] в порядке поступления. Возвращает принятые подписи: подпись пропускается,
// если её прямоугольник пересекает уже принятую подпись более высокого приоритета (меньшего p)
export function placeLabels(items) {
  const order = items.map((it, i) => [it, i]).sort((a, b) => a[0].p - b[0].p || a[1] - b[1]).map(a => a[0]);
  const out = [];
  for (const it of order) {
    if (out.some(o => o.p < it.p && overlap(o.rect, it.rect))) continue;
    out.push(it);
  }
  return out;
}
