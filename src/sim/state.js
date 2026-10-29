// Общее состояние боя. Новый бой заменяет S целиком (newGame в world.js);
// другие модули видят замену через живую привязку импорта
export let S = null;
export function setState(next) { S = next; }

let sayHook = () => {};
// сообщение для стороны key ('me' или 'foe'); в одиночной игре сообщения для 'foe' никто не читает
export const setSayHook = f => { sayHook = f; };
export const sayTo = (key, t) => sayHook(t, key);

export const other = k => k === 'me' ? 'foe' : 'me';
export const shipOf = k => k === 'me' ? S.me : S.foe;
