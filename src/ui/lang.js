// Язык страницы: переводит размеченные элементы и переключает язык кнопками [data-lang].
// data-i18n="ключ" — текст элемента; data-i18n-html="ключ" — разметка (строки словаря с <kbd>);
// data-i18n-attr="атрибут:ключ;атрибут:ключ" — атрибуты (placeholder, aria-label, title)
import { t, getLang, setLang, onLang } from '../i18n.js';

export function applyStatic() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) { const [a, k] = pair.split(':'); el.setAttribute(a, t(k)); }
  }
  for (const b of document.querySelectorAll('[data-lang]')) {
    b.classList.toggle('on', b.dataset.lang === getLang());
    b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
  }
  document.documentElement.lang = getLang();
  document.title = t('title');
}

// rerender — что ещё перерисовать при смене языка (оверлей, состав, статус сети)
export function initLang(rerender) {
  for (const b of document.querySelectorAll('[data-lang]')) b.onclick = () => setLang(b.dataset.lang);
  onLang(() => { applyStatic(); rerender(); });
  applyStatic();
}
