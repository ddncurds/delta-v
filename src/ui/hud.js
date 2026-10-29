// Приборы: боковая панель на компьютере и плашки поверх карты на телефоне
import { G0, SHIP, FLAK, D2R } from '../config.js';
import { clamp, dist } from '../lib/math.js';
import { fmtDist, fmtClock } from '../lib/format.js';
import { S, reactionDelay, nearestThreat, gravAt, mainBody, impactIn } from '../sim/index.js';
import { run } from '../run.js';
import { cam } from '../render/camera.js';
import { net, pauseLabel } from '../net/multiplayer.js';
import { $, el } from './dom.js';
import { say } from './toast.js';

// пока игрок тянет ползунок тяги, не перезаписываем его значением с корабля
const dragging = { thr: false, thr2: false };
let impactWarned = false;

const setBar = (id, frac, cls) => {
  const b = el[id];
  b.firstElementChild.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
  b.className = 'bar' + (cls ? ' ' + cls : '');
};
const hpCls = hp => hp <= 30 ? 'bad' : hp <= 60 ? 'warn' : '';
const gCls = g => g >= 5 ? 'bad' : g >= 3 ? 'warn' : '';
const crewCls = st => st >= 70 ? 'bad' : st >= 40 ? 'warn' : '';

export function initHud() {
  el.thr.addEventListener('pointerdown', () => { dragging.thr = true; });
  el.thr2.addEventListener('pointerdown', () => { dragging.thr2 = true; });
  const up = () => { dragging.thr = dragging.thr2 = false; };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

export function updateHud() {
  const me = S.me, tr = S.tracks.me, foe = S.foe, st = me.stress;
  const gv = gravAt(me.pos[0], me.pos[1]), gg = Math.hypot(gv[0], gv[1]) / G0, mb = mainBody(me.pos);

  el.vHp.textContent = Math.round(me.hp) + '%'; setBar('bHp', me.hp / 100, hpCls(me.hp));
  el.vG.textContent = me.accG.toFixed(1) + ' g'; setBar('bG', me.accG / SHIP.maxG, gCls(me.accG));
  el.vCrew.textContent = st < 20 ? 'в норме' : st < 40 ? 'устают' : st < 70 ? 'приказы с задержкой' : 'на пределе';
  setBar('bCrew', st / 100, crewCls(st));
  el.vDelay.textContent = reactionDelay(me).toFixed(1) + ' с';
  el.vSpeed.textContent = (Math.hypot(me.vel[0], me.vel[1]) / 1000).toFixed(2) + ' км/с';
  el.vGrav.textContent = gg.toFixed(2) + ' g';
  el.vBody.textContent = mb ? mb.b.name + ', ' + fmtDist(Math.max(0, mb.alt)) : '—';
  if (!dragging.thr) el.thr.value = me.issuedThrottle;
  el.vThr.textContent = me.issuedThrottle.toFixed(1) + ' g';
  el.vTorp.textContent = me.torps;
  el.vFlak.textContent = '●'.repeat(me.flak) + '○'.repeat(FLAK.charges - me.flak);
  el.vFlak.title = me.flakTimer > 0 ? 'следующий заряд через ' + Math.ceil(me.flakTimer) + ' с' : '';
  el.vSpread.textContent = (me.spread / D2R).toFixed(1).replace('.0', '') + '°';

  const d = dist(me.pos, tr.pos);
  el.vContact.textContent = foe.alive
    ? (tr.exact ? 'Контакт точный, ' + (d / 1000).toFixed(0) + ' км, корпус противника ' + Math.round(foe.hp) + '%'
                : 'Контакт потерян ' + Math.round(S.t - tr.seenT) + ' с назад, примерно ' + (d / 1000).toFixed(0) + ' км')
    : 'Противник уничтожен';
  el.vThreat.textContent = threatText();
  $('zhome').classList.toggle('on', !cam.follow);

  el.mGrav.textContent = gg.toFixed(2); setBar('mbGrav', gg / 1.5, gg >= 1 ? 'warn' : '');
  el.mHp.textContent = Math.round(me.hp) + '%'; setBar('mbHp', me.hp / 100, hpCls(me.hp));
  el.mG.textContent = me.accG.toFixed(1); setBar('mbG', me.accG / SHIP.maxG, gCls(me.accG));
  el.mCrew.textContent = Math.round(st) + '%'; setBar('mbCrew', st / 100, crewCls(st));
  el.mContact.textContent = el.vContact.textContent;
  el.mThreat.textContent = el.vThreat.textContent;
  if (!dragging.thr2) el.thr2.value = me.issuedThrottle;
  el.vThr2.textContent = me.issuedThrottle.toFixed(1) + ' g';

  el.clock.textContent = 't ' + fmtClock(S.t) + (run.paused ? ', ' + pauseLabel() : ', ×' + (run.scale < 10 ? run.scale.toFixed(1) : Math.round(run.scale))) +
    (net.role && run.started && S.mp ? ', пинг ' + Math.round(net.rtt) + ' мс' : '');
  el.bPause.classList.toggle('on', run.paused); el.dPause.classList.toggle('on', run.paused);
}

// угрозы: столкновение с телом и вражеские торпеды; о новом столкновении ещё и всплывающее сообщение
function threatText() {
  const imp = run.started && !S.over ? impactIn('me', 120) : null;
  if (imp && !impactWarned) say('Курс ведёт к столкновению с ' + imp.hit.name + ' через ' + Math.round(imp.hitT) + ' с');
  impactWarned = !!imp;
  const th = nearestThreat('me'), n = S.torps.filter(t => t.owner === 'foe').length;
  return (imp ? 'Столкновение с ' + imp.hit.name + ' через ' + Math.round(imp.hitT) + ' с. ' : '') +
    (n ? 'Торпед противника: ' + n + (th && th.ttg < 1e8 ? ', ближайшая через ' + Math.round(th.ttg) + ' с' : '') : 'Торпед противника нет');
}
