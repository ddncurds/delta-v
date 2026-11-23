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
// манёвр по плану: длительность, с; горизонт прогноза, с
export const BURN = { minDur: 1, maxDur: 60 };
export const PLAN = { T: 240 };

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
