// Интерфейс: страница загружается, кнопки работают, приборы показывают состояние корабля.
// Настоящего браузера нет — вместо него DOM-заглушка по index.html (tests/dom-stub.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dom, PAGE_IDS } from './dom-stub.js';
import './lang-ru.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
// крутить кадры, пока не выполнится условие (шаг симуляции — 50 мс игрового времени)
async function framesUntil(cond, max = 20) { for (let i = 0; i < max && !cond(); i++) { await wait(30); dom.frame(); } return cond(); }
const $ = id => dom.byId.get(id);

// все id, к которым обращается код: $('…') в модулях и список ссылок в ui/dom.js
function idsUsedByCode() {
  const ids = new Set();
  const walk = d => readdirSync(d, { withFileTypes: true }).forEach(f => {
    const p = d + '/' + f.name;
    if (f.isDirectory()) return walk(p);
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)) ids.add(m[1]);
    if (p.endsWith('ui/dom.js')) for (const m of src.match(/\[([^\]]+)\]\.forEach/)[1].matchAll(/'([A-Za-z0-9_]+)'/g)) ids.add(m[1]);
  });
  walk(new URL('../src', import.meta.url).pathname);
  return ids;
}

test('каждый элемент, который ищет код, есть в index.html', () => {
  const missing = [...idsUsedByCode()].filter(id => !PAGE_IDS.has(id));
  assert.deepEqual(missing, []);
});

test('в index.html нет повторяющихся id', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(all.filter((id, i) => all.indexOf(id) !== i), []);
});

// дальше — по порядку, как играет человек: одно состояние на все проверки
const errors = [];
process.on('uncaughtException', e => errors.push(e));
process.on('unhandledRejection', e => errors.push(e));
const sim = await import('../src/sim/index.js');
const { run } = await import('../src/run.js');
const { SHIP, TEAM } = await import('../src/config.js');
await import('../src/main.js');
const me = () => sim.myShip();

// выпадающие списки слотов в составе боя: [команда][место]
function slotSelects() {
  const cols = $('roster').children;
  return cols.map(col => col.children.slice(1).map(row => row.children.find(c => c.tagName === 'SELECT') || null));
}

test('игра загружается и рисует кадры без ошибок', async () => {
  dom.frame(); await wait(30); dom.frame();
  assert.deepEqual(errors, []);
  assert.equal(run.started, false);
  assert.equal($('overlay').hidden, false);
  assert.equal($('ovBtn').textContent, 'Начать бой');
});

test('состав боя: две команды по 5 мест, по умолчанию 1 на 1', () => {
  const sel = slotSelects();
  assert.equal(sel.length, 2);
  assert.equal(sel[0].length, TEAM.max); assert.equal(sel[1].length, TEAM.max);
  assert.equal(sel[0][0], null, 'своё место не выбирается');
  assert.equal(sel[1][0].value, 'ai');
  assert.equal($('rosterSize').textContent, '1 на 1');
  assert.equal(sel[1][1].children.some(o => o.value === 'human'), false, 'в одиночной игре мест для людей нет');
});

test('в одиночной игре можно перейти к красным и вернуться', () => {
  const header = t => $('roster').children[t].children[0];
  header(1).children.find(c => c.textContent === 'Перейти сюда').click();
  let rows = $('roster').children;
  assert.match(rows[1].children[1].textContent, /\(вы\)/);
  assert.equal(slotSelects()[0][0].value, 'ai', 'ИИ занял ваше место у синих');
  header(0).children.find(c => c.textContent === 'Перейти сюда').click();
  rows = $('roster').children;
  assert.match(rows[0].children[1].textContent, /\(вы\)/);
  assert.equal(slotSelects()[1][0].value, 'ai');
});

test('если убрать всех противников, бой не начать', () => {
  const s = slotSelects()[1][0];
  s.value = 'off'; s.onchange();
  assert.equal($('ovBtn').disabled, true);
  const s2 = slotSelects()[1][0];
  s2.value = 'ai'; s2.onchange();
  assert.equal($('ovBtn').disabled, false);
});

test('бой 3 на 3 с ИИ запускается кнопкой «Начать бой»', async () => {
  for (const [t, i] of [[0, 1], [0, 2], [1, 1], [1, 2]]) { const s = slotSelects()[t][i]; s.value = 'ai'; s.onchange(); }
  assert.equal($('rosterSize').textContent, '3 на 3');
  $('ovBtn').click();
  assert.equal(run.started, true);
  assert.equal($('overlay').hidden, true);
  assert.equal(sim.S.ships.length, 6);
  assert.equal(me().ctrl, 'human');
  assert.equal(sim.S.ships.filter(s => s.ai).length, 5);
  const t0 = sim.S.t;
  for (let i = 0; i < 5; i++) { await wait(30); dom.frame(); }
  assert.ok(sim.S.t > t0, 'время боя идёт');
  assert.deepEqual(errors, []);
});

test('приборы показывают топливо, корпус, состав команд и цель', () => {
  assert.equal($('vFuel').textContent, Math.round(me().fuel) + ' м/с');
  assert.equal($('mFuel').textContent, String(Math.round(me().fuel)));
  assert.equal($('vHp').textContent, '100%');
  assert.equal($('vTorp').textContent, String(SHIP.torps));
  assert.equal($('vTeams').textContent, 'Синие 3/3 · Красные 3/3');
  assert.match($('vContact').textContent, new RegExp('^Цель ' + sim.S.ships[me().targetId].name));
});

test('клавиша Q и кнопка «Сменить цель» перебирают противников', () => {
  const seen = new Set([me().targetId]);
  dom.key('KeyQ'); seen.add(me().targetId);
  $('bTarget').click(); seen.add(me().targetId);
  assert.equal(seen.size, 3);
  for (const id of seen) assert.equal(sim.S.ships[id].team, 1);
});

test('клавиша W прибавляет тягу, топливо начинает тратиться', async () => {
  const f0 = me().fuel;
  dom.key('KeyW'); dom.key('KeyW');
  assert.equal(me().issuedThrottle, 2);
  for (let i = 0; i < 5; i++) { await wait(30); dom.frame(); }
  assert.ok(me().fuel < f0, 'топливо тратится');
  assert.equal($('vThr').textContent, '2.0 g');
  dom.key('KeyX');
  assert.equal(me().issuedThrottle, 0);
});

test('кнопки боковой панели отдают приказы', async () => {
  const torps = me().torps;
  $('bTorp').click();
  assert.ok(await framesUntil(() => me().torps === torps - 1), 'торпеда пущена');
  assert.equal(sim.S.torps.at(-1).target, me().targetId);
  const flak = me().flak;
  $('bFlakShip').click();
  assert.ok(await framesUntil(() => me().flak === flak - 1), 'облако выпущено');
  $('bPause').click();
  assert.equal(run.paused, true);
  const t = sim.S.t; await wait(30); dom.frame();
  assert.equal(sim.S.t, t, 'на паузе время стоит');
  $('bPause').click();
  assert.equal(run.paused, false);
});

test('кнопки скорости времени', () => {
  dom.speedBtns.find(b => b.dataset.speed === '10').click();
  assert.equal(run.chosen, 10);
  dom.speedBtns.find(b => b.dataset.speed === '1').click();
  assert.equal(run.chosen, 1);
});

test('свой корабль погиб — бой продолжается, камера на союзнике', async () => {
  me().alive = false;
  await wait(30); dom.frame();
  assert.equal(sim.S.over, false);
  assert.match($('vContact').textContent, /Ваш корабль уничтожен. Бой продолжается, камера на /);
  assert.deepEqual(errors, []);
});

test('конец боя показывает итог команды и кнопку нового боя', async () => {
  for (const s of sim.S.ships) if (s.team === 1) s.alive = false;
  assert.ok(await framesUntil(() => sim.S.over), 'бой окончен');
  await wait(1900); dom.frame(); // окно итога появляется через RESULT_DELAY (session.js)
  assert.equal($('overlay').hidden, false);
  assert.equal($('ovTitle').textContent, 'Победа');
  assert.match($('ovText').textContent, /все корабли противника уничтожены/);
  assert.match($('ovText').textContent, /Уцелело: синие 2 из 3, красные 0 из 3/);
  assert.match($('ovText').textContent, /Осталось Δv: \d+ м\/с/);
  assert.equal($('ovBtn').textContent, 'Новый бой');
  $('ovBtn').click();
  assert.equal($('overlay').hidden, true);
  assert.equal(sim.S.over, false);
  assert.equal(sim.S.ships.length, 6, 'состав сохранился');
  assert.equal(me().fuel, SHIP.dv);
  assert.deepEqual(errors, []);
});
