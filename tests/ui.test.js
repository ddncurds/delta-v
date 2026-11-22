// Интерфейс: страница загружается, кнопки работают, приборы показывают состояние корабля.
// Настоящего браузера нет — вместо него DOM-заглушка по index.html (tests/dom-stub.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dom, PAGE_IDS } from './dom-stub.js';

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
const { SHIP } = await import('../src/config.js');
await import('../src/main.js');

test('игра загружается и рисует кадры без ошибок', async () => {
  dom.frame(); await wait(30); dom.frame();
  assert.deepEqual(errors, []);
  assert.equal(run.started, false);
  assert.equal($('overlay').hidden, false);
  assert.equal($('ovBtn').textContent, 'Начать бой против ИИ');
});

test('кнопка «Начать бой против ИИ» запускает бой', async () => {
  $('ovBtn').click();
  assert.equal(run.started, true);
  assert.equal($('overlay').hidden, true);
  const t0 = sim.S.t;
  for (let i = 0; i < 5; i++) { await wait(30); dom.frame(); }
  assert.ok(sim.S.t > t0, 'время боя идёт');
  assert.deepEqual(errors, []);
});

test('приборы показывают топливо, корпус и тягу', () => {
  assert.equal($('vFuel').textContent, Math.round(sim.S.me.fuel) + ' м/с');
  assert.equal($('mFuel').textContent, Math.round(sim.S.me.fuel));
  assert.equal($('vHp').textContent, '100%');
  assert.equal($('vTorp').textContent, SHIP.torps);
});

test('клавиша W прибавляет тягу, топливо начинает тратиться', async () => {
  const f0 = sim.S.me.fuel;
  dom.key('KeyW'); dom.key('KeyW');
  assert.equal(sim.S.me.issuedThrottle, 2);
  for (let i = 0; i < 5; i++) { await wait(30); dom.frame(); }
  assert.ok(sim.S.me.fuel < f0, 'топливо тратится');
  assert.equal($('vThr').textContent, '2.0 g');
  dom.key('KeyX');
  assert.equal(sim.S.me.issuedThrottle, 0);
});

test('кнопки боковой панели отдают приказы', async () => {
  const torps = sim.S.me.torps;
  $('bTorp').click();
  assert.ok(await framesUntil(() => sim.S.me.torps === torps - 1), 'торпеда пущена');
  const flak = sim.S.me.flak;
  $('bFlakShip').click();
  assert.ok(await framesUntil(() => sim.S.me.flak === flak - 1), 'облако выпущено');
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

test('конец боя показывает итог с остатком Δv и кнопку нового боя', async () => {
  sim.S.foe.alive = false;
  assert.ok(await framesUntil(() => sim.S.over), 'бой окончен');
  await wait(1000); dom.frame();
  assert.equal($('overlay').hidden, false);
  assert.equal($('ovTitle').textContent, 'Победа');
  assert.match($('ovText').textContent, /Осталось Δv: \d+ м\/с/);
  assert.equal($('ovBtn').textContent, 'Ещё раз против ИИ');
  $('ovBtn').click();
  assert.equal($('overlay').hidden, true);
  assert.equal(sim.S.over, false);
  assert.equal(sim.S.me.fuel, SHIP.dv);
  assert.deepEqual(errors, []);
});
