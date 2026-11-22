// ИИ кораблей: противники в одиночной игре, ведомые и пустые слоты сетевого боя.
// ИИ знает только то, что видит его корабль: цель выбирает и атакует по своему треку
import { D2R, FLAK, SHIP, G0 } from '../config.js';
import { dist, solveIntercept, wrap } from '../lib/math.js';
import { S } from './state.js';
import { startBurn, doDodge, doPlume, awayAngle } from './ship.js';
import { fireFlak, launchTorp } from './weapons.js';
import { nearestThreat, targetTrack, pickTarget, flakLeft } from './sensors.js';
import { impactIn } from './predict.js';
import * as baseline from './ai-baseline.js';

// параметры ИИ: окна реакции по времени до попадания ttg, с; дальности, м; топливо, м/с; разброс, градусы
export const AI = {
  plumeTtg: [2, 8], plumeP: 1, plumeFuel: 250,   // выхлоп по торпеде: окно ttg, вероятность, минимум топлива
  plumeMargin: 0.5,                               // выхлоп, только если корабль успеет повернуться кормой к торпеде с этим запасом, с
  preAimTtg: 0,                                   // заранее поворачиваться кормой к торпеде без тяги при ttg меньше этого (0 — нет)
  dodge: false, dodgeTtg: [8, 17],                // уклонение (только раньше окна выхлопа): тратит топливо и уводит на тела
  flakTtg: [5, 28], flakR: 34000, flakEvery: 3.5, flakJit: 1.5,   // облако по торпеде
  shipFlakR: 30000, shipFlakEvery: 4, shipFlakJit: 2, shipFlakMin: 2,   // облако по кораблю: дальность, интервал, разброс, сколько зарядов держать
  nudgeFuel: 700,                                 // ниже этого запаса дистанцию не подправляем
  nudge: false,                                   // старое подруливание: держать 70–130 км, в середине смещаться вбок
  close: true, rangeMax: 100000, closeV: 1000,    // сближение: дальше rangeMax выйти на скорость сближения closeV, м/с
  openMax: 150, manG: 3, manEvery: 8,             // …и если расходимся быстрее openMax; тяга, g; проверка раз в manEvery, с
  knife: true, knifeRange: 15000, knifeV: 300,   // торпеды кончились — сближаемся до knifeRange и бьём облаком по кораблю
  // нападение
  firstSalvo: [12, 27], salvoEvery: [40, 65],     // первый залп и пауза между залпами, с
  salvoN: 4, salvoGap: 0.5, salvoRange: 180000,  // торпед в залпе, пауза между пусками, с; дальность, м
  salvoFlakMax: 3,                                // залп — когда у врага, по нашей оценке, не больше стольких зарядов облака
  salvoExact: false,                              // залп — по точному треку: дальше головки торпеда наводится по треку
  bait: false,                                    // нет условий для залпа — одна торпеда-приманка вытягивает облако врага
  salvoWait: 25,                                  // дольше ждать условий нельзя — залп как есть, с
  salvoEarly: 0,                                  // у врага мало зарядов — залп раньше срока на столько секунд
  leadLaunch: false,                              // начальный курс торпеды — в точку перехвата
};

// эталоны для стенда: параметры, при которых текущий ИИ ведёт себя как после этапа 1 (plans/ai.md)
export const PRESETS = {
  stage1: { dodge: true, nudge: true, close: false, knife: false, salvoN: 2, salvoGap: 3.5 },
};

// policy — какой ИИ ведёт корабль: 'baseline' — замороженная версия (ai-baseline.js), имя из PRESETS или текущий ИИ;
// p — правка параметров AI.
// Таймеры разнесены случайно, чтобы корабли одной команды не действовали синхронно
export function newAi(policy = 'new', p = {}) {
  if (policy === 'baseline') return baseline.newAi();
  const P = { ...AI, ...PRESETS[policy], ...p };
  return { policy, p: P, nextSalvo: rnd(P.firstSalvo), salvoLeft: 0, salvoAt: 0, forceAt: Infinity, baited: false,
    nextNudge: 4 + Math.random() * 6, nextMan: 0, nextFlak: 0, nextGeo: Math.random(), nextRetarget: 8 + Math.random() * 6, plumeTorp: null };
}

const rnd = ([a, b]) => a + Math.random() * (b - a);
const jitter = deg => (Math.random() * 2 - 1) * deg * D2R;
const inWin = (x, [a, b]) => x > a && x < b;

export function aiStep(f) {
  const ai = f.ai;
  if (ai.policy === 'baseline') return baseline.aiStep(f);
  if (!f.alive) return;
  const P = ai.p;
  if (S.t >= ai.nextRetarget || !targetTrack(f)) { f.targetId = pickTarget(f); ai.nextRetarget = S.t + 10 + Math.random() * 5; }
  if (avoidBodies(f, ai)) return;
  const th = nearestThreat(f), tr = targetTrack(f);
  if (th) defend(f, ai, P, th);
  if (!tr) return;
  const knife = P.knife && f.torps === 0;
  if ((!th || th.ttg > 40) && tr.exact && f.flak >= (knife ? 1 : P.shipFlakMin) && f.flakCd <= 0 && S.t >= ai.nextFlak && dist(tr.pos, f.pos) < P.shipFlakR) {
    fireFlak(f, solveIntercept(f.pos, f.vel, tr.pos, tr.vel, FLAK.speed) + jitter(P.shipFlakJit)); ai.nextFlak = S.t + P.shipFlakEvery;
  }
  attack(f, ai, P, tr);
  if (knife) closeIn(f, ai, { ...P, rangeMax: P.knifeRange, closeV: P.knifeV, nudgeFuel: P.plumeFuel }, tr, th);
  else if (P.close) closeIn(f, ai, P, tr, th);
  // держит дистанцию 70–130 км, в середине — смещается вбок
  if (P.nudge && !knife && f.burnEnd < 0 && S.t >= ai.nextNudge && f.fuel > P.nudgeFuel && (!th || th.ttg > 30)) {
    const d = dist(tr.pos, f.pos), base = Math.atan2(tr.pos[1] - f.pos[1], tr.pos[0] - f.pos[0]);
    if (d > 130000) startBurn(f, base, 2, 8);
    else if (d < 70000) startBurn(f, base + Math.PI, 2, 8);
    else startBurn(f, base + (Math.random() < .5 ? 1 : -1) * Math.PI / 2, 1.5, 5);
    ai.nextNudge = S.t + 30 + Math.random() * 20;
  }
}

// залп из нескольких торпед почти разом: облако врага не успевает сбить всё.
// Ждём, пока у врага останется мало зарядов (приманка вытягивает их) и трек будет точным, но не дольше salvoWait
function attack(f, ai, P, tr) {
  if (ai.salvoLeft > 0) {
    if (S.t < ai.salvoAt) return;
    if (fire(f, P, tr)) { ai.salvoLeft--; ai.salvoAt = S.t + P.salvoGap; } else ai.salvoLeft = 0;
    return;
  }
  if (S.t < ai.nextSalvo - P.salvoEarly || f.torps <= 0 || dist(tr.pos, f.pos) > P.salvoRange) return;
  const low = flakLeft(tr) <= P.salvoFlakMax;
  if (S.t < ai.nextSalvo && !low) return;
  const ready = low && (tr.exact || !P.salvoExact);
  if (ready || S.t >= ai.forceAt) {
    ai.salvoLeft = Math.min(P.salvoN, f.torps); ai.salvoAt = S.t;
    ai.nextSalvo = S.t + rnd(P.salvoEvery); ai.forceAt = Infinity; ai.baited = false;
    return;
  }
  if (ai.forceAt === Infinity) ai.forceAt = S.t + P.salvoWait;
  if (P.bait && !ai.baited && tr.exact && f.torps > P.salvoN) { ai.baited = true; fire(f, P, tr); }
}

// сближение по треку: враг далеко или уходит — гасим относительную скорость и выходим на сближение со скоростью closeV
function closeIn(f, ai, P, tr, th) {
  if (f.burnEnd >= 0 || S.t < ai.nextMan || f.fuel < P.nudgeFuel || (th && th.ttg < 30)) return;
  ai.nextMan = S.t + P.manEvery;
  const rx = tr.pos[0] - f.pos[0], ry = tr.pos[1] - f.pos[1], d = Math.hypot(rx, ry) || 1, ux = rx / d, uy = ry / d;
  const wx = tr.vel[0] - f.vel[0], wy = tr.vel[1] - f.vel[1], open = wx * ux + wy * uy;
  // уже сближаемся достаточно быстро — не мешаем; близко и не расходимся быстро — тоже
  if (-open >= P.closeV * 0.8 || (d < P.rangeMax && open < P.openMax)) return;
  // нужная относительная скорость — сближение closeV по линии; приращение своей скорости dv = w − w'
  const dx = wx + ux * P.closeV, dy = wy + uy * P.closeV, dv = Math.min(Math.hypot(dx, dy), f.fuel - P.nudgeFuel);
  if (dv < 50) return;
  startBurn(f, Math.atan2(dy, dx), P.manG, dv / (P.manG * G0));
}

// пуск торпеды: прямо на цель или в точку перехвата
function fire(f, P, tr) {
  return launchTorp(f, P.leadLaunch ? solveIntercept(f.pos, f.vel, tr.pos, tr.vel, 1500) : undefined);
}

// защита от ближайшей торпеды th: облако, выхлоп, уклонение
function defend(f, ai, P, th) {
  // облако — только по сближающейся торпеде в окне ttg: заряды берегутся
  if (inWin(th.ttg, P.flakTtg) && dist(th.t.pos, f.pos) < P.flakR && f.flak > 0 && f.flakCd <= 0 && S.t >= ai.nextFlak) {
    fireFlak(f, solveIntercept(f.pos, f.vel, th.t.pos, th.t.vel, FLAK.speed) + jitter(P.flakJit)); ai.nextFlak = S.t + P.flakEvery;
  }
  // выхлоп раньше уклонения: боковым рывком от торпеды не уйти, а факел её плавит.
  // Решение принимается один раз на торпеду; идущий выхлоп ничто не прерывает.
  // Не успеваем повернуться кормой к торпеде — топливо не тратим
  if (inWin(th.ttg, P.plumeTtg) && f.burnEnd < 0 && f.fuel > P.plumeFuel && ai.plumeTorp !== th.t) {
    ai.plumeTorp = th.t;
    const turnT = Math.abs(wrap(awayAngle(f) - f.heading)) / SHIP.turn;
    if (turnT < th.ttg - P.plumeMargin && Math.random() < P.plumeP) doPlume(f);
  }
  if (P.dodge && th.ttg < P.dodgeTtg[1] && th.ttg >= P.dodgeTtg[0] && f.burnEnd < 0 && f.fuel > P.plumeFuel) doDodge(f);
  // корма к торпеде заранее, без тяги: выхлоп потом сработает сразу
  else if (th.ttg < P.preAimTtg && f.burnEnd < 0) f.cmdHeading = awayAngle(f);
}

// раз в секунду проверяем, не врежемся ли в тело; если да — отворачиваем вбок от скорости и вверх от поверхности
function avoidBodies(f, ai) {
  if (S.t < ai.nextGeo) return false;
  ai.nextGeo = S.t + 1;
  const imp = impactIn(f, 90);
  if (!imp || (f.burnEnd >= 0 && imp.hitT >= 15)) return false;
  const b = imp.hit, rx = f.pos[0] - b.pos[0], ry = f.pos[1] - b.pos[1], rr = Math.hypot(rx, ry) || 1;
  let px = -f.vel[1], py = f.vel[0];
  if (px * rx + py * ry < 0) { px = -px; py = -py; }
  const pn = Math.hypot(px, py) || 1;
  startBurn(f, Math.atan2(py / pn + ry / rr * 0.6, px / pn + rx / rr * 0.6), imp.hitT < 30 ? 4 : 2, 6);
  return true;
}
