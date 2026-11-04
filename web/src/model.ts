import type { Rating } from './api';
import { sportMeta } from './sports';

// Matchup math on top of adjusted-efficiency ratings, for any sport.
// Expected efficiency = A's offense x B's defense / league average; units (possessions or innings) = tempoA x tempoB / league tempo.

export interface League { off: number; tempo: number }
export function league(rs: Rating[]): League {
  const n = rs.length || 1;
  return { off: rs.reduce((a, r) => a + r.adj_off, 0) / n, tempo: rs.reduce((a, r) => a + r.tempo, 0) / n };
}

export interface Prediction { aPts: number; bPts: number; poss: number; margin: number; aWin: number }

// site: 1 = A home, 0 = neutral, -1 = B home
export function predict(a: Rating, b: Rating, L: League, site: 1 | 0 | -1, sport = 'mbb'): Prediction {
  const m = sportMeta(sport);
  const poss = (a.tempo * b.tempo) / L.tempo;
  const aEff = (a.adj_off * b.adj_def) / L.off + site * m.hcaPerSide;
  const bEff = (b.adj_off * a.adj_def) / L.off - site * m.hcaPerSide;
  const aPts = (aEff * poss) / m.scale, bPts = (bEff * poss) / m.scale;
  const margin = aPts - bPts;
  return { aPts, bPts, poss, margin, aWin: normCdf(margin / m.sd) };
}

export function normCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// Per-game versions of the ratings, for people. A team's own pace converts "per 100 possessions"
// (or per 10 drives / per 9 innings) into points in a typical game for that team.
export const perGame = (r: Rating, sport: string) => {
  const m = sportMeta(sport);
  const k = r.tempo / m.scale;
  return { rating: r.adj_em * k, off: r.adj_off * k, def: r.adj_def * k };
};
export const ratingPG = (r: Rating, sport: string) => perGame(r, sport).rating;

export const pct = (p: number) => `${Math.round(p * 100)}%`;
export const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '–');
export const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '–');
export const sign = (v: number, dp = 1) => (v > 0 ? `+${v.toFixed(dp)}` : v.toFixed(dp));
