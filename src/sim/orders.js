// Приказы экипажу. Они исполняются не сразу: задержка растёт с усталостью от перегрузок
import { FLAK } from '../config.js';
import { solveIntercept } from '../lib/math.js';
import { S, sayTo, shipOf } from './state.js';
import { reactionDelay, doDodge, doPlume } from './ship.js';
import { fireFlak, launchTorp, autoAim } from './weapons.js';

export const ORDER_TYPES = ['heading', 'throttle', 'dodge', 'flak', 'flakAuto', 'flakShip', 'plume', 'torp'];
// приказы с числовым параметром
export const ORDER_VAL = ['heading', 'throttle', 'flak'];

export function issue(key, type, val) {
  const m = shipOf(key);
  if (type === 'throttle') m.issuedThrottle = val;
  if (type === 'heading') m.issuedHeading = val;
  m.orders.push({ at: S.t + reactionDelay(m), type, val });
}

// исполнить приказы, срок которых подошёл
export function applyDueOrders(key) {
  const s = shipOf(key);
  while (s.orders.length && s.orders[0].at <= S.t) applyOrder(s, key, s.orders.shift());
}

function applyOrder(s, key, o) {
  switch (o.type) {
    case 'heading': s.cmdHeading = o.val; s.aimAway = false; break;
    case 'throttle': s.cmdThrottle = o.val; s.burnEnd = -1; s.aimAway = false; break;
    case 'dodge': doDodge(s, key); break;
    case 'flak': fireFlak(s, key, o.val); break;
    case 'flakAuto': {
      const a = autoAim(key);
      if (a === null) sayTo(key, 'Нет торпед для упреждения');
      else fireFlak(s, key, a);
      break;
    }
    case 'plume': doPlume(s, key); break;
    case 'flakShip': {
      const tr = S.tracks[key];
      fireFlak(s, key, solveIntercept(s.pos, s.vel, tr.pos, tr.vel, FLAK.speed));
      break;
    }
    case 'torp': launchTorp(s, key); break;
  }
}
