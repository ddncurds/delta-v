// Параметры мира и баланса. Единицы СИ: метры, секунды, м/с, м/с².
export const G0 = 9.81;
export const DT = 0.05;
export const D2R = Math.PI / 180;

// корабль идёт на термоядерном реакторе: тяга не кончается, предел манёвра — перегрузка экипажа
export const SHIP = { maxG: 8, torps: 10, turn: 60 * D2R };
export const TORP = { acc: 400, dv: 3900, blast: 150, fuse: 1500, frags: 80, fragDmg: 4, seeker: 40000, N: 6, vmin: 3500 };
export const FLAK = { n: 70, speed: 1800, life: 40, hitR: 60, kill: 2, charges: 3, recharge: 15, cd: 0.8, recoil: 4, shipR: 100, dmg: 5 };
export const PLUME = { perG: 1500, half: 6 * D2R, base: 15, rate: 25, melt: 100, shipRate: 3 };
export const DETECT = 25000;

// небесные тела: R — радиус, м; G — притяжение у поверхности, в g.
// Планета стоит сбоку от линии между кораблями (X, Y — смещение её центра), луны — на расстоянии moonDist от неё
export const BODY = {
  planetR: [28000, 40000], planetG: [1.0, 1.5], planetX: [-25000, 25000], planetY: [40000, 80000],
  moonR: [6000, 10000], moonG: [0.35, 0.6], moonDist: [80000, 120000],
  looks: { planet: ['terra', 'desert', 'ice', 'gas'], moon: ['rock', 'rock', 'ice'] },
  names: ['Кронос', 'Тефида', 'Гиперион', 'Мимас', 'Феба', 'Рея', 'Япет', 'Диона', 'Церера', 'Паллада'],
};
