// Симуляция боя: чистая логика без DOM. Её можно запускать в Node — см. tests/
export { S, setSayHook, sayTo, shipOf, myShip, viewShip, eyeOf, enemiesOf, alliesOf, teamAlive, teamCount } from './state.js';
export { gravAt, bodyHit, mainBody, surfaceG, fly } from './bodies.js';
export { nearestThreat, timeToImpact, targetTrack, pickTarget } from './sensors.js';
export { reactionDelay } from './ship.js';
export { issue, setTarget, ORDER_TYPES, ORDER_VAL } from './orders.js';
export { predictPath, impactIn } from './predict.js';
export { newGame, normalizeRoster, step, resultFor, DUEL } from './world.js';
export { newAi } from './ai.js';
