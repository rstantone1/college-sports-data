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
  // Baseball and softball ratings are additive (offense + opponent's defense - average); the others multiply.
  // Must match the ratings engine (src/model/engine.ts predictMargin).
  const additive = sport === 'bsb' || sport === 'sb';
  const aEff = (additive ? a.adj_off + b.adj_def - L.off : (a.adj_off * b.adj_def) / L.off) + site * m.hcaPerSide;
  const bEff = (additive ? b.adj_off + a.adj_def - L.off : (b.adj_off * a.adj_def) / L.off) - site * m.hcaPerSide;
  const aPts = (aEff * poss) / m.scale, bPts = (bEff * poss) / m.scale;
  const margin = aPts - bPts;
  return { aPts, bPts, poss, margin, aWin: normCdf(margin / m.sd) };
}

// A stand-in rating for an opponent outside the rated division (a Division II or NAIA team on a non-conference
// schedule). Set from the average margin rated teams have beaten such opponents by in our own data, so the
// scoreboard can still give a pick instead of a blank. Marked as an estimate wherever it's shown.
const OUTSIDER_MARGIN: Record<string, number> = { mbb: 40, wbb: 45, cfb: 29, bsb: 9, sb: 5.3 };
export function outsider(L: League, sport: string): Rating {
  const m = sportMeta(sport);
  const em = (OUTSIDER_MARGIN[sport] ?? 20) * (m.scale / m.typicalUnits);
  return { team_id: 0, adj_off: L.off - em / 2, adj_def: L.off + em / 2, adj_em: -em, tempo: L.tempo, rank: 0, off_rank: 0, def_rank: 0,
    games_played: 0, short_name: '', abbreviation: '', color: null, logo_url: null } as unknown as Rating;
}

export function normCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// Per-game versions of the ratings, for people: "per 100 possessions" (or per 10 drives / per 9 innings)
// scaled to a typical game at an average pace. A fixed pace keeps the per-game number in the same order as the
// rank; using each team's own pace would let a slow #6 show a smaller margin than a fast #7.
export const perGame = (r: Rating, sport: string) => {
  const m = sportMeta(sport);
  const k = m.typicalUnits / m.scale;
  return { rating: r.adj_em * k, off: r.adj_off * k, def: r.adj_def * k };
};
export const ratingPG = (r: Rating, sport: string) => perGame(r, sport).rating;

export const pct = (p: number) => (p >= 0.995 ? '>99%' : p <= 0.005 ? '<1%' : `${Math.round(p * 100)}%`);
export const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '–');
export const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '–');
export const sign = (v: number, dp = 1) => (v > 0 ? `+${v.toFixed(dp)}` : v.toFixed(dp));
