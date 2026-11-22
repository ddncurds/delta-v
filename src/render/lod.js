// Ступени детализации корабля: на мелком масштабе — силуэт не короче ICON_MIN_PX,
// с того же размера — подробная модель. Чистые функции, без холста
import { shipLength } from './ship-models.js';

export const ICON_MIN_PX = 26;          // корабль игрока (46 м) не короче этого на экране
export const MODEL_MIN_PX = ICON_MIN_PX; // с этой длины корпуса рисуется подробная модель
const FADE = 0.25;                       // доля порога, за которую силуэт перетекает в модель

// минимальная длина силуэта стороны: фрегат (55 м) крупнее корвета (46 м) в той же пропорции
export const iconMin = team => ICON_MIN_PX * shipLength({ team }) / shipLength({ team: 0 });

// длина корабля на экране, px: Lp — настоящая длина корпуса в пикселях
export const iconLen = (Lp, team = 0) => Math.max(Lp, iconMin(team));

// доля подробной модели 0…1: ниже порога — 0, затем плавно до 1
export function modelMix(Lp, team = 0) {
  const m = iconMin(team);
  return Lp < m ? 0 : Math.min(1, (Lp - m) / (m * FADE));
}
