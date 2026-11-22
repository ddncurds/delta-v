// Минимальный DOM для запуска интерфейса в Node. Элементы берутся из настоящего index.html:
// getElementById для id, которого на странице нет, возвращает null — как браузер
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
export const PAGE_IDS = new Set([...HTML.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const SPEEDS = [...HTML.matchAll(/data-speed="(\d+)"/g)].map(m => m[1]);
const noop = () => {};

function canvasContext() {
  const t = { measureText: () => ({ width: 10 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }) };
  return new Proxy(t, {
    get: (o, k) => k in o ? o[k] : typeof k === 'string' && k.startsWith('create') ? () => ({ addColorStop: noop }) : noop,
    set: (o, k, v) => { o[k] = v; return true; },
  });
}

class El {
  constructor(id = '', tag = 'div') {
    this.id = id; this.tagName = tag.toUpperCase(); this.style = {}; this.dataset = {};
    this.value = id === 'spread' ? '5' : '0'; this.checked = true; this.hidden = false; this.disabled = false;
    this.textContent = ''; this.innerHTML = ''; this.className = ''; this.title = ''; this.type = '';
    this.width = 300; this.height = 150; this.children = []; this.listeners = {};
    this.firstElementChild = { style: {} };
    const cls = new Set();
    this.classList = { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
      toggle: (c, on = !cls.has(c)) => { on ? cls.add(c) : cls.delete(c); return on; } };
    this.ctx = null;
  }
  addEventListener(type, f) { (this.listeners[type] ||= []).push(f); }
  removeEventListener() {}
  dispatch(type, e = {}) {
    const ev = { type, target: this, preventDefault: noop, stopPropagation: noop, ...e };
    if (this['on' + type]) this['on' + type](ev);
    for (const f of this.listeners[type] || []) f(ev);
  }
  click() { this.dispatch('click'); }
  append(...c) { this.children.push(...c); }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren(...c) { this.children = c; }
  remove() {}
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k] ?? null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 }; }
  getContext() { return this.ctx ||= canvasContext(); }
  setPointerCapture() {} releasePointerCapture() {} focus() {} blur() {}
}

const byId = new Map([...PAGE_IDS].map(id => [id, new El(id)]));
byId.get('c').tagName = 'CANVAS';
const speedBtns = SPEEDS.map(v => { const b = new El('', 'button'); b.dataset.speed = v; return b; });
const winListeners = {};

export const dom = {
  byId, speedBtns, raf: [],
  // один кадр requestAnimationFrame
  frame(now = performance.now()) { const r = dom.raf; dom.raf = []; r.forEach(f => f(now)); },
  key(code) { for (const f of winListeners.keydown || []) f({ code, target: new El('', 'body'), preventDefault: noop }); },
};

Object.assign(globalThis, {
  window: globalThis, devicePixelRatio: 1,
  document: {
    getElementById: id => byId.get(id) || null,
    createElement: tag => new El('', tag),
    querySelectorAll: sel => sel.startsWith('[data-speed') ? speedBtns.filter(b => sel === '[data-speed]' || sel.includes('"' + b.dataset.speed + '"')) : [],
    querySelector: () => null,
    addEventListener: noop, body: new El('', 'body'), head: new El('', 'head'), hidden: false,
  },
  location: { protocol: 'http:', hash: '', search: '', pathname: '/', origin: 'http://localhost:8080', href: 'http://localhost:8080/' },
  history: { replaceState: noop },
  localStorage: { getItem: () => null, setItem: noop },
  addEventListener: (t, f) => { (winListeners[t] ||= []).push(f); },
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  ResizeObserver: class { observe() {} disconnect() {} },
  ImageData: class { constructor(data, w, h) { this.data = data; this.width = w; this.height = h; } },
  requestAnimationFrame: f => { dom.raf.push(f); return dom.raf.length; },
});
