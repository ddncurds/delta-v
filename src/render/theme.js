// Палитра тактической карты: сцена всегда тёмная, независимо от темы страницы
export const FONT = '"Barlow Semi Condensed","Arial Narrow",system-ui,sans-serif';

export const C = {
  paper: '#0a1119', ink: '#e2e9ee', ink2: '#8fa1ae', line: '#2a3a46', grid: '#15212b',
  me: '#5da4ff', ally: '#9fd0ff', foe: '#ff7a5c', warn: '#e6b53c', flak: '#b79dff', plume: '#ffa63a',
  // свечение: белое ядро вспышки, тлеющее облако взрыва, облачко залпа, угроза, поле тяжести, кромка безатмосферных тел
  white: '#ffffff', ember: '#ff8a4a', puff: '#a99ac8', threat: '#ff3b30', field: '#7f93a8', rim: '#dfe8f0',
};

// температурная шкала взрыва от горячего к остывшему: белый → жёлтый → оранжевый → тёмно-красный → тёмно-серый.
// Газ к концу шкалы ещё и становится прозрачным, обломки остаются тёмно-серыми. ash — остывшие искры, shock — ударная волна
export const FIRE = [[1, '#ffffff'], [0.8, '#ffe27a'], [0.55, '#ff8a3a'], [0.3, '#8a1f12'], [0, '#3a3f45']];
export const FX_COL = { ash: '#4a525a', shock: '#d6e6ff', flash: '#ffffff', light: '#ffe2b8' };

// ореол атмосферы планет по виду поверхности
export const ATMO = { terra: '#6aa8ff', desert: '#ffb27a', gas: '#ffd7a3' };

// обшивка кораблей
export const HULL = { light: '#c3ccd3', mid: '#7d8892', dark: '#3e4851', seam: '#262f37', engine: '#161c22', glass: '#ffdf9a' };

// направление на солнце в экранных координатах (y вниз): свет падает слева сверху
export const LIGHT = [-0.6, -0.8];
