// Указатель над картой (в CSS-пикселях холста) и режим прицеливания облака на сенсорном экране
export const pointer = { x: 0, y: 0, valid: false, aim: false };

export const COARSE = matchMedia('(pointer:coarse)').matches;
