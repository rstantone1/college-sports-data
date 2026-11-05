// The ratings engine, with no database in it. The live ratings (src/ratings/efficiency.ts), the backtester and the
// tuner all call this one function, so what gets tested is exactly what runs on the site.
//
// Opponent-adjusted efficiency: each team-game gives an offensive efficiency (points per scoring unit) and the
// mirror for the opponent's defense. A team's adjusted offense is its game efficiencies scaled by how good each
// opponent's defense was, and vice versa, iterated until nothing moves. A preseason prior (last season's final
// rating, regressed toward average) counts as `priorGames` games and fades as real games pile up.

export type Unit = 'possession' | 'drive' | 'inning' | 'minute';

export interface SportModel {
  id: string;
  unit: Unit;
  scale: number;        // ratings are per `scale` units (100 possessions, 10 drives, 9 or 7 innings)
  hcaPrior: number;     // starting home edge per side, in rating units
}

// One game, already reduced to what the model needs. Built once from the database (or a data pack).
export interface PackGame {
  id: number;
  t: number;            // start time, ms
  h: number; a: number; // team ids
  hs: number; as: number;
  n: 0 | 1;             // neutral site
  uh: number; ua: number; // scoring units each side had (possessions etc.), already floored at regulation for innings
  rf: number;           // regulation factor for the pace stat (OT/extra innings scaled back)
  d1: 0 | 1;            // both teams Division I members this season
  sp: number | null;    // market spread, home team's view (negative = home favored)
}

export interface Params {
  priorGames: number;   // how many games the preseason prior is worth
  regress: number;      // how far last season's rating is pulled toward average (0 = keep, 1 = average)
  halfLife: number;     // recency weighting in days (Infinity = every game counts the same)
  hcaWeight: number;    // how many home games the home-edge prior is worth before the data takes over
  cap: number;          // cap on a single game's efficiency gap from league average, as a fraction (Infinity = none)
}

export const DEFAULT_PARAMS: Params = { priorGames: 6, regress: 0.5, halfLife: Infinity, hcaWeight: 2000, cap: Infinity };

export interface Rating { team: number; games: number; o: number; d: number; em: number; t: number; rawO: number; rawD: number }
export interface Prior { o: number; d: number; t: number } // last season's final, in last season's units
export interface Impact { game: number; adjEm: number; contrib: number }
export interface Rated { ratings: Map<number, Rating>; L: number; LT: number; hca: number; games: number; impacts: Map<number, Impact[]> }

export function rate(m: SportModel, games: PackGame[], members: number[], prev: Map<number, Prior> | null, p: Params, asOf?: number): Rated {
  const additive = m.unit === 'inning' || m.unit === 'minute';
  const tg: { game: number; team: number; opp: number; pts: number; oppPts: number; units: number; home: number; rf: number; w: number }[] = [];
  const now = asOf ?? Math.max(0, ...games.map((g) => g.t));
  for (const g of games) {
    if (!g.d1) continue;
    const w = Number.isFinite(p.halfLife) ? Math.pow(0.5, Math.max(0, now - g.t) / 864e5 / p.halfLife) : 1;
    const home = g.n ? 0 : 1;
    tg.push({ game: g.id, team: g.h, opp: g.a, pts: g.hs, oppPts: g.as, units: g.uh, home, rf: g.rf, w });
    tg.push({ game: g.id, team: g.a, opp: g.h, pts: g.as, oppPts: g.hs, units: g.ua, home: -home, rf: g.rf, w });
  }
  const teams = [...new Set([...tg.map((x) => x.team), ...members])];
  if (!teams.length) return { ratings: new Map(), L: 0, LT: 0, hca: 0, games: 0, impacts: new Map() };

  // League level: from this season's games so far, or from last season if none have been played yet.
  let L: number, LT: number;
  if (tg.length) {
    L = (tg.reduce((a, x) => a + x.pts, 0) / tg.reduce((a, x) => a + x.units, 0)) * m.scale;
    LT = tg.reduce((a, x) => a + x.units * x.rf, 0) / tg.length;
  } else if (prev && prev.size) {
    const ps = [...prev.values()];
    L = ps.reduce((a, x) => a + x.o, 0) / ps.length; LT = ps.reduce((a, x) => a + x.t, 0) / ps.length;
  } else return { ratings: new Map(), L: 0, LT: 0, hca: 0, games: 0, impacts: new Map() };

  // Prior: last season's rating relative to last season's average, regressed, re-expressed at this season's level.
  const prior = new Map<number, Prior>();
  if (prev && prev.size) {
    const ps = [...prev.values()];
    const pL = ps.reduce((a, x) => a + x.o, 0) / ps.length, pT = ps.reduce((a, x) => a + x.t, 0) / ps.length;
    const k = 1 - p.regress;
    for (const [t, x] of prev) {
      prior.set(t, additive
        ? { o: L + k * (x.o - pL), d: L + k * (x.d - pL), t: LT * (1 + k * (x.t / pT - 1)) }
        : { o: L * (1 + k * (x.o / pL - 1)), d: L * (1 + k * (x.d / pL - 1)), t: LT * (1 + k * (x.t / pT - 1)) });
    }
  }

  const byTeam = new Map<number, typeof tg>();
  for (const t of teams) byTeam.set(t, []);
  for (const x of tg) byTeam.get(x.team)!.push(x);
  const homeGames = tg.filter((x) => x.home === 1);
  const adjO = new Map<number, number>(), adjD = new Map<number, number>(), adjT = new Map<number, number>();
  for (const t of teams) { const pr = prior.get(t); adjO.set(t, pr?.o ?? L); adjD.set(t, pr?.d ?? L); adjT.set(t, pr?.t ?? LT); }
  let hca = m.hcaPrior;
  const lo = Number.isFinite(p.cap) ? L * (1 - p.cap) : -Infinity, hi = Number.isFinite(p.cap) ? L * (1 + p.cap) : Infinity;
  const clamp = (v: number) => (v < lo ? lo : v > hi ? hi : v);

  for (let iter = 0; iter < 60; iter++) {
    let maxDelta = 0;
    const nO = new Map<number, number>(), nD = new Map<number, number>(), nT = new Map<number, number>();
    for (const t of teams) {
      const gs = byTeam.get(t)!;
      let so = 0, sd = 0, st = 0, sw = 0;
      for (const x of gs) {
        const offEff = clamp((x.pts / x.units) * m.scale - x.home * hca);
        const defEff = clamp((x.oppPts / x.units) * m.scale + x.home * hca);
        if (additive) { so += x.w * (offEff - (adjD.get(x.opp)! - L)); sd += x.w * (defEff - (adjO.get(x.opp)! - L)); }
        else { so += x.w * ((offEff * L) / adjD.get(x.opp)!); sd += x.w * ((defEff * L) / adjO.get(x.opp)!); }
        st += x.w * ((x.units * x.rf * LT) / adjT.get(x.opp)!);
        sw += x.w;
      }
      const pr = prior.get(t) ?? { o: L, d: L, t: LT };
      const k = p.priorGames;
      const o = (so + k * pr.o) / (sw + k), d = (sd + k * pr.d) / (sw + k), tp = (st + k * pr.t) / (sw + k);
      maxDelta = Math.max(maxDelta, Math.abs(o - adjO.get(t)!), Math.abs(d - adjD.get(t)!));
      nO.set(t, o); nD.set(t, d); nT.set(t, tp);
    }
    // Re-center so the average offense and defense both equal the league level (stops drift).
    let mO = 0, mD = 0;
    for (const t of teams) { mO += nO.get(t)!; mD += nD.get(t)!; }
    mO /= teams.length; mD /= teams.length;
    for (const t of teams) {
      adjO.set(t, additive ? nO.get(t)! + (L - mO) : nO.get(t)! * (L / mO));
      adjD.set(t, additive ? nD.get(t)! + (L - mD) : nD.get(t)! * (L / mD));
      adjT.set(t, nT.get(t)!);
    }
    // Home edge from what's left over in home games once both teams' strength is accounted for.
    if (homeGames.length) {
      let resid = 0;
      for (const x of homeGames) {
        const eO = additive ? adjO.get(x.team)! + adjD.get(x.opp)! - L : (adjO.get(x.team)! * adjD.get(x.opp)!) / L;
        const eD = additive ? adjD.get(x.team)! + adjO.get(x.opp)! - L : (adjD.get(x.team)! * adjO.get(x.opp)!) / L;
        resid += (((x.pts / x.units) * m.scale - eO) + (eD - (x.oppPts / x.units) * m.scale)) / 2;
      }
      hca = (resid + p.hcaWeight * m.hcaPrior) / (homeGames.length + p.hcaWeight);
    }
    if (maxDelta < 1e-4) break;
  }

  const ratings = new Map<number, Rating>();
  const impacts = new Map<number, Impact[]>();
  for (const t of teams) {
    const gs = byTeam.get(t)!;
    const u = gs.reduce((a, x) => a + x.units, 0);
    const em = adjO.get(t)! - adjD.get(t)!;
    ratings.set(t, {
      team: t, games: gs.length, o: adjO.get(t)!, d: adjD.get(t)!, em, t: adjT.get(t)!,
      rawO: u ? (gs.reduce((a, x) => a + x.pts, 0) / u) * m.scale : adjO.get(t)!,
      rawD: u ? (gs.reduce((a, x) => a + x.oppPts, 0) / u) * m.scale : adjD.get(t)!,
    });
    // What each game said on its own (adjusted for opponent and venue), and how much the rating would move
    // without it. The rating is the weighted mean of these plus the prior, so a game's pull is its distance
    // from the mean divided by the weight that remains.
    const sw = gs.reduce((a, x) => a + x.w, 0);
    impacts.set(t, gs.map((x) => {
      const offEff = clamp((x.pts / x.units) * m.scale - x.home * hca), defEff = clamp((x.oppPts / x.units) * m.scale + x.home * hca);
      const gO = additive ? offEff - (adjD.get(x.opp)! - L) : (offEff * L) / adjD.get(x.opp)!;
      const gD = additive ? defEff - (adjO.get(x.opp)! - L) : (defEff * L) / adjO.get(x.opp)!;
      const adjEm = gO - gD;
      return { game: x.game, adjEm, contrib: (x.w * (adjEm - em)) / Math.max(1e-9, sw + p.priorGames - x.w) };
    }));
  }
  return { ratings, L, LT, hca, games: tg.length / 2, impacts };
}

// Predicted margin (home minus away, in points/runs) and the expected scoring units, from two ratings.
export function predictMargin(m: SportModel, r: Rated, home: Rating, away: Rating, neutral: boolean) {
  const additive = m.unit === 'inning' || m.unit === 'minute';
  const units = (home.t * away.t) / r.LT;
  const site = neutral ? 0 : 1;
  const hEff = additive ? home.o + away.d - r.L + site * r.hca : (home.o * away.d) / r.L + site * r.hca;
  const aEff = additive ? away.o + home.d - r.L - site * r.hca : (away.o * home.d) / r.L - site * r.hca;
  return { margin: ((hEff - aEff) * units) / m.scale, units };
}

export function normCdf(z: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? p : 1 - p;
}
