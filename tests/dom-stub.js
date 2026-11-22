// Минимальный DOM для запуска интерфейса в Node. Элементы берутся из настоящего index.html:
// getElementById для id, которого на странице нет, возвращает null — как браузер
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
export const PAGE_IDS = new Set([...HTML.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const noop = () => {};

function canvasContext() {
  // fillText записывает текст: тесты проверяют, на каком языке подписана карта
  const t = { measureText: () => ({ width: 10 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }), fillText: s => dom.drawn.push(String(s)) };
  return new Proxy(t, {
    get: (o, k) => k in o ? o[k] : typeof k === 'string' && k.startsWith('create') ? () => ({ addColorStop: noop }) : noop,
    set: (o, k, v) => { o[k] = v; return true; },
  });
}

class El {
  constructor(id = '', tag = 'div') {
    this.id = id; this.tagName = tag.toUpperCase(); this.style = {}; this.dataset = {};
    this.value = id === 'spread' ? '5' : '0'; this.checked = true; this.hidden = false; this.disabled = false;
    this.text = ''; this.innerHTML = ''; this.className = ''; this.title = ''; this.type = '';
    this.width = 300; this.height = 150; this.children = []; this.listeners = {};
    this.firstElementChild = { style: {} };
    const cls = new Set();
    this.classList = { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
      toggle: (c, on = !cls.has(c)) => { on ? cls.add(c) : cls.delete(c); return on; } };
    this.ctx = null;
  }
  // как в браузере: присвоение textContent заменяет детей текстом
  get textContent() { return this.children.length ? this.children.map(c => c.textContent ?? '').join('') : this.text; }
  set textContent(v) { this.children = []; this.text = String(v); }
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

// элементы страницы: все с id или data-атрибутами, с тегом, атрибутами и dataset, как в браузере
const byId = new Map(), marked = [];
const camel = k => k.replace(/-(\w)/g, (m, c) => c.toUpperCase());
for (const m of HTML.matchAll(/<(\w+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/g)) {
  const attrs = Object.fromEntries([...m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(a => [a[1], a[2] ?? '']));
  if (!attrs.id && !Object.keys(attrs).some(k => k.startsWith('data-'))) continue;
  const el = new El(attrs.id || '', m[1]);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('data-')) el.dataset[camel(k.slice(5))] = v;
    else if (k === 'hidden') el.hidden = true;
    else if (['title', 'placeholder', 'aria-label'].includes(k)) el[k] = v;
  }
  if (attrs.id) byId.set(attrs.id, el);
  marked.push(el);
}
const speedBtns = marked.filter(e => e.dataset.speed);
// [data-x] и [data-x="v"]
function select(sel) {
  const m = sel.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
  if (!m) return [];
  const k = camel(m[1]);
  return marked.filter(e => e.dataset[k] !== undefined && (m[2] === undefined || e.dataset[k] === m[2]));
}
const winListeners = {};

export const dom = {
  byId, speedBtns, marked, raf: [], clipboard: '', drawn: [], storage: new Map(),
  // один кадр requestAnimationFrame
  frame(now = performance.now()) { const r = dom.raf; dom.raf = []; r.forEach(f => f(now)); },
  key(code) { for (const f of winListeners.keydown || []) f({ code, target: new El('', 'body'), preventDefault: noop }); },
};

Object.assign(globalThis, {
  window: globalThis, devicePixelRatio: 1,
  document: {
    getElementById: id => byId.get(id) || null,
    createElement: tag => new El('', tag),
    querySelectorAll: select, documentElement: new El('', 'html'), title: '',
    querySelector: () => null,
    addEventListener: noop, body: new El('', 'body'), head: new El('', 'head'), hidden: false,
  },
  location: { protocol: 'http:', hash: '', search: '', pathname: '/', origin: 'http://localhost:8080', href: 'http://localhost:8080/' },
  // адрес страницы меняется, как в браузере: тесты проверяют ссылку #room=КОД
  history: { replaceState: (st, t, url) => { const i = String(url).indexOf('#'); location.hash = i < 0 ? '' : String(url).slice(i); } },
  localStorage: { getItem: k => dom.storage.get(k) ?? null, setItem: (k, v) => dom.storage.set(k, String(v)) },
  addEventListener: (t, f) => { (winListeners[t] ||= []).push(f); },
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  ResizeObserver: class { observe() {} disconnect() {} },
  ImageData: class { constructor(data, w, h) { this.data = data; this.width = w; this.height = h; } },
  requestAnimationFrame: f => { dom.raf.push(f); return dom.raf.length; },
});
// буфер обмена для кнопки «Скопировать ссылку»
Object.defineProperty(globalThis, 'navigator', { configurable: true,
  value: { clipboard: { writeText: t => { dom.clipboard = t; return Promise.resolve(); } } } });
