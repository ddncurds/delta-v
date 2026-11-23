// Планировщик манёвра и состояние приказов в интерфейсе: карточка на паузе, прогноз без изменения боя,
// приказ «принят» → «выполняется», готовность защиты
import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './dom-stub.js';
import './lang-ru.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
async function framesUntil(cond, max = 40) { for (let i = 0; i < max && !cond(); i++) { await wait(30); dom.frame(); } return cond(); }
const $ = id => dom.byId.get(id);
const input = (id, v) => { $(id).value = String(v); $(id).dispatch('input'); };

const errors = [];
process.on('uncaughtException', e => errors.push(e));
const sim = await import('../src/sim/index.js');
const { run } = await import('../src/run.js');
const { G0 } = await import('../src/config.js');
await import('../src/main.js');
const me = () => sim.myShip();

test('бой идёт, защита готова, приказов нет', async () => {
  $('ovBtn').click();
  await framesUntil(() => sim.S.t > 0.2);
  assert.equal($('vDef').textContent, 'готова');
  assert.equal($('vFlak').textContent, '●●●');
  assert.equal($('mDef').textContent, '●●●');
  assert.equal($('vOrder').textContent, '');
  assert.equal($('planner').hidden, true);
});

test('клавиша M ставит бой на паузу и открывает план; прогноз не меняет бой', async () => {
  dom.key('KeyM');
  assert.equal(run.paused, true);
  dom.frame();
  assert.equal($('planner').hidden, false);
  assert.equal($('bPlan').classList.contains('on'), true);
  input('plThr', 4); input('plDur', 10);
  const before = JSON.stringify(sim.S);
  for (let i = 0; i < 3; i++) { await wait(20); dom.frame(); }
  assert.equal(JSON.stringify(sim.S), before, 'прогноз не трогает состояние боя');
  assert.equal($('plThrV').textContent, '4.0 g');
  assert.equal($('plDurV').textContent, '10 с');
  const out = $('plOut').children.map(c => c.textContent);
  assert.ok(out.includes('Расход Δv'));
  assert.ok(out.includes(Math.round(4 * G0 * 10) + ' м/с'), 'расход Δv = тяга × время: ' + out.join(' | '));
  assert.match($('plNote').textContent, /^Прогноз на 240 с/);
});

test('готовое направление «против скорости» и отмена', () => {
  const v = me().vel;
  dom.marked.find(b => b.dataset.planDir === 'retro').click();
  dom.frame();
  assert.match($('plDirV').textContent, /180° от скорости/);
  assert.ok(Math.abs(Math.cos(Number($('plDir').value) * Math.PI / 180) - Math.cos(Math.atan2(-v[1], -v[0]))) < 0.02);
  $('plCancel').click(); dom.frame();
  assert.equal($('planner').hidden, true);
  assert.equal(me().orders.length, 0, 'отмена не отдаёт приказ');
});

test('«Применить» отдаёт манёвр: принят на паузе, выполняется после неё', async () => {
  $('bPlan').click(); dom.frame();
  input('plThr', 3); input('plDur', 5);
  $('plApply').click(); dom.frame();
  assert.equal($('planner').hidden, true);
  assert.equal(me().orders.at(-1).type, 'burn');
  assert.deepEqual(me().orders.at(-1).val.slice(1), [3, 5]);
  assert.match($('vOrder').textContent, /^Приказ принят: манёвр по плану/);
  $('bPause').click();
  assert.ok(await framesUntil(() => /^Выполняется: манёвр по плану, осталось/.test($('vOrder').textContent)), $('vOrder').textContent);
  assert.ok(me().accG > 2.9);
  assert.equal($('mOrder').textContent, $('vOrder').textContent);
});

test('снятие паузы закрывает план', async () => {
  dom.key('KeyM'); dom.frame();
  assert.equal($('planner').hidden, false);
  dom.key('KeyP');
  await wait(1600); dom.frame();
  assert.equal($('planner').hidden, true);
  assert.deepEqual(errors, []);
});
