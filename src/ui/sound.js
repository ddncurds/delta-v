// Звук взрыва через WebAudio: шумовой импульс через фильтр нижних частот — глухой удар.
// Чем сильнее взрыв, тем он громче и ниже. Контекст создаётся лениво и запускается после первого жеста игрока
// (браузер не даёт играть звук раньше); в Node и без WebAudio всё молча ничего не делает
import { FX_CONFIG } from '../config.js';

let ac = null, noise = null, on = true;
export const soundOn = () => on;
export function setSound(v) { on = !!v; }

function audio() {
  if (ac) return ac;
  const A = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!A) return null;
  try {
    ac = new A();
    // секунда белого шума — общий буфер для всех ударов
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (_) { ac = null; }
  return ac;
}

// контекст — по первому жесту игрока: клик, касание или клавиша
export function initSound() {
  const wake = () => { const a = audio(); if (a && a.state === 'suspended') a.resume().catch(() => {}); };
  for (const ev of ['pointerdown', 'keydown']) globalThis.addEventListener?.(ev, wake, { passive: true });
}

// удар силой en (0,2…2); near — 0…1, насколько близко к камере
export function boomSound(en, near = 1) {
  if (!on || !ac || ac.state !== 'running' || near < 0.02) return;
  const t = ac.currentTime, dur = 0.35 + 0.5 * en, vol = FX_CONFIG.sound.vol * Math.min(1, 0.35 + 0.4 * en) * near;
  const src = ac.createBufferSource(), lp = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = noise;
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1400 / (0.6 + en), t);
  lp.frequency.exponentialRampToValueAtTime(90 / (0.5 + 0.5 * en), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(g).connect(ac.destination);
  src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.05);
}
