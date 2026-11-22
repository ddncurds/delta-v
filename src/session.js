// Начало и конец боя: оверлей со стартовым экраном, составом боя и итогом
import { S, newGame, myShip, teamCount } from './sim/index.js';
import { t } from './i18n.js';
import { fmtClock } from './lib/format.js';
import { run } from './run.js';
import { cam } from './render/camera.js';
import { resetStars } from './render/stars.js';
import { $, el } from './ui/dom.js';
import { say, hideToast } from './ui/toast.js';
import { net, lobbyClose, lobbyOpen, mpRender, mpStatus, hostStart } from './net/multiplayer.js';
import { slotsToRoster, rosterValid } from './roster.js';

// S уже подготовлен (newGame или снимок хоста): переключаем интерфейс в бой
export function beginBattle(msg) {
  cam.follow = true; resetStars();
  run.started = true; run.paused = false; run.scale = run.chosen;
  el.spread.value = 5;
  document.querySelectorAll('[data-speed="30"]').forEach(b => { b.disabled = S.mp; });
  el.overlay.hidden = true; hideToast();
  say(msg);
}

function startGame() {
  if (!rosterValid(net.slots)) return;
  lobbyClose();
  const roster = slotsToRoster(net.slots), mine = roster.find(r => r.owner === 'local');
  if (mine) mine.name = $('mpNick').value.trim().slice(0, 16) || t('you');
  newGame({ roster });
  const [a, b] = [teamCount(0)[1], teamCount(1)[1]];
  beginBattle(a + b === 2 ? t('start.duel') : t('start.team', { a, b, name: S.ships[myShip().targetId].name }));
}

// заголовок итога по ключу результата
function resultTitle(key) {
  const k = key?.[0] || '';
  return t(k.startsWith('res.win') ? 'res.t.win' : k === 'res.draw' ? 'res.t.draw' : k === 'res.abort' ? 'res.t.abort' : 'res.t.loss');
}

// текст оверлея на текущем языке: до первого боя — вступление, после — итог
export function renderOverlay() {
  if (!S.reported || !S.resultKey) { $('ovTitle').textContent = t('title.short'); $('ovText').textContent = t('intro'); return; }
  const [mm, ss] = fmtClock(S.t).split(':').map(Number);
  const me = myShip(), st = S.stats[S.myId], [a0, n0] = teamCount(0), [a1, n1] = teamCount(1);
  const teams = S.ships.length > 2 ? t('res.teams', { blue: t('team.0.l'), red: t('team.1.l'), a0, n0, a1, n1 }) : '';
  $('ovTitle').textContent = resultTitle(S.resultKey);
  $('ovText').textContent = t('res.summary', { result: t(S.resultKey[0], S.resultKey[1]), mm, ss, teams,
    dv: Math.round(me.fuel), launched: st.launched, kills: st.kills });
}

function showResult() {
  renderOverlay();
  $('ovKeys').hidden = true; $('ovTouch').hidden = true;
  el.overlay.hidden = false;
  mpRender();
  if (!net.role) lobbyOpen();
  else if (net.role === 'guest') mpStatus('guest.waitNew', { host: net.hostNick });
}

// бой закончился: итог показываем с небольшой паузой, чтобы успел отыграть взрыв
export function checkResult() {
  if (!S.over || S.reported) return;
  S.reported = true;
  setTimeout(showResult, 900);
}

export function initSession() {
  $('ovBtn').onclick = () => {
    $('ovKeys').hidden = false; $('ovTouch').hidden = false;
    if (net.role === 'host') hostStart(); else if (!net.role) startGame();
  };
}
