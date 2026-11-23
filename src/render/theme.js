// Палитра тактической карты: сцена всегда тёмная, независимо от темы страницы
export const FONT = '"Barlow Semi Condensed","Arial Narrow",system-ui,sans-serif';

export const C = {
  paper: '#0a1119', ink: '#e2e9ee', ink2: '#8fa1ae', line: '#24333f', grid: '#101b25',
  // свой корабль — холодный голубой, противник — коралловый, предупреждения — янтарный, план манёвра — бирюзовый
  me: '#75c9f3', ally: '#9fd0ff', foe: '#ff7a5c', warn: '#f0b43c', flak: '#b79dff', plume: '#ffa63a', plan: '#5fe0ee',
  // свечение: белое ядро вспышки, тлеющее облако взрыва, облачко залпа, угроза, поле тяжести, кромка безатмосферных тел
  white: '#ffffff', ember: '#ff8a4a', puff: '#a99ac8', threat: '#ff3b30', field: '#7f93a8', rim: '#dfe8f0',
};

// ореол атмосферы планет по виду поверхности
export const ATMO = { terra: '#6aa8ff', desert: '#ffb27a', gas: '#ffd7a3' };

// обшивка кораблей
export const HULL = { light: '#c3ccd3', mid: '#7d8892', dark: '#3e4851', seam: '#262f37', engine: '#161c22', glass: '#ffdf9a' };

// направление на солнце в экранных координатах (y вниз): свет падает слева сверху
export const LIGHT = [-0.6, -0.8];
