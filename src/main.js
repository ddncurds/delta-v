// Точка входа: связывает модули и крутит игровой цикл
import { DT } from './config.js';
import { clamp } from './lib/math.js';
import { S, newGame, step, setSayHook, nearestThreat, impactIn } from './sim/index.js';
import { run } from './run.js';
import { resizeCamera, fitInitialZoom, easeZoom } from './render/camera.js';
import { initScene, draw } from './render/scene.js';
import { $ } from './ui/dom.js';
import { say, hideToast } from './ui/toast.js';
import { t } from './i18n.js';
import { initHud, updateHud } from './ui/hud.js';
import { initControls, setSpeed } from './ui/controls.js';
import { net, netTick, hostPauseReason, initMultiplayer, joinFromUrl, netSpeedLimit, autoSlowShips, queueSay, mpRender, rerenderStatus, rerenderRooms } from './net/multiplayer.js';
import { guestStep } from './net/snapshot.js';
import { beginBattle, checkResult, initSession, renderOverlay } from './session.js';
import { initLang } from './ui/lang.js';
import { initFxSettings } from './ui/fx-settings.js';

// сообщения симуляции (ключ словаря и параметры): своему кораблю — на экран на своём языке,
// кораблям гостей — в очередь их снимков ключом, переведёт сам гость
setSayHook((id, key, p) => {
  if (id === S.myId) say(t(key, p));
  else if (net.role === 'host' && S.mp) queueSay(id, key, p);
});

const canvas = $('c');
function resize() {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  resizeCamera(r.width, r.height, dpr);
  canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
}
new ResizeObserver(resize).observe(canvas);
resize();
fitInitialZoom();

// язык: страница переводится сразу, а при переключении — заново вместе с оверлеем, составом и статусом сети
// (всплывающее сообщение на прежнем языке просто убираем)
initLang(() => { renderOverlay(); mpRender(); rerenderStatus(); rerenderRooms(); updateHud(); hideToast(); });
initScene(canvas);
initHud();
initFxSettings();
initControls(canvas);
initMultiplayer({ beginBattle });
initSession();
newGame();
renderOverlay();
setSpeed(1);
joinFromUrl();

// скорость времени: выбранная игроком (в сети — самая медленная из выбранных людьми),
// автоматически ниже, когда кораблю человека, просившего замедление, грозит торпеда или столкновение
function timeScale(dtReal) {
  const base = S.mp ? Math.min(run.chosen, netSpeedLimit()) : run.chosen;
  let target = base;
  for (const s of autoSlowShips()) {
    if (!s.alive) continue;
    const th = nearestThreat(s);
    if (th) target = Math.min(target, clamp(base * th.ttg / 70, 0.5, base));
    const imp = impactIn(s, 90);
    if (imp) target = Math.min(target, clamp(base * imp.hitT / 40, 0.5, base));
  }
  run.scale += (target - run.scale) * Math.min(1, dtReal * 4);
}

let last = performance.now(), acc = 0;
// время, симуляция и сеть; часы — performance.now(), чтобы сходились с отметками в сетевых сообщениях
function simTick() {
  const now = performance.now();
  const dtReal = Math.min(0.1, (now - last) / 1000); last = now;
  if (net.role === 'host' && run.started) { net.pauseReason = hostPauseReason(now); run.paused = !!net.pauseReason; }
  // hit-stop: после сильного взрыва на экране игра на миг замирает; в сетевом бою время не трогаем — только картинку
  const stop = run.hitStop > 0;
  if (stop) run.hitStop = Math.max(0, run.hitStop - dtReal);
  const live = run.started && !run.paused && !S.over && !(stop && !S.mp);
  if (net.role === 'guest') { if (live) guestStep(dtReal * net.snapScale); }
  else if (live) {
    timeScale(dtReal);
    acc += dtReal * run.scale;
    let n = 0;
    while (acc >= DT && n < 400) { step(DT); acc -= DT; n++; }
    if (n >= 400) acc = 0;
  }
  checkResult();
  netTick(now);
  return dtReal;
}

function frame() {
  const dtReal = simTick();
  easeZoom(dtReal);
  draw(dtReal);
  updateHud();
  requestAnimationFrame(frame);
}

// в фоновой вкладке requestAnimationFrame стоит, а таймеры страницы замедляются до раза в секунду и реже;
// таймер из воркера не тормозится, поэтому сетевой бой продолжается и в свёрнутой вкладке
try {
  const ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50)'], { type: 'text/javascript' })));
  ticker.onmessage = () => { if (document.hidden && net.role) simTick(); };
} catch (_) {}

requestAnimationFrame(frame);
