// Короткое сообщение поверх карты
import { $ } from './dom.js';

const box = $('toast');
let timer = 0;

export function say(txt) {
  box.textContent = txt; box.classList.add('show');
  clearTimeout(timer); timer = setTimeout(() => box.classList.remove('show'), 3500);
}

export function hideToast() { box.classList.remove('show'); }
