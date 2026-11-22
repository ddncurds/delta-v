// Слоты состава боя на стартовом экране
import test from 'node:test';
import assert from 'node:assert/strict';
import './lang-ru.js';
import { TEAM } from '../src/config.js';
import { defaultSlots, rosterValid, freeHumanSlot, openSeats, setSlotKind, moveTo, joinTeam, swapSlots, vacate, slotsToRoster, netSlots, teamSize, slotOf, slotTeam } from '../src/roster.js';
import { normalizeRoster } from '../src/sim/index.js';

test('по умолчанию — дуэль: вы против ИИ', () => {
  const s = defaultSlots();
  assert.equal(s.length, TEAM.max * 2);
  assert.equal(teamSize(s, 0), 1); assert.equal(teamSize(s, 1), 1);
  assert.deepEqual(slotsToRoster(s), [{ team: 0, ctrl: 'human', owner: 'local', name: '' }, { team: 1, ctrl: 'ai', owner: '', name: '' }]);
});

test('слот с человеком не меняется, пустая команда — бой не начать', () => {
  const s = defaultSlots();
  assert.equal(setSlotKind(s, 0, 'off'), false);
  assert.equal(setSlotKind(s, TEAM.max, 'off'), true);
  assert.equal(rosterValid(s), false);
  setSlotKind(s, TEAM.max + 3, 'ai');
  assert.equal(rosterValid(s), true);
  assert.equal(setSlotKind(s, 1, 'boss'), false);
});

test('5 на 5 из слотов', () => {
  const s = defaultSlots();
  for (let i = 1; i < TEAM.max * 2; i++) setSlotKind(s, i, 'ai');
  const r = normalizeRoster(slotsToRoster(s));
  assert.equal(r.length, 10);
});

test('места людей: гость садится, пересаживается, уходит; пустое место в бою — ИИ', () => {
  const s = defaultSlots('host', 'Хост');
  setSlotKind(s, 1, 'human'); setSlotKind(s, TEAM.max + 1, 'human');
  assert.equal(openSeats(s), 2);
  const i = freeHumanSlot(s);
  s[i] = { kind: 'human', owner: 'G1', name: 'Гость' };
  assert.equal(setSlotKind(s, i, 'ai'), false, 'занятое место не меняется');
  assert.equal(moveTo(s, 'G1', TEAM.max + 1), true);
  assert.equal(slotOf(s, 'G1'), TEAM.max + 1);
  assert.equal(moveTo(s, 'G1', 0), false, 'на место другого человека не сесть');
  assert.equal(moveTo(s, 'G1', 2), false, 'на пустое место не сесть');
  const r = slotsToRoster(s);
  assert.deepEqual(r.map(x => x.ctrl), ['human', 'ai', 'ai', 'human']);
  vacate(s, 'G1');
  assert.equal(openSeats(s), 2);
  vacate(s, 'host');
  assert.equal(s[0].owner, 'host', 'хост из состава не уходит');
});

test('гость садится на место ИИ — ИИ переходит на его старое место', () => {
  const s = defaultSlots('host');
  s[TEAM.max + 1] = { kind: 'human', owner: 'G1', name: 'Гость' };
  assert.equal(moveTo(s, 'G1', TEAM.max), true);
  assert.equal(s[TEAM.max].owner, 'G1');
  assert.equal(s[TEAM.max + 1].kind, 'ai');
  assert.deepEqual([teamSize(s, 0), teamSize(s, 1)], [1, 2], 'состав команд не изменился');
});

test('переход в другую команду: свободное место, потом место ИИ, потом пустое', () => {
  const s = defaultSlots('host');
  s[TEAM.max + 2] = { kind: 'human', owner: 'G1', name: 'Гость' };
  setSlotKind(s, 3, 'human');
  assert.equal(joinTeam(s, 'G1', 0), true);
  assert.equal(slotOf(s, 'G1'), 3, 'сначала свободное место «Игрок»');
  assert.equal(joinTeam(s, 'G1', 0), false, 'уже в этой команде');
  assert.equal(s[TEAM.max + 2].kind, 'human', 'старое место осталось свободным местом «Игрок»');
  setSlotKind(s, TEAM.max + 2, 'off');
  assert.equal(joinTeam(s, 'G1', 1), true);
  assert.equal(slotOf(s, 'G1'), TEAM.max, 'свободных мест нет — место ИИ');
  assert.equal(s[3].kind, 'ai', 'ИИ занял старое место');
  setSlotKind(s, 3, 'off'); setSlotKind(s, 1, 'off'); setSlotKind(s, 2, 'off'); setSlotKind(s, 4, 'off');
  assert.equal(joinTeam(s, 'G1', 0), true);
  assert.equal(slotTeam(slotOf(s, 'G1')), 0, 'ни мест, ни ИИ — пустое место');
  assert.equal(joinTeam(s, 'G1', 5), false);
});

test('хост меняет местами двух людей и сам переходит в другую команду', () => {
  const s = defaultSlots('host', 'Хост');
  s[TEAM.max] = { kind: 'human', owner: 'G1', name: 'Гость' };
  assert.equal(swapSlots(s, 0, TEAM.max), true);
  assert.equal(slotTeam(slotOf(s, 'host')), 1);
  assert.equal(slotTeam(slotOf(s, 'G1')), 0);
  assert.equal(swapSlots(s, 0, 0), false);
  assert.equal(swapSlots(s, 0, 99), false);
  const r = normalizeRoster(slotsToRoster(s));
  assert.equal(r.find(x => x.owner === 'host').team, 1);
});

test('слоты от хоста проверяются', () => {
  assert.equal(netSlots(null), null);
  assert.equal(netSlots([]), null);
  const s = netSlots(Array(TEAM.max * 2).fill({ kind: 'evil', owner: 'x'.repeat(99), name: 'y'.repeat(99) }));
  assert.equal(s[0].kind, 'off'); assert.equal(s[0].owner.length, 24); assert.equal(s[0].name.length, 16);
});
