// Стенд ИИ против ИИ без графики (plans/ai.md, этап 0).
//   node scripts/bench.mjs --a new --b baseline --n 1000 --seed 1 [--size 1] [--jobs 6] [--pa '{"dodge":false}'] [--pb '{}']
// --a/--b — политика или уровень ИИ (new, baseline, easy, normal, hard; см. newAi в src/sim/ai.js),
// --pa/--pb — правка параметров ИИ поверх уровня (JSON). Каждое зерно играется дважды со сменой сторон,
// Math.random на время боя подменяется генератором с зерном — бой воспроизводим
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const LIMIT = 1200;   // бой дольше — таймаут

function args(argv) {
  const o = { a: 'new', b: 'baseline', n: 1000, seed: 1, size: 1, jobs: availableParallelism(), pa: '{}', pb: '{}', json: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'json') { o.json = true; continue; }
    if (!(k in o)) throw new Error('неизвестный ключ --' + k);
    o[k] = typeof o[k] === 'number' ? Number(argv[++i]) : argv[++i];
  }
  return o;
}

const mulberry32 = a => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

// пустой итог одной стороны
const side = () => ({ win: 0, loss: 0, draw: 0, timeout: 0, launched: 0, downed: 0, melted: 0, hit: 0, frag: 0, miss: 0, crashed: 0, fizzled: 0,
  flak: 0, plume: 0, dodge: 0, threats: 0, plumeAnswered: 0, fuel: 0, ships: 0, torpsLeft: 0, stepMs: 0,
  dead: { torp: 0, frag: 0, flak: 0, plume: 0, crash: 0, crew: 0 } });

async function worker({ o, seeds }) {
  const { DT } = await import('../src/config.js');
  const sim = await import('../src/sim/index.js');
  const { newAi } = await import('../src/sim/ai.js');
  const { timeToImpact } = await import('../src/sim/sensors.js');
  const pol = [{ name: o.a, p: JSON.parse(o.pa) }, { name: o.b, p: JSON.parse(o.pb) }];
  const res = [side(), side()], durs = [];
  const random = Math.random;
  for (const seed of seeds) {
    for (const swap of [0, 1]) {
      Math.random = mulberry32(seed * 2 + swap + 1);
      // сторона k (A или B) играет за команду team = k ^ swap
      const teamOf = k => k ^ swap, sideOf = team => team ^ swap;
      const roster = [];
      for (const team of [0, 1]) for (let i = 0; i < o.size; i++) roster.push({ team, ctrl: 'ai' });
      let ev = [];
      sim.setSayHook((id, key) => ev.push([id, key]));
      sim.newGame({ roster });
      const S = sim.S;
      for (const s of S.ships) s.ai = newAi(pol[sideOf(s.team)].name, pol[sideOf(s.team)].p);
      const seenB = new Set(), torpSeen = new Map();
      while (!S.over && S.t < LIMIT) {
        const t0 = performance.now();
        sim.step(DT);
        res[0].stepMs += performance.now() - t0;
        for (const p of S.pellets) if (!seenB.has(p.b)) { seenB.add(p.b); res[sideOf(p.team)].flak++; }
        // угроза: торпеда в 2–8 с от корабля. Ответил ли корабль выхлопом, пока она в этом окне
        for (const t of S.torps) {
          for (const s of S.ships) {
            if (!s.alive || s.team === t.team) continue;
            const ttg = timeToImpact(t, s);
            if (ttg === null || ttg > 8 || ttg < 2) continue;
            const k = t.id + ':' + s.id;
            let rec = torpSeen.get(k);
            if (!rec) { rec = { side: sideOf(s.team), plumed: false }; torpSeen.set(k, rec); res[rec.side].threats++; }
            if (!rec.plumed && s.aimAway) { rec.plumed = true; res[rec.side].plumeAnswered++; }
          }
        }
        for (const [id, key] of ev) {
          const r = res[sideOf(S.ships[id].team)];
          if (key === 'msg.torpLaunched') r.launched++;
          else if (key === 'msg.torpDowned') r.downed++;          // id сбил чужую торпеду облаком
          else if (key === 'msg.torpMelted') r.melted++;
          else if (key === 'msg.torpHit') r.hit++;                // id — хозяин попавшей торпеды
          else if (key === 'msg.fragOwn') r.frag++;
          else if (key === 'msg.missOwn') r.miss++;
          else if (key === 'msg.torpCrashed') r.crashed++;
          else if (key === 'msg.dodge') r.dodge++;
          else if (key === 'msg.plume') r.plume++;
        }
        ev = [];
      }
      durs.push(S.t);
      const alive = [0, 1].map(team => sim.teamAlive(team));
      for (const k of [0, 1]) {
        const r = res[k], mine = alive[teamOf(k)], theirs = alive[1 - teamOf(k)];
        if (!S.over) r.timeout++;
        else if (mine && !theirs) r.win++;
        else if (!mine && theirs) r.loss++;
        else r.draw++;
        for (const s of S.ships) if (sideOf(s.team) === k) { r.fuel += s.fuel; r.torpsLeft += s.torps; r.ships++; if (!s.alive) r.dead[s.deathBy] = (r.dead[s.deathBy] || 0) + 1; }
      }
    }
  }
  Math.random = random;
  return { res, durs };
}

// время aiStep относительно step(): тот же бой с ИИ и с ИИ, который ничего не делает
async function aiShare(o) {
  const { DT } = await import('../src/config.js');
  const sim = await import('../src/sim/index.js');
  const ai = await import('../src/sim/ai.js');
  sim.setSayHook(() => {});
  let tAi = 0, tAll = 0;
  for (let seed = 0; seed < 6; seed++) {
    Math.random = mulberry32(1000 + seed);
    const roster = [];
    for (const team of [0, 1]) for (let i = 0; i < o.size; i++) roster.push({ team, ctrl: 'ai' });
    sim.newGame({ roster });
    for (const s of sim.S.ships) s.ai = ai.newAi(o.a, JSON.parse(o.pa));
    while (!sim.S.over && sim.S.t < 300) {
      const t0 = performance.now();
      for (const s of sim.S.ships) if (s.ai && s.alive) ai.aiStep(s);
      tAi += performance.now() - t0;
      // сам шаг уже без ИИ: снимаем ИИ на время шага
      const saved = sim.S.ships.map(s => s.ai);
      for (const s of sim.S.ships) s.ai = null;
      const t1 = performance.now();
      sim.step(DT);
      tAll += performance.now() - t1;
      sim.S.ships.forEach((s, i) => { s.ai = saved[i]; });
    }
  }
  return tAi / (tAi + tAll);
}

const pct = (x, n) => n ? (100 * x / n).toFixed(1) + '%' : '—';
// доверительный интервал Уилсона 95% для доли
function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - w) / d, (c + w) / d];
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; };

async function main() {
  const o = args(process.argv.slice(2));
  const seeds = Array.from({ length: o.n / 2 | 0 }, (_, i) => o.seed + i);   // n боёв = n/2 зёрен × 2 стороны
  const jobs = Math.max(1, Math.min(o.jobs, seeds.length));
  const parts = Array.from({ length: jobs }, (_, j) => seeds.filter((_, i) => i % jobs === j));
  const t0 = Date.now();
  const outs = await Promise.all(parts.map(p => new Promise((ok, fail) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { o, seeds: p } });
    w.once('message', ok); w.once('error', fail);
  })));
  const res = [side(), side()], durs = [];
  for (const out of outs) {
    out.res.forEach((r, k) => { for (const key in r) if (key === 'dead') for (const d in r.dead) res[k].dead[d] = (res[k].dead[d] || 0) + r.dead[d]; else res[k][key] += r[key]; });
    durs.push(...out.durs);
  }
  const share = await aiShare(o);
  const n = durs.length, A = res[0], B = res[1];
  const [lo, hi] = wilson(A.win, n);
  const out = { a: o.a + (o.pa !== '{}' ? ' ' + o.pa : ''), b: o.b + (o.pb !== '{}' ? ' ' + o.pb : ''), n, size: o.size,
    winA: A.win / n, ci: [lo, hi], winB: B.win / n, draw: A.draw / n, timeout: A.timeout / n,
    durMedian: q(durs, .5), durP90: q(durs, .9), aiShare: share, sides: res, sec: (Date.now() - t0) / 1000 };
  if (o.json) { console.log(JSON.stringify(out)); return; }
  console.log(`A = ${out.a}   B = ${out.b}   боёв ${n} (${o.size}×${o.size}), зёрна ${o.seed}…${o.seed + seeds.length - 1}, ${out.sec.toFixed(0)} с`);
  console.log(`победы A ${pct(A.win, n)} [95%: ${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}]   победы B ${pct(B.win, n)}   ничьи ${pct(A.draw, n)}   таймауты ${A.timeout} (${pct(A.timeout, n)})`);
  console.log(`длительность: медиана ${out.durMedian.toFixed(0)} с, 90% ${out.durP90.toFixed(0)} с;  доля aiStep в шаге ${(share * 100).toFixed(1)}%`);
  console.log('                     A        B');
  const row = (name, f) => console.log(name.padEnd(16) + String(f(A)).padStart(9) + String(f(B)).padStart(9));
  row('торпед пущено', r => r.launched);
  row('  попали', r => r.hit);
  row('  осколками', r => r.frag);
  row('  промах', r => r.miss);
  row('  о тело', r => r.crashed);
  row('сбил облаком', r => r.downed);
  row('сжёг выхлопом', r => r.melted);
  row('облако, залпов', r => r.flak);
  row('выхлоп', r => r.plume);
  row('уклонение', r => r.dodge);
  row('угроз 2–8 с', r => r.threats);
  row('  ответ выхлопом', r => pct(r.plumeAnswered, r.threats));
  row('топливо, м/с', r => (r.fuel / r.ships).toFixed(0));
  row('торпед осталось', r => (r.torpsLeft / r.ships).toFixed(1));
  for (const d of Object.keys(A.dead)) row('погиб: ' + d, r => r.dead[d] || 0);
}

process.stdout.on('error', () => {});
if (isMainThread) main();
else worker(workerData).then(r => parentPort.postMessage(r));
