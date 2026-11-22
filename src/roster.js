// Слоты состава боя: по TEAM.max в каждой команде. Слот пуст ('off'), занят ИИ ('ai') или открыт для человека ('human').
// owner — кто сидит в слоте человека: id клиента сети ('host' у хоста, 'local' в одиночной игре); пустой — место свободно.
// Место хоста (или игрока в одиночной игре) не закреплено: он, как и гости, может перейти в любую команду
import { TEAM } from './config.js';

export const SLOT_KINDS = ['off', 'ai', 'human'];
export const slotTeam = i => i < TEAM.max ? 0 : 1;

// по умолчанию — дуэль: вы против одного ИИ
export function defaultSlots(owner = 'local', nick = '') {
  const s = Array.from({ length: TEAM.max * 2 }, () => ({ kind: 'off', owner: '', name: '' }));
  s[0] = { kind: 'human', owner, name: nick };
  s[TEAM.max] = { kind: 'ai', owner: '', name: '' };
  return s;
}

export const teamSize = (slots, team) => slots.filter((s, i) => slotTeam(i) === team && s.kind !== 'off').length;
export const rosterValid = slots => teamSize(slots, 0) > 0 && teamSize(slots, 1) > 0;
export const freeHumanSlot = slots => slots.findIndex(s => s.kind === 'human' && !s.owner);
export const openSeats = slots => slots.filter(s => s.kind === 'human' && !s.owner).length;
export const slotOf = (slots, owner) => slots.findIndex(s => s.owner === owner);

// поменять вид слота; слоты, где сидит человек, не меняются
export function setSlotKind(slots, i, kind) {
  if (!SLOT_KINDS.includes(kind) || !slots[i] || slots[i].owner) return false;
  slots[i] = { kind, owner: '', name: '' };
  return true;
}

// поменять слоты a и b местами: так хост пересаживает людей, а человек меняется местом с ИИ.
// Состав команд при этом сохраняется: на старое место человека переходит то, что было в новом
export function swapSlots(slots, a, b) {
  if (a === b || !slots[a] || !slots[b]) return false;
  [slots[a], slots[b]] = [slots[b], slots[a]];
  return true;
}

// человек owner сам садится в слот i: на свободное место «Игрок» или на место ИИ (ИИ переходит на его старое место)
export function moveTo(slots, owner, i) {
  const from = slotOf(slots, owner), s = slots[i];
  if (from < 0 || !s || s.owner || s.kind === 'off') return false;
  return swapSlots(slots, from, i);
}

// человек owner переходит в команду team: на свободное место «Игрок», иначе на место ИИ, иначе на пустое место
export function joinTeam(slots, owner, team) {
  const from = slotOf(slots, owner);
  if (from < 0 || slotTeam(from) === team || (team !== 0 && team !== 1)) return false;
  const mine = slots.map((_, i) => i).filter(i => slotTeam(i) === team && !slots[i].owner);
  const to = mine.find(i => slots[i].kind === 'human') ?? mine.find(i => slots[i].kind === 'ai') ?? mine.find(i => slots[i].kind === 'off');
  return to === undefined ? false : swapSlots(slots, from, to);
}

// гость ушёл: место снова свободно (хост и местный игрок не уходят из состава)
export function vacate(slots, owner) {
  const i = slotOf(slots, owner);
  if (i >= 0 && owner !== 'host' && owner !== 'local') slots[i] = { kind: 'human', owner: '', name: '' };
}

// состав для newGame: незанятые места людей отдаются ИИ
export function slotsToRoster(slots) {
  return slots.flatMap((s, i) => s.kind === 'off' ? [] : [{
    team: slotTeam(i), ctrl: s.kind === 'human' && s.owner ? 'human' : 'ai', owner: s.kind === 'human' ? s.owner : '',
    name: s.kind === 'human' && s.owner ? s.name : '' }]);
}

// слоты от хоста: проверяем форму и обрезаем строки
export function netSlots(a) {
  if (!Array.isArray(a) || a.length !== TEAM.max * 2) return null;
  return a.map(s => ({ kind: SLOT_KINDS.includes(s?.kind) ? s.kind : 'off', owner: String(s?.owner || '').slice(0, 24), name: String(s?.name || '').slice(0, 16) }));
}
