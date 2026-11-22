// Часы рендера в реальных секундах. real идёт всегда (пульсы, мерцание огней),
// fx — только когда игра не на паузе: по нему живут и замирают эффекты
export const clock = { real: 0, fx: 0, dt: 0 };

export function tickClock(dtReal, paused) {
  clock.dt = dtReal;
  clock.real += dtReal;
  if (!paused) clock.fx += dtReal;
}

// пульс 0…1 с периодом period секунд реального времени
export const pulse = period => 0.5 - 0.5 * Math.cos(clock.real * 2 * Math.PI / period);

// prefers-reduced-motion: запрос создаётся лениво, чтобы модуль импортировался и в Node
let mq;
export function reducedMotion() {
  if (mq === undefined) {
    try { mq = globalThis.matchMedia ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (_) { mq = null; }
  }
  return !!mq?.matches;
}
