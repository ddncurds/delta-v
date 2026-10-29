// Скалярная и векторная мелочь. Векторы — массивы [x, y]
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// наименьшее расстояние за шаг dt между точками с относительным положением (rx, ry) и скоростью (vx, vy)
export function closestDist(rx, ry, vx, vy, dt) {
  const v2 = vx * vx + vy * vy;
  const t = v2 > 1e-9 ? clamp(-(rx * vx + ry * vy) / v2, 0, dt) : 0;
  return Math.hypot(rx + vx * t, ry + vy * t);
}

// угол выстрела со скоростью sp из точки ps (скорость vs) по цели pt (скорость vt) с упреждением
export function solveIntercept(ps, vs, pt, vt, sp) {
  const rx = pt[0] - ps[0], ry = pt[1] - ps[1], wx = vt[0] - vs[0], wy = vt[1] - vs[1];
  const a = wx * wx + wy * wy - sp * sp, b = 2 * (rx * wx + ry * wy), c = rx * rx + ry * ry;
  let t = null;
  if (Math.abs(a) < 1e-6) { if (Math.abs(b) > 1e-9) t = -c / b; }
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const q = Math.sqrt(disc);
      const c1 = [(-b - q) / (2 * a), (-b + q) / (2 * a)].filter(x => x > 0);
      if (c1.length) t = Math.min(...c1);
    }
  }
  if (!t || t <= 0) return Math.atan2(ry, rx);
  return Math.atan2(ry + wy * t, rx + wx * t);
}
