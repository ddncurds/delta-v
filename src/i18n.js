// Языки интерфейса. t('ключ', { параметры }) — строка на текущем языке; по умолчанию английский, выбор хранится в браузере.
// В строках словаря {x} — параметр как есть, {x|d} — расстояние в метрах (км/м), {x|s} — секунды, округлённые до целых.
// Сообщения симуляции и итог боя хранятся как [ключ, параметры], а не текстом: хост сетевой игры шлёт их гостям,
// и каждый видит их на своём языке
import en from './i18n/en.js';
import ru from './i18n/ru.js';

export const DICTS = { en, ru };
export const LANGS = ['en', 'ru'];
const STORE = 'deltav.lang';

let lang = 'en';
try { const v = globalThis.localStorage?.getItem(STORE); if (LANGS.includes(v)) lang = v; } catch (_) {}
const listeners = new Set();

export const getLang = () => lang;
export const onLang = f => { listeners.add(f); return () => listeners.delete(f); };

export function setLang(l) {
  if (!LANGS.includes(l)) return false;
  lang = l;
  try { globalThis.localStorage?.setItem(STORE, l); } catch (_) {}
  for (const f of listeners) f(l);
  return true;
}

const fmt = {
  d: (m, d) => m >= 1000 ? (Math.round(m / 10) / 100) + ' ' + d['u.km'] : Math.round(m) + ' ' + d['u.m'],
  s: v => String(Math.round(v)),
};

// строка по ключу; нет ключа в словаре — английская, нет и её — сам ключ (так пропуск виден сразу)
export function t(key, p = {}) {
  const d = DICTS[lang], s = d[key] ?? en[key] ?? key;
  return s.replace(/\{(\w+)(?:\|(\w))?\}/g, (m, k, f) => {
    const v = p[k];
    if (v === undefined) return m;
    return f && fmt[f] ? fmt[f](v, d) : String(v);
  });
}

// сообщение-ключ [ключ, параметры] или готовая строка — в текст
export const tm = m => Array.isArray(m) ? t(m[0], m[1]) : String(m ?? '');
