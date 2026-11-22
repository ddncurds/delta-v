// Интерфейс на английском по умолчанию и переключение языков. Ни один видимый текст не должен остаться на другом языке
import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './dom-stub.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => dom.byId.get(id);
async function framesUntil(cond, max = 30) { for (let i = 0; i < max && !cond(); i++) { await wait(30); dom.frame(); } return cond(); }
const CYR = /[А-Яа-яЁё]/, LAT = /[A-Za-z]{3}/;

const errors = [];
process.on('uncaughtException', e => errors.push(e));
process.on('unhandledRejection', e => errors.push(e));
const sim = await import('../src/sim/index.js');
const { getLang } = await import('../src/i18n.js');
await import('../src/main.js');

// все тексты страницы: размеченные элементы, их атрибуты, состав боя, статус сети
function pageTexts() {
  const out = [];
  const visit = el => {
    if (!el || typeof el !== 'object') return;
    if (el.dataset?.lang) return;   // названия языков на переключателе — каждое на своём языке
    for (const v of [el.textContent, el.innerHTML, el.title, el.placeholder, el['aria-label']]) if (typeof v === 'string' && v) out.push(v);
    for (const c of el.children || []) visit(c);
  };
  dom.marked.forEach(visit);
  out.push(document.title);
  return out;
}
const russian = () => pageTexts().filter(s => CYR.test(s));
const english = () => pageTexts().filter(s => LAT.test(s) && !/flespi|Delta|Δv|ms|km|HP|MQTT/.test(s) && !CYR.test(s));

test('по умолчанию — английский: на странице нет ни слова по-русски', async () => {
  dom.frame(); await wait(30); dom.frame();
  assert.equal(getLang(), 'en');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(document.title, 'Delta‑v: tactical combat');
  assert.deepEqual(russian(), []);
  assert.match($('ovText').textContent, /^A battle of ships in the void/);
  assert.equal($('ovBtn').textContent, 'Start battle');
  assert.equal($('rosterSize').textContent, '1 vs 1');
  assert.equal($('mpStatus').textContent, 'To play online, paste a flespi token.');
  assert.equal($('bTorp').innerHTML, 'Launch torpedo <kbd>T</kbd>');
  assert.equal($('mpNick').placeholder, 'Callsign');
  const en = [...document.querySelectorAll('[data-lang="en"]')];
  assert.ok(en.length === 2 && en.every(b => b.classList.contains('on')), 'English отмечен на обоих переключателях');
});

test('бой по-английски: приборы, сообщения и подписи на карте', async () => {
  $('ovBtn').click();
  assert.equal($('toast').textContent, 'The battle has begun. Both ships are already moving. Both sides see each other for the last time.');
  assert.equal(sim.myShip().name, 'You');
  dom.drawn.length = 0;
  for (let i = 0; i < 5; i++) { await wait(30); dom.frame(); }
  assert.deepEqual(russian(), []);
  assert.match($('vFuel').textContent, / m\/s$/);
  assert.equal($('vCrew').textContent, 'normal');
  assert.match($('vContact').textContent, /^Contact (exact|lost)/);
  assert.match($('clock').textContent, /^t 00:0\d, ×/);
  const drawn = dom.drawn.filter(s => CYR.test(s));
  assert.deepEqual(drawn, [], 'на карте нет русских подписей');
  assert.ok(dom.drawn.some(s => / km\/s$/.test(s)), 'скорость в km/s');
  assert.deepEqual(errors, []);
});

test('переключение на русский в бою: страница, приборы и выбор сохраняется', async () => {
  document.querySelectorAll('[data-lang="ru"]')[1].click();
  assert.equal(getLang(), 'ru');
  assert.equal(dom.storage.get('deltav.lang'), 'ru');
  assert.equal(document.documentElement.lang, 'ru');
  await wait(30); dom.frame();
  assert.deepEqual(english(), [], 'английских надписей не осталось');
  assert.equal($('bTorp').innerHTML, 'Пуск торпеды <kbd>T</kbd>');
  assert.equal($('vCrew').textContent, 'в норме');
  assert.ok([...document.querySelectorAll('[data-lang="ru"]')].every(b => b.classList.contains('on')));
  dom.drawn.length = 0; await wait(30); dom.frame();
  assert.ok(dom.drawn.some(s => / км\/с$/.test(s)), 'карта тоже по-русски');
});

test('итог боя переводится при смене языка', async () => {
  for (const s of sim.S.ships) if (s.team === 1) { s.alive = false; s.deathBy = 'torp'; }
  assert.ok(await framesUntil(() => sim.S.over));
  await wait(1900); dom.frame(); // окно итога появляется через RESULT_DELAY (session.js)
  assert.equal($('ovTitle').textContent, 'Победа');
  assert.match($('ovText').textContent, /^Победа: корабль противника уничтожен торпедой\. Бой длился/);
  document.querySelectorAll('[data-lang="en"]')[0].click();
  assert.equal($('ovTitle').textContent, 'Victory');
  assert.match($('ovText').textContent, /^Victory: the enemy ship was destroyed by a torpedo\. The battle lasted \d+ min \d+ s\. Δv left: \d+ m\/s\./);
  assert.equal($('ovBtn').textContent, 'New battle');
  assert.deepEqual(russian(), []);
});

test('состав боя и статус сети переводятся вместе с языком', () => {
  const sel = $('roster').children[1].children[1].children.find(c => c.tagName === 'SELECT');
  assert.equal(sel.children.find(o => o.value === 'ai').textContent, 'AI Viper');
  assert.equal($('roster').children[0].children[0].textContent.startsWith('Blue'), true);
  document.querySelectorAll('[data-lang="ru"]')[0].click();
  const sel2 = $('roster').children[1].children[1].children.find(c => c.tagName === 'SELECT');
  assert.equal(sel2.children.find(o => o.value === 'ai').textContent, 'ИИ Гадюка');
  assert.equal($('mpStatus').textContent, 'Чтобы играть по сети, вставьте токен flespi.');
  assert.equal($('rosterSize').textContent, '1 на 1');
  document.querySelectorAll('[data-lang="en"]')[0].click();
  assert.equal($('mpStatus').textContent, 'To play online, paste a flespi token.');
  assert.deepEqual(errors, []);
});
