import type { Rating } from './api';

// Matchup math on top of adjusted-efficiency ratings.
// Expected points per 100 = A's offense x B's defense / league average; possessions = tempoA x tempoB / league tempo.
export const HCA_PER_SIDE = 2.2;           // points per 100 possessions, per side (fit on 2025-26)
const SD: Record<string, number> = { mbb: 11.0, wbb: 11.5 };

export interface League { off: number; tempo: number }
export function league(rs: Rating[]): League {
  const n = rs.length || 1;
  return { off: rs.reduce((a, r) => a + r.adj_off, 0) / n, tempo: rs.reduce((a, r) => a + r.tempo, 0) / n };
}

export interface Prediction { aPts: number; bPts: number; poss: number; margin: number; aWin: number }

// site: 1 = A home, 0 = neutral, -1 = B home
export function predict(a: Rating, b: Rating, L: League, site: 1 | 0 | -1, sport = 'mbb'): Prediction {
  const poss = (a.tempo * b.tempo) / L.tempo;
  const aEff = (a.adj_off * b.adj_def) / L.off + site * HCA_PER_SIDE;
  const bEff = (b.adj_off * a.adj_def) / L.off - site * HCA_PER_SIDE;
  const aPts = (aEff * poss) / 100, bPts = (bEff * poss) / 100;
  const margin = aPts - bPts;
  return { aPts, bPts, poss, margin, aWin: normCdf(margin / (SD[sport] ?? 11)) };
}

export function normCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
export const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '–');
export const sign = (v: number) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
