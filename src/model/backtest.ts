// Walk-forward backtest over many seasons. For each season: start from the previous season's final ratings (made
// with the same settings), then step through the season a week at a time, rating with only the games already played
// and predicting the next week. Every prediction is one the model could have made on the day.
import { rate, predictMargin, normCdf, type PackGame, type Params, type Prior, type SportModel } from './engine.js';
import type { SeasonData } from './pack.js';

export interface Pred {
  season: number; id: number; t: number; week: number; // week of season the game fell in (0 = first)
  margin: number; actual: number; sp: number | null;
  neutral: boolean;
}

export interface SeasonResult { season: number; preds: Pred[]; hca: number }

export function finalRatings(m: SportModel, s: SeasonData, prev: Map<number, Prior> | null, p: Params): Map<number, Prior> {
  const r = rate(m, s.games, s.members, prev, p);
  return new Map([...r.ratings.values()].map((x) => [x.team, { o: x.o, d: x.d, t: x.t }]));
}

export function walkForward(m: SportModel, seasons: SeasonData[], p: Params, stepDays = 7): SeasonResult[] {
  const out: SeasonResult[] = [];
  const sorted = [...seasons].sort((a, b) => a.year - b.year);
  let prev: Map<number, Prior> | null = null;
  for (const s of sorted) {
    const games = s.games.filter((g) => g.d1).sort((a, b) => a.t - b.t);
    const preds: Pred[] = [];
    let hca = 0;
    if (games.length && prev) {   // the first season is a warm-up: it only supplies the next season's prior
      const start = games[0].t - 864e5;  // predict from the very first day, on the prior alone
      let i = 0, week = 0;
      for (let cut = start; i < games.length; cut += stepDays * 864e5, week++) {
        const before = s.games.filter((g) => g.t < cut);
        const r = rate(m, before, s.members, prev, p, cut);
        hca = r.hca;
        while (i < games.length && games[i].t < cut + stepDays * 864e5) {
          const g = games[i++];
          const H = r.ratings.get(g.h), A = r.ratings.get(g.a);
          if (!H || !A) continue;
          const { margin } = predictMargin(m, r, H, A, !!g.n);
          preds.push({ season: s.year, id: g.id, t: g.t, week, margin, actual: g.hs - g.as, sp: g.sp, neutral: !!g.n });
        }
      }
    }
    out.push({ season: s.year, preds, hca });
    prev = finalRatings(m, s, prev, p);
  }
  return out;
}

export interface Score {
  n: number; acc: number; mae: number; rmse: number; bias: number; logloss: number; brier: number;
  market?: { n: number; modelMae: number; marketMae: number; modelAcc: number; marketAcc: number; ats: number; atsN: number; gap: number };
  calib: { lo: number; hi: number; n: number; predicted: number; won: number }[];
}

export function score(preds: Pred[], sd: number): Score {
  const n = preds.length;
  if (!n) return { n: 0, acc: NaN, mae: NaN, rmse: NaN, bias: NaN, logloss: NaN, brier: NaN, calib: [] };
  let right = 0, ae = 0, se = 0, bias = 0, ll = 0, br = 0;
  const bins = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0001].map((lo, i, a) => ({ lo, hi: a[i + 1] ?? 1.0001, n: 0, predicted: 0, won: 0 })).slice(0, -1);
  for (const p of preds) {
    if (p.actual === 0) continue;  // ties (baseball/football can't, but guard)
    const ph = normCdf(p.margin / sd), hw = p.actual > 0;
    if ((ph >= 0.5) === hw) right++;
    const e = p.actual - p.margin; ae += Math.abs(e); se += e * e; bias += e;
    ll -= Math.log(Math.min(1 - 1e-9, Math.max(1e-9, hw ? ph : 1 - ph)));
    br += (ph - (hw ? 1 : 0)) ** 2;
    const fav = Math.max(ph, 1 - ph), favWon = (ph >= 0.5) === hw;
    const b = bins.find((x) => fav >= x.lo && fav < x.hi)!; b.n++; b.predicted += fav; if (favWon) b.won++;
  }
  const res: Score = { n, acc: right / n, mae: ae / n, rmse: Math.sqrt(se / n), bias: bias / n, logloss: ll / n, brier: br / n,
    calib: bins.map((b) => ({ ...b, predicted: b.n ? b.predicted / b.n : 0, won: b.n ? b.won / b.n : 0 })) };
  const v = preds.filter((p) => p.sp != null && p.actual !== 0);
  if (v.length) {
    let mm = 0, km = 0, ma = 0, ka = 0, ats = 0, atsN = 0, gap = 0;
    for (const p of v) {
      const mk = -p.sp!;
      mm += Math.abs(p.margin - p.actual); km += Math.abs(mk - p.actual); gap += Math.abs(p.margin - mk);
      if ((p.margin > 0) === (p.actual > 0)) ma++;
      if ((mk > 0) === (p.actual > 0)) ka++;
      if (Math.abs(p.margin - mk) >= 1 && p.actual !== mk) { atsN++; if ((p.margin > mk) === (p.actual > mk)) ats++; }
    }
    res.market = { n: v.length, modelMae: mm / v.length, marketMae: km / v.length, modelAcc: ma / v.length, marketAcc: ka / v.length, ats: atsN ? ats / atsN : NaN, atsN, gap: gap / v.length };
  }
  return res;
}

// The spread of real results around predictions (sets win chances), fitted on training predictions only.
export const fitSd = (preds: Pred[]) => Math.sqrt(preds.reduce((a, p) => a + (p.actual - p.margin) ** 2, 0) / Math.max(1, preds.length));
