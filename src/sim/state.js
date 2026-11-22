// Общее состояние боя. Новый бой заменяет S целиком (newGame в world.js);
// другие модули видят замену через живую привязку импорта.
// Корабли лежат в S.ships, id корабля — его индекс; S.myId — корабль, которым управляет этот компьютер
export let S = null;
export function setState(next) { S = next; }

let sayHook = () => {};
// сообщение экипажу корабля id; на экран попадают только сообщения своему кораблю, гостям сети они уходят в снимке
export const setSayHook = f => { sayHook = f; };
export const sayTo = (id, t) => sayHook(t, id);
// сообщение всем кораблям команды team
export const sayTeam = (team, t) => { for (const s of S.ships) if (s.team === team) sayTo(s.id, t); };

export const shipOf = id => S.ships[id];
export const myShip = () => S.ships[S.myId];
export const enemiesOf = s => S.ships.filter(o => o.team !== s.team);
export const alliesOf = s => S.ships.filter(o => o.team === s.team && o !== s);
export const teamAlive = team => S.ships.some(s => s.team === team && s.alive);
export const teamCount = team => { let a = 0, n = 0; for (const s of S.ships) if (s.team === team) { n++; if (s.alive) a++; } return [a, n]; };

// чьими глазами смотрит человек на корабле s: своими, а после гибели корабля — глазами живого союзника
export const eyeOf = s => s.alive ? s : alliesOf(s).find(o => o.alive) || s;
export const viewShip = () => eyeOf(myShip());

// эффект на карте: вспышка, взрыв, облачко; id нужен, чтобы сеть отдала его каждому гостю один раз
export function addFx(f) { f.id = S.nextId++; f.t0 = S.t; S.fx.push(f); }
