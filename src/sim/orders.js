// Приказы экипажу. Они исполняются не сразу: задержка растёт с усталостью от перегрузок
import { FLAK } from '../config.js';
import { solveIntercept } from '../lib/math.js';
import { S, sayTo, shipOf } from './state.js';
import { reactionDelay, doDodge, doPlume } from './ship.js';
import { fireFlak, launchTorp, autoAim } from './weapons.js';
import { targetTrack } from './sensors.js';

export const ORDER_TYPES = ['heading', 'throttle', 'dodge', 'flak', 'flakAuto', 'flakShip', 'plume', 'torp', 'target'];
// приказы с числовым параметром
export const ORDER_VAL = ['heading', 'throttle', 'flak', 'target'];

// выбор цели — работа штурмана, а не манёвр: исполняется сразу
export function issue(id, type, val) {
  const m = shipOf(id);
  if (type === 'target') { setTarget(m, val); return; }
  if (type === 'throttle') m.issuedThrottle = val;
  if (type === 'heading') m.issuedHeading = val;
  m.orders.push({ at: S.t + reactionDelay(m), type, val });
}

// цель — только живой корабль другой команды
export function setTarget(s, id) {
  const e = S.ships[id];
  if (!Number.isInteger(id) || !e || !e.alive || e.team === s.team) return false;
  s.targetId = id;
  return true;
}

// исполнить приказы, срок которых подошёл
export function applyDueOrders(s) {
  while (s.orders.length && s.orders[0].at <= S.t) applyOrder(s, s.orders.shift());
}

function applyOrder(s, o) {
  switch (o.type) {
    case 'heading': s.cmdHeading = o.val; s.aimAway = false; break;
    case 'throttle': s.cmdThrottle = o.val; s.burnEnd = -1; s.aimAway = false; break;
    case 'dodge': doDodge(s); break;
    case 'flak': fireFlak(s, o.val); break;
    case 'flakAuto': {
      const a = autoAim(s);
      if (a === null) sayTo(s.id, 'Нет торпед для упреждения');
      else fireFlak(s, a);
      break;
    }
    case 'plume': doPlume(s); break;
    case 'flakShip': {
      const tr = targetTrack(s);
      if (!tr) sayTo(s.id, 'Нет цели');
      else fireFlak(s, solveIntercept(s.pos, s.vel, tr.pos, tr.vel, FLAK.speed));
      break;
    }
    case 'torp': launchTorp(s); break;
  }
}
