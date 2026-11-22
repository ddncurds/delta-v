// Состав боя на стартовом экране: две колонки по TEAM.max слотов.
// opts.me — кто смотрит (id клиента); editable — можно менять слоты и пересаживать людей (одиночная игра или хост до боя);
// humanAllowed — можно открывать места для людей (только хост); picked — слот человека, которого сейчас пересаживают;
// canSeat — гость выбирает команду и место сам
import { TEAM } from '../config.js';
import { slotTeam, slotOf } from '../roster.js';
import { callsign } from '../sim/world.js';
import { t } from '../i18n.js';

export function renderRoster(box, slots, opts) {
  box.textContent = '';
  const mine = slotOf(slots, opts.me);
  for (const team of [0, 1]) {
    const col = document.createElement('div');
    col.className = 'rteam t' + team;
    const h = document.createElement('h4');
    h.textContent = t('team.' + team);
    // перейти в другую команду: гость просит хоста, в одиночной игре и у хоста — сразу
    if (mine >= 0 && slotTeam(mine) !== team && (opts.canSeat || opts.editable)) {
      const b = button(t('r.join'), () => opts.canSeat ? opts.onTeam(team) : moveSelf(slots, mine, team, opts));
      b.className = 'rjoin';
      h.append(b);
    }
    col.append(h);
    slots.forEach((s, i) => { if (slotTeam(i) === team) col.append(slotRow(s, i, team, opts)); });
    box.append(col);
  }
}

// своя пересадка в команду team без хоста: на место ИИ, свободное место или пустое
function moveSelf(slots, mine, team, opts) {
  const free = slots.map((_, i) => i).filter(i => slotTeam(i) === team && !slots[i].owner);
  const to = free.find(i => slots[i].kind === 'human') ?? free.find(i => slots[i].kind === 'ai') ?? free.find(i => slots[i].kind === 'off');
  if (to === undefined) return;
  opts.onPick(mine); opts.onPlace(to);
}

function button(text, onclick) {
  const b = document.createElement('button');
  b.textContent = text; b.onclick = onclick;
  return b;
}

function slotRow(s, i, team, opts) {
  const { me, editable, humanAllowed, canSeat, picked, onKind, onPick, onPlace, onSeat } = opts;
  const row = document.createElement('div');
  row.className = 'rslot' + (s.kind === 'off' ? ' off' : '') + (i === picked ? ' picked' : '');
  const n = document.createElement('span');
  n.className = 'rnum'; n.textContent = (i % TEAM.max) + 1;
  row.append(n);
  const cs = callsign(team, i);
  const place = editable && picked >= 0 && picked !== i;
  if (s.owner) {
    const b = document.createElement('b');
    b.textContent = s.owner === me ? t('r.you', { name: s.name || t('you') }) : s.name || t('r.player');
    row.append(b);
    if (place) row.append(button(t('r.here'), () => onPlace(i)));
    else if (editable) row.append(button(t(i === picked ? 'r.cancel' : 'r.move'), () => onPick(i)));
    return row;
  }
  if (editable) {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', t('r.slotAria', { team: t('team.' + team), n: (i % TEAM.max) + 1 }));
    for (const k of ['off', 'ai', ...(humanAllowed || s.kind === 'human' ? ['human'] : [])]) {
      const o = document.createElement('option');
      o.value = k; o.textContent = k === 'ai' ? t('r.ai', { name: cs }) : k === 'human' ? t('r.humanFree') : '—';
      sel.append(o);
    }
    sel.value = s.kind;
    sel.onchange = () => onKind(i, sel.value);
    row.append(sel);
    if (place) row.append(button(t('r.here'), () => onPlace(i)));
    return row;
  }
  const lbl = document.createElement('span');
  lbl.textContent = s.kind === 'ai' ? t('r.ai', { name: cs }) : s.kind === 'human' ? t('r.free') : '—';
  row.append(lbl);
  if (canSeat && s.kind !== 'off') row.append(button(t('r.sit'), () => onSeat(i)));
  return row;
}
