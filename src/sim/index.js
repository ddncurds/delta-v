// Симуляция боя: чистая логика без DOM. Её можно запускать в Node — см. tests/
export { S, setSayHook, sayTo, other, shipOf } from './state.js';
export { gravAt, bodyHit, mainBody, surfaceG, fly } from './bodies.js';
export { nearestThreat, timeToImpact } from './sensors.js';
export { reactionDelay } from './ship.js';
export { issue, ORDER_TYPES, ORDER_VAL } from './orders.js';
export { predictPath, impactIn } from './predict.js';
export { newGame, step, resultFor } from './world.js';
