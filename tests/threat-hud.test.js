// Предупреждения на карте: только актуальная угроза, включая паузу и конец боя.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './dom-stub.js';
import './lang-ru.js';
import { emptySpace, putTorp } from './helpers.js';
import { S } from '../src/sim/index.js';
import { run } from '../src/run.js';
import { updateHud } from '../src/ui/hud.js';

const banner = dom.byId.get('threatBanner');
const text = dom.byId.get('threatBannerText');

test('предупреждение различает опасный подлёт, удаление и союзную торпеду', () => {
  emptySpace(); run.started = true; run.paused = false;
  updateHud(); assert.equal(banner.hidden, true);
  const torp = putTorp(1, [10000, 0], [-1000, 0]);
  updateHud(); assert.equal(banner.hidden, false);
  assert.equal(banner.classList.contains('critical'), true);
  assert.equal(text.textContent, 'Торпеда · сближение 10 с');
  torp.vel = [1000, 0];
  updateHud(); assert.equal(banner.hidden, true);
  torp.vel = [-1000, 0]; torp.team = 0;
  updateHud(); assert.equal(banner.hidden, true);
});

test('пауза сохраняет предупреждение, конец боя и новый бой очищают его', () => {
  emptySpace(); run.started = true; run.paused = true;
  putTorp(1, [20000, 0], [-1000, 0]);
  updateHud(); assert.equal(banner.hidden, false);
  assert.equal(banner.classList.contains('critical'), false);
  S.over = true;
  updateHud(); assert.equal(banner.hidden, true);
  emptySpace(); run.started = false;
  updateHud(); assert.equal(banner.hidden, true);
  assert.equal(text.textContent, '');
});
