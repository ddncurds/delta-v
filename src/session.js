// Начало и конец боя: оверлей со стартовым экраном и итогом
import { S, newGame } from './sim/index.js';
import { fmtClock } from './lib/format.js';
import { run } from './run.js';
import { cam } from './render/camera.js';
import { resetStars } from './render/stars.js';
import { $, el } from './ui/dom.js';
import { say, hideToast } from './ui/toast.js';
import { net, lobbyClose, lobbyOpen, mpRender, requestRematch } from './net/multiplayer.js';

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
  lobbyClose(); newGame();
  beginBattle('Бой начался. Оба корабля уже в движении. Обе стороны видят друг друга в последний раз.');
}

function showResult() {
  const won = S.result.startsWith('Победа');
  $('ovTitle').textContent = won ? 'Победа' : S.result.startsWith('Взаимное') ? 'Ничья' : 'Поражение';
  const [mm, ss] = fmtClock(S.t).split(':').map(Number);
  $('ovText').textContent = S.result + '. Бой длился ' + mm + ' мин ' + ss + ' с. Пущено торпед: ' + S.stats.me.launched +
    ', сбито торпед противника: ' + S.stats.me.kills + '.';
  $('ovKeys').hidden = true; $('ovTouch').hidden = true;
  el.overlay.hidden = false;
  mpRender();
  if (!net.role) lobbyOpen();
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
    if (net.role) requestRematch(); else startGame();
  };
}
