// Приказы экипажу. Они исполняются не сразу: задержка растёт с усталостью от перегрузок
import { FLAK, SHIP, BURN } from '../config.js';
import { clamp, solveIntercept } from '../lib/math.js';
import { S, sayTo, shipOf } from './state.js';
import { reactionDelay, doDodge, doPlume, startBurn } from './ship.js';
import { fireFlak, launchTorp, autoAim } from './weapons.js';
import { targetTrack } from './sensors.js';

export const ORDER_TYPES = ['heading', 'throttle', 'dodge', 'flak', 'flakAuto', 'flakShip', 'plume', 'torp', 'target', 'burn'];
// приказы с числовым параметром
export const ORDER_VAL = ['heading', 'throttle', 'flak', 'target'];

// параметр приказа из сети или интерфейса: проверенный и ограниченный; null — приказ негоден.
// У приказа без параметра параметр — 0
// burn — манёвр по плану: [курс, тяга в g, длительность в с]
export function orderVal(type, val) {
  if (!ORDER_TYPES.includes(type)) return null;
  if (type === 'burn') {
    if (!Array.isArray(val) || val.length !== 3 || !val.every(Number.isFinite)) return null;
    return [val[0], clamp(val[1], 0, SHIP.maxG), clamp(val[2], BURN.minDur, BURN.maxDur)];
  }
  if (!ORDER_VAL.includes(type)) return 0;
  if (!Number.isFinite(val)) return null;
  return type === 'throttle' ? clamp(val, 0, SHIP.maxG) : val;
}

// выбор цели — работа штурмана, а не манёвр: исполняется сразу
export function issue(id, type, val) {
  const m = shipOf(id);
  if (type === 'target') { setTarget(m, val); return; }
  if (type === 'throttle') m.issuedThrottle = val;
  if (type === 'heading') m.issuedHeading = val;
  if (type === 'burn') { m.issuedHeading = val[0]; m.issuedThrottle = val[1]; }
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
      if (a === null) sayTo(s.id, 'msg.noLead');
      else fireFlak(s, a);
      break;
    }
    case 'plume': doPlume(s); break;
    case 'burn': startBurn(s, o.val[0], o.val[1], o.val[2]); s.aimAway = false; break;
    case 'flakShip': {
      const tr = targetTrack(s);
      if (!tr) sayTo(s.id, 'msg.noTarget');
      else fireFlak(s, solveIntercept(s.pos, s.vel, tr.pos, tr.vel, FLAK.speed));
      break;
    }
    case 'torp': launchTorp(s); break;
  }
}
