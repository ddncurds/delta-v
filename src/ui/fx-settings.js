// Настройки эффектов: качество (сколько частиц во взрыве) и звук. Выбор помнится в localStorage этого браузера
import { $ } from './dom.js';
import { QUALITIES, getQuality, setQuality } from '../render/explosion.js';
import { soundOn, setSound, initSound } from './sound.js';

const KEY_Q = 'deltav.fxQuality', KEY_S = 'deltav.sound';
const load = k => { try { return globalThis.localStorage?.getItem(k); } catch (_) { return null; } };
const save = (k, v) => { try { globalThis.localStorage?.setItem(k, v); } catch (_) {} };

function mark() {
  for (const b of document.querySelectorAll('[data-fxq]')) {
    b.classList.toggle('on', b.dataset.fxq === getQuality());
    b.setAttribute('aria-pressed', String(b.dataset.fxq === getQuality()));
  }
}

export function initFxSettings() {
  const q = load(KEY_Q);
  if (QUALITIES.includes(q)) setQuality(q);
  setSound(load(KEY_S) !== '0');
  initSound();
  for (const b of document.querySelectorAll('[data-fxq]')) b.onclick = () => { setQuality(b.dataset.fxq); save(KEY_Q, getQuality()); mark(); };
  const snd = $('fxSound');
  if (snd) {
    snd.checked = soundOn();
    snd.addEventListener('change', () => { setSound(snd.checked); save(KEY_S, snd.checked ? '1' : '0'); });
  }
  mark();
}
