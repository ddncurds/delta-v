// Приборы: боковая панель на компьютере и плашки поверх карты на телефоне
import { G0, SHIP, FLAK, D2R } from '../config.js';
import { t } from '../i18n.js';
import { clamp, dist } from '../lib/math.js';
import { fmtDist, fmtClock } from '../lib/format.js';
import { S, reactionDelay, nearestThreat, gravAt, mainBody, impactIn, myShip, viewShip, teamCount, shownPos } from '../sim/index.js';
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
  const me = myShip(), st = me.stress;
  const gv = gravAt(me.pos[0], me.pos[1]), gg = Math.hypot(gv[0], gv[1]) / G0, mb = mainBody(me.pos);

  const fuelCls = me.fuel < SHIP.dv * 0.2 ? 'warn' : '';
  el.vFuel.textContent = Math.round(me.fuel) + ' ' + t('u.ms'); setBar('bFuel', me.fuel / SHIP.dv, fuelCls);
  el.vHp.textContent = Math.round(me.hp) + '%'; setBar('bHp', me.hp / 100, hpCls(me.hp));
  el.vG.textContent = me.accG.toFixed(1) + ' g'; setBar('bG', me.accG / SHIP.maxG, gCls(me.accG));
  el.vCrew.textContent = t(st < 20 ? 'hud.crew.ok' : st < 40 ? 'hud.crew.tired' : st < 70 ? 'hud.crew.slow' : 'hud.crew.limit');
  setBar('bCrew', st / 100, crewCls(st));
  el.vDelay.textContent = reactionDelay(me).toFixed(1) + ' ' + t('u.s');
  el.vSpeed.textContent = (Math.hypot(me.vel[0], me.vel[1]) / 1000).toFixed(2) + ' ' + t('u.kms');
  el.vGrav.textContent = gg.toFixed(2) + ' g';
  el.vBody.textContent = mb ? mb.b.name + ', ' + fmtDist(Math.max(0, mb.alt)) : '—';
  if (!dragging.thr) el.thr.value = me.issuedThrottle;
  el.vThr.textContent = me.issuedThrottle.toFixed(1) + ' g';
  el.vTorp.textContent = me.torps;
  el.vFlak.textContent = '●'.repeat(me.flak) + '○'.repeat(FLAK.charges - me.flak);
  el.vFlak.title = me.flakTimer > 0 ? t('hud.flakNext', { s: Math.ceil(me.flakTimer) }) : '';
  el.vSpread.textContent = (me.spread / D2R).toFixed(1).replace('.0', '') + '°';

  el.vContact.textContent = contactText(me);
  el.vTeams.textContent = S.ships.length > 2 ? [0, 1].map(k => t('team.' + k) + ' ' + teamCount(k).join('/')).join(' · ') : '';
  el.vThreat.textContent = threatText(viewShip());
  $('zhome').classList.toggle('on', !cam.follow);

  el.mFuel.textContent = Math.round(me.fuel); setBar('mbFuel', me.fuel / SHIP.dv, fuelCls);
  el.mGrav.textContent = gg.toFixed(2); setBar('mbGrav', gg / 1.5, gg >= 1 ? 'warn' : '');
  el.mHp.textContent = Math.round(me.hp) + '%'; setBar('mbHp', me.hp / 100, hpCls(me.hp));
  el.mG.textContent = me.accG.toFixed(1); setBar('mbG', me.accG / SHIP.maxG, gCls(me.accG));
  el.mCrew.textContent = Math.round(st) + '%'; setBar('mbCrew', st / 100, crewCls(st));
  el.mContact.textContent = (el.vTeams.textContent ? el.vTeams.textContent + '. ' : '') + el.vContact.textContent;
  el.mThreat.textContent = el.vThreat.textContent;
  if (!dragging.thr2) el.thr2.value = me.issuedThrottle;
  el.vThr2.textContent = me.issuedThrottle.toFixed(1) + ' g';

  el.clock.textContent = 't ' + fmtClock(S.t) + (run.paused ? ', ' + pauseLabel() : ', ×' + (run.scale < 10 ? run.scale.toFixed(1) : Math.round(run.scale))) +
    (net.role && run.started && S.mp ? ', ' + t('hud.ping', { ms: Math.round(net.rtt) }) : '');
  el.bPause.classList.toggle('on', run.paused); el.dPause.classList.toggle('on', run.paused);
}

// цель своего корабля: что о ней известно
function contactText(me) {
  if (!me.alive) {
    const v = viewShip();
    return v === me ? t('hud.dead') : t('hud.deadView', { name: v.name });
  }
  const e = S.ships[me.targetId], tr = e && S.tracks[me.id][e.id];
  if (!tr || !e.alive) return t('hud.noTarget');
  const d = (dist(me.pos, shownPos(tr)) / 1000).toFixed(0), who = S.ships.length > 2 ? t('hud.targetOf', { name: e.name }) : '';
  const txt = tr.exact ? t('hud.contact', { d, hp: Math.round(e.hp) }) : t('hud.lost', { ago: S.t - tr.seenT, d });
  return who ? who + txt : txt[0].toUpperCase() + txt.slice(1);
}

// угрозы: столкновение с телом и вражеские торпеды; о новом столкновении ещё и всплывающее сообщение
function threatText(me) {
  const imp = run.started && !S.over && me.alive ? impactIn(me, 120) : null;
  if (imp && !impactWarned) say(t('hud.impactSay', { name: imp.hit.name, s: imp.hitT }));
  impactWarned = !!imp;
  const th = nearestThreat(me), n = S.torps.filter(t => t.team !== me.team).length;
  return (imp ? t('hud.impact', { name: imp.hit.name, s: imp.hitT }) : '') +
    (n ? t('hud.torps', { n }) + (th && th.ttg < 1e8 ? t('hud.torpsNext', { s: th.ttg }) : '') : t('hud.noTorps'));
}
