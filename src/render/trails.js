// Следы кораблей: точка раз в игровую секунду, не больше MAX точек на корабль.
// Хранятся в рендере, а не в S; разрыв (потеря контакта) начинает новый сегмент
export const TRAIL_MAX = 120;

export const newTrails = () => ({ S: null, t: -Infinity, ships: new Map() });

// state — мир (S); visible(s) — виден ли корабль точно; вызывается каждый кадр
export function updateTrails(tr, state, visible) {
  if (tr.S !== state || state.t < tr.t) { tr.ships.clear(); tr.S = state; }
  tr.t = state.t;
  const sec = Math.floor(state.t);
  for (const s of state.ships) {
    let e = tr.ships.get(s.id);
    if (!e) tr.ships.set(s.id, e = { segs: [], sec: -1, broken: true });
    if (!s.alive || !visible(s)) { e.broken = true; continue; }
    if (sec <= e.sec) continue;
    e.sec = sec;
    if (e.broken || !e.segs.length) { e.segs.push([]); e.broken = false; }
    e.segs[e.segs.length - 1].push([s.pos[0], s.pos[1]]);
    trim(e);
  }
}

function trim(e) {
  let n = e.segs.reduce((a, g) => a + g.length, 0);
  while (n > TRAIL_MAX) {
    const g = e.segs[0];
    g.shift(); n--;
    if (!g.length) e.segs.shift();
  }
}

export const trailOf = (tr, id) => tr.ships.get(id)?.segs || [];
