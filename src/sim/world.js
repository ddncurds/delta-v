// Бой целиком: состав команд, начальная расстановка, шаг симуляции и итог
import { D2R, TEAM } from '../config.js';
import { dist } from '../lib/math.js';
import { S, setState, sayTo, teamAlive, enemiesOf } from './state.js';
import { makeBodies } from './bodies.js';
import { t, tm } from '../i18n.js';
import { newShip, stepShip } from './ship.js';
import { initTracks, updateTracks, pickTarget } from './sensors.js';
import { stepTorp, stepPellets, stepPlumes } from './weapons.js';
import { applyDueOrders } from './orders.js';
import { predictPath } from './predict.js';
import { newAi, aiStep } from './ai.js';

// состав по умолчанию — дуэль: игрок против ИИ
export const DUEL = [{ team: 0, ctrl: 'human' }, { team: 1, ctrl: 'ai' }];

// позывной ИИ по команде и номеру места
export const callsign = (team, i) => t('cs.' + team).split(',')[i % TEAM.max];

// состав боя: корабли команды 0, затем команды 1; не больше TEAM.max в команде, в каждой хотя бы один.
// Безымянным кораблям — позывной по номеру в команде
export function normalizeRoster(list) {
  const out = [];
  for (const team of [0, 1]) {
    const mine = list.filter(r => r && r.team === team).slice(0, TEAM.max);
    if (!mine.length) throw new Error(t('err.noShips', { team: t('team.' + team) }));
    // безымянный корабль человека — «Вы», ИИ — позывной
    mine.forEach((r, i) => out.push({ team, ctrl: r.ctrl === 'human' ? 'human' : 'ai',
      name: String(r.name || (r.ctrl === 'human' ? t('you') : callsign(team, i))).slice(0, 16), owner: r.owner ? String(r.owner) : '' }));
  }
  return out.map((r, id) => ({ ...r, id }));
}

// opts.roster: состав (по умолчанию DUEL); opts.myId: корабль этого компьютера (по умолчанию первый корабль человека);
// opts.mp: сетевой бой; opts.guest: гость сети — симуляцию ведёт хост, ИИ здесь не нужен; opts.bodies: тела от хоста
export function newGame(opts = {}) {
  const roster = normalizeRoster(opts.roster || DUEL);
  // если тела не встают так, чтобы старт был безопасным, перебрасываем и стартовые курсы кораблей
  for (let attempt = 0; attempt < 5; attempt++) {
    placeShips(roster, opts);
    S.bodies = opts.bodies || placeBodies();
    if (S.bodies) break;
  }
  S.bodies = S.bodies || [];
  for (const s of S.ships) if (s.ctrl === 'ai' && !opts.guest) s.ai = newAi();
  initTracks();
  for (const s of S.ships) s.targetId = pickTarget(s);
}

function placeShips(roster, opts) {
  // у каждой команды общий курс и скорость строя: 300–800 м/с, курс отклонён от линии на врага до ±50°
  const teamVel = () => {
    const sp = 300 + Math.random() * 500, a = (Math.random() * 2 - 1) * 50 * D2R;
    return [Math.cos(a) * sp, Math.sin(a) * sp];
  };
  const tv = [teamVel(), teamVel().map(v => -v)], ty = [0, 1].map(() => (Math.random() - .5) * 20000);
  const ships = roster.map(r => {
    const mates = roster.filter(o => o.team === r.team), i = mates.indexOf(r);
    const y = ty[r.team] + (i - (mates.length - 1) / 2) * TEAM.spread + (Math.random() - .5) * 1500;
    const x = (r.team ? 60000 : -60000) + (Math.random() - .5) * 4000;
    const s = newShip(x, y, r.team ? Math.PI : 0, r);
    s.vel = [tv[r.team][0] + (Math.random() - .5) * 60, tv[r.team][1] + (Math.random() - .5) * 60];
    return s;
  });
  const myId = opts.myId ?? Math.max(0, ships.findIndex(s => s.ctrl === 'human'));
  setState({ t: 0, over: false, result: '', resultKey: null, reported: false, mp: !!opts.mp, forfeit: false, abort: '', nextId: 1,
    hitLog: [], hitSeq: 0, bodies: [], ships, myId, torps: [], pellets: [], fx: [], tracks: [],
    lastHit: ships.map(() => -9), stats: ships.map(() => ({ launched: 0, kills: 0 })) });
}

// тела не должны лежать на старте, пересекаться или стоять на пути кораблей по инерции
// в первые две минуты: игроку нужно время, чтобы заметить угрозу
function placeBodies() {
  for (let k = 0; k < 100; k++) {
    S.bodies = makeBodies();
    const clear = S.ships.every(s => S.bodies.every(b => dist(s.pos, b.pos) > b.r + 20000) && !predictPath(s, 120, 1).hit) &&
      S.bodies.every((a, i) => S.bodies.every((b, j) => j <= i || dist(a.pos, b.pos) > a.r + b.r + 10000));
    if (clear) return S.bodies;
  }
  return null;
}

export function step(dt) {
  if (S.over) return;
  S.t += dt;
  for (const s of S.ships) if (s.ai && s.alive) aiStep(s);
  for (const s of S.ships) applyDueOrders(s);
  for (const s of S.ships) stepShip(s, dt);
  updateTracks(dt);
  for (const t of S.torps) if (t.alive) stepTorp(t, dt);
  stepPellets(dt);
  stepPlumes(dt);
  S.torps = S.torps.filter(t => t.alive);
  S.fx = S.fx.filter(f => S.t - f.t0 < f.dur);
  for (const s of S.ships) if (s.crew && s.stress >= 100 && s.alive) { s.alive = false; s.deathBy = 'crew'; }
  // цель погибла — штурман берёт ближайшую
  for (const s of S.ships) {
    if (!s.alive || S.ships[s.targetId]?.alive) continue;
    s.targetId = pickTarget(s);
    if (s.targetId >= 0) sayTo(s.id, 'msg.newTarget', { name: S.ships[s.targetId].name });
  }
  if (!teamAlive(0) || !teamAlive(1)) endBattle();
}

// бой окончен: итог своего корабля — ключом (для сети и смены языка) и текстом на текущем языке
export function endBattle(key = resultOf(S.myId)) {
  S.over = true; S.resultKey = key; S.result = tm(key);
}

const DEATHS = ['crew', 'flak', 'plume', 'frag', 'crash', 'torp'];
const why = s => DEATHS.includes(s.deathBy) ? s.deathBy : 'torp';

// итог боя глазами корабля id — ключ словаря и параметры. В дуэли — причина гибели, в командном бою — чья команда уцелела
export function resultOf(id) {
  const s = S.ships[id];
  if (S.abort) return ['res.abort'];
  if (S.forfeit === id) return ['res.forfeit'];
  const mine = teamAlive(s.team), theirs = teamAlive(1 - s.team);
  if (!mine && !theirs) return ['res.draw'];
  if (S.ships.length === 2) {
    if (!theirs) return ['res.win.' + why(enemiesOf(s)[0])];
    if (!mine) return ['res.loss.' + why(s)];
    return null;
  }
  if (!theirs) return [s.alive ? 'res.win.team' : 'res.win.teamDead'];
  if (!mine) return ['res.loss.team'];
  return null;
}

// итог текстом на текущем языке
export const resultFor = id => tm(resultOf(id));
