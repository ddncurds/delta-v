// Начало и конец боя: оверлей со стартовым экраном, составом боя и итогом
import { S, newGame, myShip, teamCount } from './sim/index.js';
import { TEAM } from './config.js';
import { fmtClock } from './lib/format.js';
import { run } from './run.js';
import { cam } from './render/camera.js';
import { resetStars } from './render/stars.js';
import { $, el } from './ui/dom.js';
import { say, hideToast } from './ui/toast.js';
import { net, lobbyClose, lobbyOpen, mpRender, hostStart } from './net/multiplayer.js';
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
  if (mine) mine.name = $('mpNick').value.trim().slice(0, 16) || 'Вы';
  newGame({ roster });
  const [a, b] = [teamCount(0)[1], teamCount(1)[1]];
  beginBattle(a + b === 2 ? 'Бой начался. Оба корабля уже в движении. Обе стороны видят друг друга в последний раз.'
    : 'Бой ' + a + ' на ' + b + ' начался. Цель — ' + S.ships[myShip().targetId].name + ', сменить: Q.');
}

function showResult() {
  const r = S.result, won = r.startsWith('Победа');
  $('ovTitle').textContent = won ? 'Победа' : r.startsWith('Взаимное') ? 'Ничья' : r.startsWith('Бой прерван') ? 'Бой прерван' : 'Поражение';
  const [mm, ss] = fmtClock(S.t).split(':').map(Number);
  const me = myShip(), st = S.stats[S.myId];
  const teams = S.ships.length > 2 ? ' Уцелело: ' + [0, 1].map(t => TEAM.names[t].toLowerCase() + ' ' + teamCount(t).join(' из ')).join(', ') + '.' : '';
  $('ovText').textContent = r + '. Бой длился ' + mm + ' мин ' + ss + ' с.' + teams + ' Осталось Δv: ' + Math.round(me.fuel) +
    ' м/с. Пущено торпед: ' + st.launched + ', сбито торпед противника: ' + st.kills + '.';
  $('ovKeys').hidden = true; $('ovTouch').hidden = true;
  el.overlay.hidden = false;
  mpRender();
  if (!net.role) lobbyOpen();
  else if (net.role === 'guest') $('mpStatus').textContent = 'Новый бой начнёт ' + net.hostNick + '.';
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
