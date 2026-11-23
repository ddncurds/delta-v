// Прогноз манёвра без изменения боя. Копия корабля проходит те же шаги, что и в world.step:
// приказы в очереди с задержкой экипажа, конец манёвра, поворот, тяга, топливо, притяжение и усталость.
// Противник в прогнозе летит по инерции, по последнему известному треку
import { DT, PLAN } from '../config.js';
import { S } from './state.js';
import { fly, bodyHit, mainBody } from './bodies.js';
import { reactionDelay, endBurnIfDue, propel, strain } from './ship.js';
import { targetTrack } from './sensors.js';

export const PLAN_STEP = 0.5;                  // шаг точек траектории, с
const KEEP = Math.round(PLAN_STEP / DT);

// приказы, которые прогноз исполняет; остальные зависят от противника, их прогноз пропускает и считает
function applyPlanned(c, o, now) {
  switch (o.type) {
    case 'heading': c.cmdHeading = o.val; break;
    case 'throttle': c.cmdThrottle = o.val; c.burnEnd = -1; break;
    case 'burn': c.cmdHeading = o.val[0]; c.cmdThrottle = o.val[1]; c.burnEnd = now + o.val[2]; break;
    default: c.skipped++;
  }
}

// траектория корабля s на T секунд вперёд, если сейчас отдать приказ burn = [курс, тяга в g, длительность в с];
// burn = null — текущий курс без новых приказов. S не меняется.
// Возвращает точки через PLAN_STEP, отрезок с тягой (burnFrom…burnTo), столкновение, минимальную высоту,
// расход Δv, пиковую усталость экипажа и ближайшее сближение с треком цели
export function planBurn(s, burn, T = PLAN.T) {
  const delay = reactionDelay(s);
  const c = { pos: [...s.pos], vel: [...s.vel], heading: s.heading, cmdHeading: s.cmdHeading, cmdThrottle: s.cmdThrottle,
    burnEnd: s.burnEnd, fuel: s.fuel, stress: s.stress, crew: s.crew, accG: 0, aimAway: false, issuedThrottle: 0, skipped: 0 };
  const queue = s.orders.map(o => ({ ...o }));
  if (burn) queue.push({ at: S.t + delay, type: 'burn', val: burn });
  const tr = targetTrack(s), tg = tr && { pos: [...tr.pos], vel: [...tr.vel] };
  const out = { pts: [[c.pos[0], c.pos[1]]], burnFrom: -1, burnTo: -1, hit: null, hitT: 0, minAlt: null, near: null,
    delay, fuel0: s.fuel, peak: s.stress, aimAway: s.aimAway };
  let t = S.t, lit = false;
  for (let k = 1, n = Math.round(T / DT); k <= n; k++) {
    t += DT;
    while (queue.length && queue[0].at <= t) applyPlanned(c, queue.shift(), t);
    endBurnIfDue(c, t);
    propel(c, DT);
    strain(c, DT);
    out.peak = Math.max(out.peak, c.stress);
    lit ||= c.accG > 0;
    if (tg) {
      fly(tg.pos, tg.vel, 0, 0, DT);
      const d = Math.hypot(tg.pos[0] - c.pos[0], tg.pos[1] - c.pos[1]);
      if (!out.near || d < out.near.d) out.near = { d, t: t - S.t, pos: [tg.pos[0], tg.pos[1]] };
    }
    const b = bodyHit(c.pos[0], c.pos[1]);
    if (b || k % KEEP === 0) {
      out.pts.push([c.pos[0], c.pos[1]]);
      const i = out.pts.length - 1;
      if (lit) { if (out.burnFrom < 0) out.burnFrom = i - 1; out.burnTo = i; lit = false; }
      const mb = mainBody(c.pos);
      if (mb && (!out.minAlt || mb.alt < out.minAlt.alt)) out.minAlt = { alt: Math.max(0, mb.alt), i, t: t - S.t, body: mb.b };
    }
    if (b) { out.hit = b; out.hitT = t - S.t; break; }
  }
  return Object.assign(out, { fuel: c.fuel, dv: out.fuel0 - c.fuel, stress: c.stress, skipped: c.skipped,
    crewLost: c.crew && out.peak >= 100 });
}
