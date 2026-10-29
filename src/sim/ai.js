// ИИ противника в одиночной игре
import { D2R, FLAK } from '../config.js';
import { dist, solveIntercept } from '../lib/math.js';
import { S } from './state.js';
import { startBurn, doDodge, doPlume } from './ship.js';
import { fireFlak, launchTorp } from './weapons.js';
import { nearestThreat } from './sensors.js';
import { impactIn } from './predict.js';

export const newAi = () => ({ nextSalvo: 12 + Math.random() * 10, salvoLeft: 0, salvoAt: 0, nextNudge: 6, nextFlak: 0, nextGeo: 0, plumeTorp: null });

export function aiStep() {
  const f = S.foe, ai = f.ai, tr = S.tracks.foe;
  if (!f.alive || !S.me.alive) return;
  if (avoidBodies(f, ai)) return;
  const th = nearestThreat('foe');
  if (th) {
    const R = dist(th.t.pos, f.pos);
    if (th.ttg < 28 && th.ttg > 5 && R < 34000 && f.flak > 0 && f.flakCd <= 0 && S.t >= ai.nextFlak) {
      const ang = solveIntercept(f.pos, f.vel, th.t.pos, th.t.vel, FLAK.speed) + (Math.random() * 2 - 1) * 1.5 * D2R;
      fireFlak(f, 'foe', ang); ai.nextFlak = S.t + 3.5;
    }
    if (th.ttg < 17 && f.burnEnd < 0) doDodge(f, 'foe');
    else if (th.ttg < 8 && th.ttg > 2 && f.burnEnd < 0 && ai.plumeTorp !== th.t) {
      ai.plumeTorp = th.t;
      if (Math.random() < 0.6) doPlume(f, 'foe');
    }
  }
  if ((!th || th.ttg > 40) && tr.exact && f.flak >= 2 && f.flakCd <= 0 && S.t >= ai.nextFlak && dist(tr.pos, f.pos) < 30000) {
    const ang = solveIntercept(f.pos, f.vel, tr.pos, tr.vel, FLAK.speed) + (Math.random() * 2 - 1) * 2 * D2R;
    fireFlak(f, 'foe', ang); ai.nextFlak = S.t + 4;
  }
  if (ai.salvoLeft > 0 && S.t >= ai.salvoAt) {
    if (launchTorp(f, 'foe')) { ai.salvoLeft--; ai.salvoAt = S.t + 3.5; } else ai.salvoLeft = 0;
  } else if (ai.salvoLeft === 0 && S.t >= ai.nextSalvo && f.torps > 0 && dist(tr.pos, f.pos) < 180000) {
    ai.salvoLeft = Math.min(2, f.torps); ai.salvoAt = S.t; ai.nextSalvo = S.t + 40 + Math.random() * 25;
  }
  // держит дистанцию 70–130 км, в середине — смещается вбок
  if (f.burnEnd < 0 && S.t >= ai.nextNudge) {
    const d = dist(tr.pos, f.pos), base = Math.atan2(tr.pos[1] - f.pos[1], tr.pos[0] - f.pos[0]);
    if (d > 130000) startBurn(f, base, 2, 8);
    else if (d < 70000) startBurn(f, base + Math.PI, 2, 8);
    else startBurn(f, base + (Math.random() < .5 ? 1 : -1) * Math.PI / 2, 1.5, 5);
    ai.nextNudge = S.t + 30 + Math.random() * 20;
  }
}

// раз в секунду проверяем, не врежемся ли в тело; если да — отворачиваем вбок от скорости и вверх от поверхности
function avoidBodies(f, ai) {
  if (S.t < ai.nextGeo) return false;
  ai.nextGeo = S.t + 1;
  const imp = impactIn('foe', 90);
  if (!imp || (f.burnEnd >= 0 && imp.hitT >= 15)) return false;
  const b = imp.hit, rx = f.pos[0] - b.pos[0], ry = f.pos[1] - b.pos[1], rr = Math.hypot(rx, ry) || 1;
  let px = -f.vel[1], py = f.vel[0];
  if (px * rx + py * ry < 0) { px = -px; py = -py; }
  const pn = Math.hypot(px, py) || 1;
  startBurn(f, Math.atan2(py / pn + ry / rr * 0.6, px / pn + rx / rr * 0.6), imp.hitT < 30 ? 4 : 2, 6);
  return true;
}
