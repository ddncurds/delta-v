// Языки: словари, ключи в коде, сохранённый выбор, сетевая игра на разных языках
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// игрок уже выбирал русский: выбор хранится в браузере
const store = new Map([['deltav.lang', 'ru']]);
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
const { t, tm, getLang, setLang, onLang, DICTS, LANGS } = await import('../src/i18n.js');
const sim = await import('../src/sim/index.js');
const { newGame, resultFor } = sim;
const { makeSnapshot, applySnapshot, newPeerSync, netRoster } = await import('../src/net/snapshot.js');

const CYR = /[А-Яа-яЁё]/;
const params = s => [...s.matchAll(/\{(\w+)(?:\|\w)?\}/g)].map(m => m[1]).sort();

test('сохранённый выбор языка подхватывается при запуске', () => {
  assert.equal(getLang(), 'ru');
  assert.equal(t('btn.start'), 'Начать бой');
});

test('переключение языка: строки, сохранение, оповещение', () => {
  let heard = '';
  const off = onLang(l => { heard = l; });
  assert.equal(setLang('en'), true);
  assert.equal(heard, 'en'); assert.equal(store.get('deltav.lang'), 'en');
  assert.equal(t('btn.start'), 'Start battle');
  assert.equal(setLang('de'), false, 'неизвестный язык не выбирается');
  assert.equal(getLang(), 'en');
  off();
});

test('словари: одинаковые ключи и одинаковые параметры в каждой строке', () => {
  assert.deepEqual(LANGS, ['en', 'ru']);
  const en = Object.keys(DICTS.en).sort(), ru = Object.keys(DICTS.ru).sort();
  assert.deepEqual(ru, en);
  for (const k of en) {
    assert.deepEqual(params(DICTS.ru[k]), params(DICTS.en[k]), 'параметры в ' + k);
    assert.ok(DICTS.ru[k].trim() && DICTS.en[k].trim(), 'пустая строка ' + k);
  }
  assert.equal(DICTS.en['cs.0'].split(',').length, 5); assert.equal(DICTS.ru['cs.1'].split(',').length, 5);
  assert.equal(DICTS.en.bodies.split(',').length, DICTS.ru.bodies.split(',').length);
});

test('в английском словаре нет кириллицы', () => {
  for (const [k, v] of Object.entries(DICTS.en)) assert.ok(!CYR.test(v), k + ': ' + v);
});

test('каждый ключ из кода и со страницы есть в словаре', () => {
  const keys = new Set();
  // ключи с точкой; простые слова ('guest', 'start') — это роли и id, а не ключи
  const PREFIX = /'((?:msg|mp|hud|map|res|r|btn|start|guest|pause|team|cs|u|chip|zoom|keys|touch|dock|panel|sec|row|err|lang|title|thr|spread|roster)\.[\w.]+)'/g;
  const walk = d => readdirSync(d, { withFileTypes: true }).forEach(f => {
    const p = d + '/' + f.name;
    if (f.isDirectory()) { if (f.name !== 'i18n') walk(p); return; }
    for (const m of readFileSync(p, 'utf8').matchAll(PREFIX)) if (!m[1].endsWith('.')) keys.add(m[1]);
  });
  walk(new URL('../src', import.meta.url).pathname);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) keys.add(pair.split(':')[1]);
  // ключи, которые код собирает из частей
  for (const why of ['crew', 'flak', 'plume', 'frag', 'crash', 'torp']) keys.add('res.win.' + why).add('res.loss.' + why);
  for (const k of ['team.0', 'team.1', 'team.0.l', 'team.1.l', 'cs.0', 'cs.1', 'res.t.win', 'res.t.loss', 'res.t.draw', 'res.t.abort', 'intro', 'you', 'bodies', 'pause', 'autoSlow']) keys.add(k);
  // 'res.win' — не ключ, а начало ключей победы (resultTitle в session.js)
  const missing = [...keys].filter(k => !(k in DICTS.en) && k !== 'res.win');
  assert.deepEqual(missing, []);
  assert.ok(keys.size > 200, 'нашли ' + keys.size + ' ключей');
});

test('параметры и форматы: расстояние в км и м на своём языке, секунды округлены', () => {
  setLang('en');
  assert.equal(t('msg.missOwn', { dist: 1234 }), 'Your torpedo missed by 1.23 km and exploded');
  assert.equal(t('msg.missOwn', { dist: 420 }), 'Your torpedo missed by 420 m and exploded');
  assert.equal(t('hud.impact', { name: 'Rhea', s: 41.7 }), 'Collision with Rhea in 42 s. ');
  setLang('ru');
  assert.equal(t('msg.missOwn', { dist: 1234 }), 'Ваша торпеда промахнулась на 1.23 км и взорвалась');
  assert.equal(t('нет.такого'), 'нет.такого', 'пропущенный ключ виден сразу');
  assert.equal(tm(['res.draw']), 'Взаимное уничтожение');
  assert.equal(tm(null), '');
});

test('позывные и «Вы» — на языке того, кто создаёт бой', () => {
  setLang('en');
  newGame();
  assert.equal(sim.S.ships[0].name, 'You'); assert.equal(sim.S.ships[1].name, 'Viper');
  assert.ok(sim.S.bodies.every(b => !CYR.test(b.name)));
  setLang('ru');
  newGame();
  assert.equal(sim.S.ships[0].name, 'Вы'); assert.equal(sim.S.ships[1].name, 'Гадюка');
});

test('итог боя на текущем языке', () => {
  newGame(); sim.S.ships[1].alive = false; sim.S.ships[1].deathBy = 'flak';
  setLang('en'); assert.equal(resultFor(0), 'Victory: the enemy ship was shredded by a pellet cloud');
  setLang('ru'); assert.equal(resultFor(0), 'Победа: корабль противника разрушен облаком шариков');
});

test('сетевая игра: хост на русском, гость на английском — гость читает сообщения и итог по-английски', () => {
  setLang('ru');
  const roster = [{ team: 0, ctrl: 'human', owner: 'host' }, { team: 1, ctrl: 'human', owner: 'G' }];
  newGame({ mp: true, roster, myId: 0 }); sim.S.bodies = [];
  sim.S.over = true;
  const m = JSON.parse(JSON.stringify(makeSnapshot(1, newPeerSync(), { scale: 1, pauseReason: '', ack: 0,
    say: [['msg.enemyLaunched', { name: 'Хост' }]], result: ['res.loss.torp'] })));
  assert.ok(!JSON.stringify(m.say).includes('пустил'), 'по сети идут ключи, а не русский текст');
  setLang('en');
  newGame({ mp: true, guest: true, roster: netRoster(roster), myId: 1, bodies: [] });
  applySnapshot(m, false);
  assert.equal(sim.S.result, 'Defeat: the ship was destroyed by a torpedo');
  assert.equal(t(m.say[0][0], m.say[0][1]), 'Enemy Хост launched a torpedo');
});
