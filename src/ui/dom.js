// Ссылки на элементы страницы. Модули грузятся после разбора HTML, поэтому элементы уже есть
export const $ = id => document.getElementById(id);

export const el = {};
['mFuel', 'mbFuel', 'mGrav', 'mbGrav', 'mHp', 'mbHp', 'mG', 'mbG', 'mCrew', 'mbCrew', 'mContact', 'mThreat', 'thr2', 'vThr2', 'dPause',
  'vFuel', 'bFuel', 'vHp', 'bHp', 'vG', 'bG', 'vCrew', 'bCrew', 'vDelay', 'vSpeed', 'vGrav', 'vBody', 'vThr', 'thr', 'vTorp', 'vFlak',
  'vSpread', 'spread', 'vContact', 'vTeams', 'vThreat', 'clock', 'bPause', 'autoSlow', 'overlay'].forEach(i => el[i] = $(i));
