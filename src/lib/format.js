import { t } from '../i18n.js';

export const fmtDist = m => t('{x|d}', { x: m });

export const fmtClock = t => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
