// Черновик манёвра на паузе: направление, тяга, длительность и два прогноза — текущий курс и курс после манёвра.
// Без DOM: черновик читают карта (render/scene.js) и карточка планировщика (ui/planner.js). Бой черновик не меняет
import { PLAN } from './config.js';
import { S, myShip, planBurn, mainBody, targetTrack } from './sim/index.js';

// open — карточка открыта; since — когда открыта (мс, performance.now), ang — курс в радианах (как heading), g — тяга, dur — секунды
export const draft = { open: false, since: 0, ang: 0, g: 2, dur: 10 };
let cache = { key: '', cur: null, next: null };

// курс на старте планирования: по скорости, а если корабль стоит — по носу
export function openDraft(now = 0) {
  const me = myShip(), v = me.vel;
  Object.assign(draft, { open: true, since: now, ang: Math.hypot(v[0], v[1]) > 1 ? Math.atan2(v[1], v[0]) : me.heading });
  cache.key = '';
}

export function closeDraft() { draft.open = false; cache = { key: '', cur: null, next: null }; }

// готовые направления: по скорости, против, влево и вправо от неё, от главного тела, на цель; null — направление не определено
export function presetAngle(kind) {
  const me = myShip(), v = me.vel, va = Math.atan2(v[1], v[0]), moving = Math.hypot(v[0], v[1]) > 1;
  switch (kind) {
    case 'pro': return moving ? va : null;
    case 'retro': return moving ? va + Math.PI : null;
    case 'left': return moving ? va + Math.PI / 2 : null;
    case 'right': return moving ? va - Math.PI / 2 : null;
    case 'out': { const mb = mainBody(me.pos); return mb ? Math.atan2(me.pos[1] - mb.b.pos[1], me.pos[0] - mb.b.pos[0]) : null; }
    case 'target': { const tr = targetTrack(me); return tr ? Math.atan2(tr.pos[1] - me.pos[1], tr.pos[0] - me.pos[0]) : null; }
  }
  return null;
}

// приказ burn по черновику
export const draftBurn = () => [draft.ang, draft.g, draft.dur];

// прогнозы для открытого черновика; пересчёт — только когда меняется черновик или состояние корабля
export function draftForecast() {
  if (!draft.open) return null;
  const me = myShip();
  const key = [S.t, draft.ang, draft.g, draft.dur, me.pos[0], me.pos[1], me.orders?.length, me.stress, S.bodies.length].join('|');
  if (cache.key !== key || cache.S !== S) {
    cache = { key, S, cur: planBurn(me, null, PLAN.T), next: planBurn(me, draftBurn(), PLAN.T) };
  }
  return cache;
}
