// Карточка планировщика манёвра: направление, тяга, длительность, прогноз и кнопки «Применить» и «Отмена».
// Планировать можно на паузе: открытие карточки ставит бой на паузу, снятие паузы карточку закрывает
import { G0, PLAN, D2R } from '../config.js';
import { wrap } from '../lib/math.js';
import { t, onLang } from '../i18n.js';
import { S, myShip } from '../sim/index.js';
import { run } from '../run.js';
import { draft, openDraft, closeDraft, presetAngle, draftBurn, draftForecast } from '../maneuver.js';
import { order, togglePause, canIssue } from './controls.js';
import { $ } from './dom.js';
import { say } from './toast.js';

const PAUSE_WAIT = 1500;    // мс: в сетевом бою пауза приходит от хоста не сразу
const R2D = 1 / D2R;
let shown = '';

export function openPlanner() {
  if (!canIssue()) return;
  openDraft(performance.now());
  if (!run.paused) togglePause();
}

function applyPlan() {
  if (!draft.open || !canIssue()) return;
  order('burn', draftBurn());
  say(t('plan.applied', { g: draft.g.toFixed(1), d: draft.dur }));
  closeDraft();
}

export function initPlanner() {
  const slider = (id, f) => $(id).addEventListener('input', () => { f(+$(id).value); shown = ''; });
  slider('plDir', v => { draft.ang = v * D2R; });
  slider('plThr', v => { draft.g = v; });
  slider('plDur', v => { draft.dur = v; });
  for (const b of document.querySelectorAll('[data-plan-dir]')) {
    b.onclick = () => { const a = presetAngle(b.dataset.planDir); if (a !== null) { draft.ang = wrap(a); shown = ''; } };
  }
  $('plApply').onclick = applyPlan;
  $('plCancel').onclick = closeDraft;
  $('bPlan').onclick = $('dPlan').onclick = () => (draft.open ? closeDraft() : openPlanner());
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || !run.started) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' && e.target.type !== 'range') return;
    if (e.code === 'KeyM') draft.open ? closeDraft() : openPlanner();
    else if (draft.open && e.code === 'Escape') closeDraft();
    else if (draft.open && e.code === 'Enter' && tag !== 'BUTTON') applyPlan();
  });
  onLang(() => { shown = ''; });
}

// уровень нагрузки экипажа по пиковой усталости за манёвр
const loadKey = peak => peak >= 100 ? 'plan.load.crit' : peak >= 40 ? 'plan.load.high' : peak >= 20 ? 'plan.load.mod' : 'plan.load.low';

function row(dl, label, value, cls = '') {
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = t(label); dd.textContent = value; if (cls) dd.className = cls;
  dl.append(dt, dd);
}

// прогноз в карточке: перерисовка, только когда он изменился
function renderForecast(f) {
  const n = f.next, dl = $('plOut');
  dl.replaceChildren();
  row(dl, 'plan.start', t('plan.startV', { s: n.delay.toFixed(1) }));
  row(dl, 'plan.cost', Math.round(n.dv) + ' ' + t('u.ms'));
  row(dl, 'plan.rest', Math.round(n.fuel) + ' ' + t('u.ms'), n.fuel < 1000 ? 'warn' : '');
  row(dl, 'plan.crew', t(loadKey(n.peak)) + ', ' + Math.round(Math.min(100, n.peak)) + '%', n.peak >= 100 ? 'bad' : n.peak >= 40 ? 'warn' : '');
  row(dl, 'plan.alt', n.minAlt ? t('plan.altV', { alt: n.minAlt.alt, body: n.minAlt.body.name, s: n.minAlt.t }) : t('plan.none'));
  row(dl, 'plan.hit', n.hit ? t('plan.hitV', { body: n.hit.name, s: n.hitT }) : t('plan.noHit', { T: PLAN.T }), n.hit ? 'bad' : '');
  row(dl, 'plan.near', n.near ? t('plan.nearV', { d: n.near.d, s: n.near.t }) : t('plan.none'));
  const short = n.dv < draft.g * G0 * draft.dur - 1 ? t('plan.short') + ' ' : '';
  $('plNote').textContent = short + t('plan.note', { T: PLAN.T, d: n.delay.toFixed(1) }) + (n.skipped ? t('plan.skip', { n: n.skipped }) : '');
}

// каждый кадр: закрыть карточку, если планировать уже нельзя, иначе показать черновик и прогноз
export function updatePlanner(now = performance.now()) {
  const box = $('planner');
  if (draft.open && (!canIssue() || (!run.paused && now - draft.since > PAUSE_WAIT))) closeDraft();
  box.hidden = !draft.open;
  $('bPlan').classList.toggle('on', draft.open); $('dPlan').classList.toggle('on', draft.open);
  if (!draft.open) { shown = ''; return; }
  const me = myShip(), deg = Math.round(wrap(draft.ang) * R2D);
  const rel = Math.round(wrap(draft.ang - Math.atan2(me.vel[1], me.vel[0])) * R2D);
  if (document.activeElement !== $('plDir')) $('plDir').value = deg;
  $('plThr').value = draft.g; $('plDur').value = draft.dur;
  $('plDirV').textContent = t('plan.dirV', { a: deg, rel: t('plan.rel', { d: (rel > 0 ? '+' : '') + rel }) });
  $('plThrV').textContent = draft.g.toFixed(1) + ' g';
  $('plDurV').textContent = draft.dur + ' ' + t('u.s');
  const f = draftForecast();
  if (!f || f.key + S.t === shown) return;
  shown = f.key + S.t;
  renderForecast(f);
}
