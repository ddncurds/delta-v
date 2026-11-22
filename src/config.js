// Параметры мира и баланса. Единицы СИ: метры, секунды, м/с, м/с².
export const G0 = 9.81;
export const DT = 0.05;
export const D2R = Math.PI / 180;

// запас топлива корабля задан как Δv, м/с: пока двигатель тянет, он тратится; кончился — тяги нет
export const SHIP = { maxG: 8, dv: 9000, torps: 10, turn: 60 * D2R };
export const TORP = { acc: 400, dv: 3900, blast: 150, fuse: 1500, frags: 80, fragDmg: 4, seeker: 40000, N: 6, vmin: 3500 };
export const FLAK = { n: 70, speed: 1800, life: 40, hitR: 60, kill: 2, charges: 3, recharge: 15, cd: 0.8, mass: 15, recoil: 4, shipR: 100, dmg: 5 };
export const PLUME = { perG: 1500, half: 6 * D2R, base: 15, rate: 25, melt: 100, shipRate: 3 };
export const DETECT = 25000;

// команды: 0 — синие, 1 — красные; в каждой от 1 до TEAM.max кораблей.
// spread — расстояние между кораблями строя на старте, м. Названия команд и позывные ИИ — в словарях src/i18n
export const TEAM = { max: 5, spread: 7000 };

// небесные тела: R — радиус, м; G — притяжение у поверхности, в g.
// Планета стоит сбоку от линии между кораблями (X, Y — смещение её центра), луны — на расстоянии moonDist от неё.
// Имена тел — в словарях src/i18n (ключ bodies)
export const BODY = {
  planetR: [28000, 40000], planetG: [1.0, 1.5], planetX: [-25000, 25000], planetY: [40000, 80000],
  moonR: [6000, 10000], moonG: [0.35, 0.6], moonDist: [80000, 120000],
  looks: { planet: ['terra', 'desert', 'ice', 'gas'], moon: ['rock', 'rock', 'ice'] },
};

// Взрывы и осколки (plans/delta-v-explosions-tz.md). energy — масштаб взрыва: 0,2 — попадание по корпусу,
// 1 — обычная гибель корабля, 2 — взрыв реактора. Скорость осколка v0 = vMin·e^(rand·k)·√energy, м/с: большинство
// проходит сотни метров, единицы улетают на километры. Частица пропадает дальше simRadius от центра взрыва или при столкновении.
// Опасные обломки (масса ≥ debris.bigMass) считает симуляция, у хоста и гостя они строятся одинаково по seed;
// искры, газ и мелкие обломки — только рендер. Время жизни газа и искр — реальные секунды, движение — игровые
export const FX_CONFIG = {
  simRadius: 20000, vMin: 40, k: 3.2,
  // energy по причине гибели корабля; torp — плюс доля оставшегося топлива (рвутся баки и реактор)
  energy: { torp: 1, crash: 1.5, crew: 0.6, ship: 1, burst: 0.3, frag: 0.45, hit: 0.2 },
  // обломки корпуса: число n0 + nPerE·energy; масса корпуса и доля, ставшая обломками, кг; урон = ½·m·v² / jPerHp
  debris: { n0: 6, nPerE: 10, spin: 6, hullMass: 40000, frac: 0.35, bigMass: 600, hitR: 30, jPerHp: 7e5, dmgMax: 60 },
  shipR: 25,                                                      // радиус корабля для размера вспышки, м
  maxParts: 3000,                                                 // лимит искр: сверх него пропадают самые старые
  quality: { low: 0.35, medium: 0.65, high: 1 },                  // множитель числа частиц по качеству эффектов
  flash: { life: [0.04, 0.08], r: 3, minPx: 26 },
  fireball: { n: [10, 30], life: [0.4, 0.8], r: 60, minPx: 18 },
  shock: { life: [0.3, 0.5], alpha: 0.25, r: 700, minPx: 70 },
  sparks: { n: [40, 100], life: [1, 4], vMul: 1.3, tail: [0.03, 0.15] },
  debrisFx: { cool: [3, 7], max: 600 },
  secondary: { n: [1, 4], delay: [0.05, 0.3], life: 0.12 },
  hitStop: { minE: 0.8, dur: [0.05, 0.08] },
  shake: { amp: 6, max: 9, px: 400 },
  light: { r: 1500, life: 0.5 },
  sound: { vol: 0.6 },
};
