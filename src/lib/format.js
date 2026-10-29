export const fmtDist = m => m >= 1000 ? (Math.round(m / 10) / 100) + ' км' : Math.round(m) + ' м';

export const fmtClock = t => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
