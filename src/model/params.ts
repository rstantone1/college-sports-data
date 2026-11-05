// Model settings per sport. Every change here is recorded with the backtest that justified it.
//
// 2026-11-05, model-research run 41995454213 (walk-forward, weekly rebuilds, only prior games used).
// Tuned on the earlier seasons, scored on later seasons the search never saw:
//   mbb  train 2013-21, test 2022-26 (26,026 games): margin miss 9.34 -> 9.15, log loss 0.545 -> 0.539, winners 71.6%
//   wbb  train 2013-21, test 2022-26 (27,092 games): margin miss 10.21 -> 9.75, log loss 0.487 -> 0.473, winners 76.1%
//   cfb  train 2015-21, test 2022-26 (3,530 games):  margin miss 13.27 -> 12.91, log loss 0.573 -> 0.555, winners 70.7%
// The main change is far less pull toward last season (regress 0.5 -> 0.1/0.2) and a lighter home-court prior;
// confidence is now well calibrated (a 75% pick wins about 75% of the time). Baseball and softball stay on
// defaults until their history is loaded.
import { DEFAULT_PARAMS, type Params } from './engine.js';

const BY_SPORT: Record<string, Partial<Params>> = {
  mbb: { priorGames: 6, regress: 0.1, hcaWeight: 500 },
  wbb: { priorGames: 4, regress: 0.1, hcaWeight: 500 },
  cfb: { priorGames: 3, regress: 0.2, hcaWeight: 500 },
  bsb: { priorGames: 12, regress: 0.1, hcaWeight: 2000 },
  sb: { priorGames: 8, regress: 0.1, hcaWeight: 500 },
};

export function paramsFor(sport: string): Params {
  return { ...DEFAULT_PARAMS, ...(BY_SPORT[sport] ?? {}) };
}
