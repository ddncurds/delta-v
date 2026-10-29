// Бой целиком: начальная расстановка, шаг симуляции и итог
import { D2R } from '../config.js';
import { dist } from '../lib/math.js';
import { S, setState, shipOf, other } from './state.js';
import { makeBodies } from './bodies.js';
import { newShip, stepShip } from './ship.js';
import { updateTracks } from './sensors.js';
import { stepTorp, stepPellets, stepPlumes } from './weapons.js';
import { applyDueOrders } from './orders.js';
import { predictPath } from './predict.js';
import { newAi, aiStep } from './ai.js';

// opts.mp: сетевой бой, кораблём foe управляет человек: у него есть экипаж, ИИ нет
// opts.bodies: тела от хоста сетевой игры
export function newGame(opts = {}) {
  // если тела не встают так, чтобы старт был безопасным, перебрасываем и стартовые курсы кораблей
  for (let attempt = 0; attempt < 5; attempt++) {
    placeShips(opts);
    S.bodies = opts.bodies || placeBodies();
    if (S.bodies) break;
  }
  S.bodies = S.bodies || [];
  if (!S.mp) S.foe.ai = newAi();
  S.tracks.me = { pos: [...S.foe.pos], vel: [...S.foe.vel], seenT: 0, exact: true };
  S.tracks.foe = { pos: [...S.me.pos], vel: [...S.me.vel], seenT: 0, exact: true };
}

function placeShips(opts) {
  const y1 = (Math.random() - .5) * 20000, y2 = (Math.random() - .5) * 20000;
  // стартовая скорость: 300–800 м/с, курс отклонён от линии на врага до ±50°
  const rv = () => {
    const sp = 300 + Math.random() * 500;
    const a = (Math.random() * 2 - 1) * 50 * D2R;
    return [Math.cos(a) * sp, Math.sin(a) * sp];
  };
  const v1 = rv(), v2 = rv();
  setState({ t: 0, over: false, result: '', reported: false, mp: !!opts.mp, forfeit: '', nextId: 1, hitLog: [], bodies: [],
    me: newShip(-60000, y1, 0, 'me', true), foe: newShip(60000, y2, Math.PI, 'foe', !!opts.mp),
    torps: [], pellets: [], fx: [], tracks: {}, lastHit: { me: -9, foe: -9 },
    stats: { me: { launched: 0, kills: 0 }, foe: { launched: 0, kills: 0 } } });
  S.me.vel = [v1[0], v1[1]];
  S.foe.vel = [-v2[0], -v2[1]];
}

// тела не должны лежать на старте, пересекаться или стоять на пути кораблей по инерции
// в первые две минуты: игроку нужно время, чтобы заметить угрозу
function placeBodies() {
  for (let k = 0; k < 100; k++) {
    S.bodies = makeBodies();
    const clear = [S.me, S.foe].every(s => S.bodies.every(b => dist(s.pos, b.pos) > b.r + 20000) && !predictPath(s, 120, 1).hit) &&
      S.bodies.every((a, i) => S.bodies.every((b, j) => j <= i || dist(a.pos, b.pos) > a.r + b.r + 10000));
    if (clear) return S.bodies;
  }
  return null;
}

export function step(dt) {
  if (S.over) return;
  S.t += dt;
  if (S.foe.ai) aiStep();
  applyDueOrders('me'); applyDueOrders('foe');
  stepShip(S.me, dt); stepShip(S.foe, dt);
  updateTracks(dt);
  for (const t of S.torps) if (t.alive) stepTorp(t, dt);
  stepPellets(dt);
  stepPlumes(dt);
  S.torps = S.torps.filter(t => t.alive);
  S.fx = S.fx.filter(f => S.t - f.t0 < f.dur);
  for (const s of [S.me, S.foe]) if (s.crew && s.stress >= 100 && s.alive) { s.alive = false; s.deathBy = 'crew'; }
  if (!S.me.alive || !S.foe.alive) { S.over = true; S.result = resultFor('me'); }
}

// причина гибели: [текст для победителя, текст для проигравшего]
const DEATH_TEXT = {
  crew: ['экипаж противника не выдержал перегрузки', 'экипаж не выдержал перегрузки'],
  flak: ['корабль противника разрушен облаком шариков', 'корпус разрушен облаком шариков'],
  plume: ['корабль противника расплавлен выхлопом', 'корабль расплавлен выхлопом противника'],
  frag: ['корабль противника добит осколками торпеды', 'корпус разрушен осколками торпеды'],
  crash: ['корабль противника разбился о поверхность', 'корабль разбился о поверхность'],
  torp: ['корабль противника уничтожен торпедой', 'корабль уничтожен торпедой'],
};

// итог боя глазами стороны key
export function resultFor(key) {
  const a = shipOf(key), b = shipOf(other(key));
  if (S.forfeit) return S.forfeit === key ? 'Поражение: вы покинули бой' : 'Победа: противник покинул бой';
  if (!a.alive && !b.alive) return 'Взаимное уничтожение';
  if (!b.alive) return 'Победа: ' + (DEATH_TEXT[b.deathBy] || DEATH_TEXT.torp)[0];
  return 'Поражение: ' + (DEATH_TEXT[a.deathBy] || DEATH_TEXT.torp)[1];
}
