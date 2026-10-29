// Управление: приказы кораблю, указатель и жесты на карте, кнопки, клавиатура, скорость времени и пауза
import { SHIP, D2R } from '../config.js';
import { clamp } from '../lib/math.js';
import { S, issue } from '../sim/index.js';
import { run } from '../run.js';
import { cam, screenToWorld, zoomBy, zoomTo, recenter, toggleShipView, panBy } from '../render/camera.js';
import { net, netSend } from '../net/multiplayer.js';
import { $, el } from './dom.js';
import { pointer, COARSE } from './pointer.js';
import { say } from './toast.js';

const canIssue = () => run.started && !S.over && S.me.alive;

// приказ своему кораблю: локально или, у гостя сетевой игры, через хост
function order(type, val) {
  if (type === 'spread') { S.me.spread = val; if (net.role === 'guest') netSend({ type: 'spread', val }, 1); return; }
  if (net.role !== 'guest') { issue('me', type, val); return; }
  if (type === 'throttle') S.me.issuedThrottle = val;
  if (type === 'heading') S.me.issuedHeading = val;
  netSend({ type: 'order', seq: ++net.seq, o: type, val }, 1);
}

function cmdThrottle(v) { if (canIssue()) order('throttle', clamp(v, 0, SHIP.maxG)); }

const cmd = {
  cut: () => cmdThrottle(0),
  retro() {
    if (!canIssue()) return;
    const v = S.me.vel; if (Math.hypot(v[0], v[1]) < 1) return;
    order('heading', Math.atan2(-v[1], -v[0]));
  },
  flak() {
    if (!canIssue()) return;
    const p = pointer.valid ? screenToWorld(pointer.x, pointer.y) : S.tracks.me.pos;
    order('flak', Math.atan2(p[1] - S.me.pos[1], p[0] - S.me.pos[0]));
  },
  dodge: () => canIssue() && order('dodge'),
  torp: () => canIssue() && order('torp'),
  flakAuto: () => canIssue() && order('flakAuto'),
  flakShip: () => canIssue() && order('flakShip'),
  plume: () => canIssue() && order('plume'),
};

export function setSpeed(v) {
  run.chosen = v;
  document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('on', +b.dataset.speed === v));
  if (net.role === 'guest') netSend({ type: 'speed', v, auto: el.autoSlow.checked }, 1);
}

// в сетевой игре пауза общая: её ставит или снимает любой из игроков, решает хост
function togglePause() {
  if (!run.started || S.over) return;
  if (net.role === 'guest') netSend({ type: 'pause', on: !(net.pauseReason === 'me' || net.pauseReason === 'foe') }, 1);
  else if (net.role === 'host') net.pauseBy = net.pauseBy ? '' : 'me';
  else run.paused = !run.paused;
}

function setAim(v) {
  pointer.aim = v; $('dAim').classList.toggle('on', v);
  if (v) say('Коснитесь карты: куда выпустить облако');
}

// касание или клик по карте: курс туда, а в режиме прицела — облако
function tapAt(x, y) {
  if (!canIssue()) return;
  const w = screenToWorld(x, y), a = Math.atan2(w[1] - S.me.pos[1], w[0] - S.me.pos[0]);
  if (pointer.aim) { order('flak', a); setAim(false); } else order('heading', a);
}

// жесты на холсте: касание — курс, перетаскивание — сдвиг карты, два пальца — масштаб
function bindCanvas(cv) {
  const pts = new Map();
  let pinch = null, pinchUsed = false, tap = null;
  const setPtr = e => { const r = cv.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.valid = true; };
  cv.addEventListener('pointerleave', () => { if (!COARSE) pointer.valid = false; });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    setPtr(e);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    if (pts.size >= 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, m: cam.mppT };
      pinchUsed = true; tap = null; return;
    }
    tap = { x: e.clientX, y: e.clientY, id: e.pointerId, btn: e.button, lx: e.clientX, ly: e.clientY, drag: false };
  });
  cv.addEventListener('pointermove', e => {
    setPtr(e);
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      zoomTo(pinch.m * pinch.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1));
    } else if (tap && tap.id === e.pointerId && pts.size === 1) {
      if (!tap.drag && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) tap.drag = true;
      if (tap.drag) { panBy(e.clientX - tap.lx, e.clientY - tap.ly); tap.lx = e.clientX; tap.ly = e.clientY; }
    }
  });
  const end = e => {
    if (e.type === 'pointerup' && tap && tap.id === e.pointerId && !pinchUsed && !tap.drag && tap.btn === 0) { setPtr(e); tapAt(pointer.x, pointer.y); }
    tap = null; pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) pinchUsed = false;
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomBy(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
}

function bindButtons() {
  const click = (id, f) => { $(id).onclick = f; };
  // боковая панель
  click('bCut', cmd.cut); click('bRetro', cmd.retro); click('bDodge', cmd.dodge); click('bPlume', cmd.plume);
  click('bTorp', cmd.torp); click('bFlak', cmd.flak); click('bFlakAuto', cmd.flakAuto); click('bFlakShip', cmd.flakShip);
  click('bPause', togglePause);
  // нижняя панель на телефоне
  click('dDodge', cmd.dodge); click('dPlume', cmd.plume); click('dTorp', cmd.torp); click('dRetro', cmd.retro);
  click('dFlakAuto', cmd.flakAuto); click('dFlakShip', cmd.flakShip); click('dCut', cmd.cut);
  click('dAim', () => setAim(!pointer.aim)); click('dPause', togglePause);
  click('dSheet', () => document.body.classList.add('sheet'));
  click('sheetClose', () => document.body.classList.remove('sheet'));
  // камера
  click('zin', () => zoomBy(0.75)); click('zout', () => zoomBy(1.33)); click('zship', toggleShipView); click('zhome', recenter);
  el.thr.addEventListener('input', () => cmdThrottle(+el.thr.value));
  el.thr2.addEventListener('input', () => cmdThrottle(+el.thr2.value));
  el.spread.addEventListener('input', () => order('spread', +el.spread.value * D2R));
  document.querySelectorAll('[data-speed]').forEach(b => { b.onclick = () => setSpeed(+b.dataset.speed); });
  el.autoSlow.addEventListener('change', () => setSpeed(run.chosen));
}

const KEYS = {
  KeyW: () => cmdThrottle(S.me.issuedThrottle + 1), ArrowUp: () => cmdThrottle(S.me.issuedThrottle + 1),
  KeyS: () => cmdThrottle(S.me.issuedThrottle - 1), ArrowDown: () => cmdThrottle(S.me.issuedThrottle - 1),
  KeyX: cmd.cut, KeyB: cmd.retro, KeyE: cmd.dodge, KeyT: cmd.torp, KeyF: cmd.flak, KeyG: cmd.flakAuto, KeyH: cmd.flakShip, KeyR: cmd.plume,
  KeyZ: toggleShipView, KeyC: recenter, KeyP: togglePause,
  Digit1: () => setSpeed(1), Digit2: () => setSpeed(3), Digit3: () => setSpeed(10), Digit4: () => setSpeed(30),
};

function bindKeys() {
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (e.code === 'Space') { if (tag === 'BUTTON') return; e.preventDefault(); togglePause(); return; }
    if (!run.started || !KEYS[e.code]) return;
    if (e.code.startsWith('Arrow')) e.preventDefault();
    KEYS[e.code]();
  });
}

export function initControls(canvas) {
  bindCanvas(canvas);
  bindButtons();
  bindKeys();
}
