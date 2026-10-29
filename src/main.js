// Точка входа: связывает модули и крутит игровой цикл
import { DT } from './config.js';
import { clamp } from './lib/math.js';
import { S, newGame, step, setSayHook, nearestThreat, impactIn } from './sim/index.js';
import { run } from './run.js';
import { resizeCamera, fitInitialZoom, easeZoom } from './render/camera.js';
import { initScene, draw } from './render/scene.js';
import { $, el } from './ui/dom.js';
import { say } from './ui/toast.js';
import { initHud, updateHud } from './ui/hud.js';
import { initControls, setSpeed } from './ui/controls.js';
import { net, netTick, hostPauseReason, initMultiplayer, joinFromUrl } from './net/multiplayer.js';
import { NET_CFG } from './net/transport.js';
import { guestStep } from './net/snapshot.js';
import { beginBattle, checkResult, initSession } from './session.js';

// сообщения симуляции: свои — на экран, для соперника — в очередь снимка сетевой игры
setSayHook((txt, key) => {
  if (key === 'me') say(txt);
  else if (net.role === 'host' && S.mp && net.sayQ.length < 20) net.sayQ.push(txt);
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

initScene(canvas);
initHud();
initControls(canvas);
initMultiplayer({ beginBattle });
initSession();
newGame();
setSpeed(1);
joinFromUrl();

// скорость времени: выбранная игроком (в сети — меньшая из двух), автоматически ниже при угрозах
function timeScale(dtReal) {
  const base = S.mp ? Math.min(run.chosen, net.peerSpeed, NET_CFG.maxSpeed) : run.chosen;
  let target = base;
  for (const [k, on] of [['me', el.autoSlow.checked], ['foe', S.mp && net.peerAuto]]) {
    if (!on) continue;
    const th = nearestThreat(k);
    if (th) target = Math.min(target, clamp(base * th.ttg / 70, 0.5, base));
    const imp = impactIn(k, 90);
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
  const live = run.started && !run.paused && !S.over;
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
  easeZoom(simTick());
  draw();
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
