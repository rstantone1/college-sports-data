// Model research CLI.
//   export: pull seasons from the database into a data pack file (gzipped JSON).
//     npx tsx src/tune.ts export --sport=mbb --from=2012 --to=2026 --out=packs/mbb.json.gz
//   test:   walk-forward backtest of one setting over a pack, scored per season and on train/test splits.
//     npx tsx src/tune.ts test --pack=packs/mbb.json.gz --train=2013-2021 --test=2022-2026 [--priorGames=6 --regress=0.5 ...]
//   tune:   search settings on the training seasons only, then report how the winner does on the test seasons.
//     npx tsx src/tune.ts tune --pack=packs/mbb.json.gz --train=2013-2021 --test=2022-2026
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DEFAULT_PARAMS, type Params, type SportModel } from './model/engine.js';
import { walkForward, score, fitSd, type Pred, type SeasonResult } from './model/backtest.js';
import type { SeasonData } from './model/pack.js';

const args = Object.fromEntries(process.argv.slice(3).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const cmd = process.argv[2];

interface Pack { sport: string; model: SportModel; seasons: SeasonData[] }
const range = (s: string) => { const [a, b] = s.split('-').map(Number); return (y: number) => y >= a && y <= (b ?? a); };
const pct = (x: number) => (x * 100).toFixed(1) + '%';
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');

async function exportPack() {
  const { SPORTS } = await import('./sports.js');
  const { loadSeason, sportModel } = await import('./model/pack.js');
  const { close } = await import('./db.js');
  const s = SPORTS[args.sport];
  const seasons: SeasonData[] = [];
  for (let y = Number(args.from); y <= Number(args.to); y++) {
    const d = await loadSeason(s, y);
    console.log(`${s.id} ${y}: ${d.games.length} games (${d.games.filter((g) => g.d1).length} D-I vs D-I), ${d.members.length} members, ${d.games.filter((g) => g.sp != null).length} with a line`);
    if (d.games.length) seasons.push(d);
  }
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, gzipSync(JSON.stringify({ sport: s.id, model: sportModel(s), seasons } satisfies Pack)));
  console.log(`wrote ${args.out}`);
  await close();
}

const load = (file: string): Pack => JSON.parse(gunzipSync(readFileSync(file)).toString());
const paramsFromArgs = (base: Params): Params => {
  const p = { ...base };
  for (const k of Object.keys(DEFAULT_PARAMS) as (keyof Params)[]) if (args[k] != null) p[k] = args[k] === 'inf' ? Infinity : Number(args[k]);
  return p;
};

function evaluate(pack: Pack, p: Params, isTrain: (y: number) => boolean, isTest: (y: number) => boolean) {
  const res = walkForward(pack.model, pack.seasons, p);
  const train = res.filter((r) => isTrain(r.season)).flatMap((r) => r.preds);
  const test = res.filter((r) => isTest(r.season)).flatMap((r) => r.preds);
  const sd = fitSd(train);
  return { res, sd, train: score(train, sd), test: score(test, sd) };
}

function printScore(label: string, s: ReturnType<typeof score>) {
  console.log(`${label.padEnd(8)} ${String(s.n).padStart(6)} games  winner ${pct(s.acc)}  margin miss ${f(s.mae)}  rmse ${f(s.rmse)}  bias ${f(s.bias)}  log loss ${f(s.logloss, 4)}`);
  if (s.market) console.log(`${''.padEnd(8)} vs market on ${s.market.n}: winner ${pct(s.market.modelAcc)} vs ${pct(s.market.marketAcc)}, margin miss ${f(s.market.modelMae)} vs ${f(s.market.marketMae)}, gap ${f(s.market.gap)}, against the spread ${pct(s.market.ats)} of ${s.market.atsN}`);
}

function report(pack: Pack, p: Params, ev: ReturnType<typeof evaluate>) {
  console.log(`\n${pack.sport}  settings ${JSON.stringify(p)}  fitted spread ${f(ev.sd)}`);
  printScore('train', ev.train); printScore('test', ev.test);
  console.log('\nseason   games  winner  miss   market-miss  vs-market');
  for (const r of ev.res) {
    if (!r.preds.length) continue;
    const s = score(r.preds, ev.sd);
    console.log(`${r.season}  ${String(s.n).padStart(6)}  ${pct(s.acc).padStart(6)}  ${f(s.mae).padStart(5)}  ${s.market ? f(s.market.marketMae).padStart(11) : '          –'}  ${s.market ? (s.market.modelMae - s.market.marketMae >= 0 ? '+' : '') + f(s.market.modelMae - s.market.marketMae) : '–'}`);
  }
  // Early season is where priors matter: weeks 0-3 vs the rest, test seasons.
  const testPreds = ev.res.flatMap((r) => r.preds);
  const early = testPreds.filter((x) => x.week <= 3), late = testPreds.filter((x) => x.week > 3);
  console.log(`\nfirst 4 weeks: ${pct(score(early, ev.sd).acc)} winners, miss ${f(score(early, ev.sd).mae)}   |   rest: ${pct(score(late, ev.sd).acc)}, miss ${f(score(late, ev.sd).mae)}`);
  console.log('calibration (test): ' + ev.test.calib.map((c) => `${Math.round(c.lo * 100)}-${Math.round(Math.min(1, c.hi) * 100)}%: said ${pct(c.predicted)}, won ${pct(c.won)} (${c.n})`).join(' | '));
}

async function main() {
  if (cmd === 'export') return exportPack();
  const pack = load(args.pack);
  const years = pack.seasons.map((s) => s.year).sort();
  const isTrain = range(args.train ?? `${years[1]}-${years[Math.floor(years.length * 0.65)]}`);
  const isTest = range(args.test ?? `${years[Math.floor(years.length * 0.65) + 1]}-${years[years.length - 1]}`);

  if (cmd === 'test') {
    const p = paramsFromArgs(DEFAULT_PARAMS);
    report(pack, p, evaluate(pack, p, isTrain, isTest));
    if (args.json) writeFileSync(args.json, JSON.stringify(evaluate(pack, p, isTrain, isTest).res.flatMap((r: SeasonResult) => r.preds as Pred[])));
    return;
  }

  if (cmd === 'tune') {
    // Coordinate search on TRAINING seasons only, objective = margin RMSE. Then score the winner on the test seasons.
    const grid: Record<keyof Params, number[]> = {
      priorGames: [1, 2, 3, 4, 6, 8, 12, 16],
      regress: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75],
      halfLife: [Infinity, 120, 60, 40, 25],
      hcaWeight: [2000, 500, 100],
      cap: [Infinity, 0.8, 0.6, 0.45, 0.3],
    };
    const cache = new Map<string, number>();
    const obj = (p: Params) => {
      const key = JSON.stringify(p, (_, v) => (v === Infinity ? 'inf' : v));
      if (!cache.has(key)) {
        const res = walkForward(pack.model, pack.seasons.filter((s) => s.year <= Math.max(...years.filter(isTrain))), p);
        const tr = res.filter((r) => isTrain(r.season)).flatMap((r) => r.preds);
        cache.set(key, score(tr, fitSd(tr)).rmse);
      }
      return cache.get(key)!;
    };
    let best = { ...DEFAULT_PARAMS }, bestV = obj(best);
    console.log(`start ${JSON.stringify(best)} train rmse ${f(bestV, 3)}`);
    for (let round = 0; round < 3; round++) {
      let improved = false;
      for (const k of Object.keys(grid) as (keyof Params)[]) {
        for (const v of grid[k]) {
          const cand = { ...best, [k]: v };
          const val = obj(cand);
          if (val < bestV - 1e-4) { best = cand; bestV = val; improved = true; console.log(`  ${k}=${v} -> train rmse ${f(val, 3)}`); }
        }
      }
      if (!improved) break;
    }
    console.log(`\nbest on training seasons: ${JSON.stringify(best, (_, v) => (v === Infinity ? 'inf' : v))}`);
    console.log('\n=== defaults ===');
    report(pack, DEFAULT_PARAMS, evaluate(pack, DEFAULT_PARAMS, isTrain, isTest));
    console.log('\n=== tuned ===');
    report(pack, best, evaluate(pack, best, isTrain, isTest));
    if (args.out) writeFileSync(args.out, JSON.stringify({ sport: pack.sport, params: best, evaluated: cache.size }, (_, v) => (v === Infinity ? 'inf' : v)));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
