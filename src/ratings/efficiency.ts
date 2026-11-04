// Opponent-adjusted efficiency ratings, sport-agnostic.
//
// For every game, each team gets an offensive efficiency (points per scoring unit) and the opponent gets the
// mirror as its defensive efficiency. We then iterate: a team's adjusted offense is its average game efficiency
// scaled by how good each opponent's defense was, and vice versa, until the numbers stop moving.
// Early in a season each team is shrunk toward the league average so one blowout doesn't make a #1 seed.
//
// model_version 'aeff-v1' = multiplicative adjustment, empirical home advantage, league-average prior (k games),
// no recency weighting, D-I-vs-D-I games only when conference membership is known.

import { q } from '../db.js';
import type { SportConfig } from '../sports.js';

export const MODEL_VERSION = 'aeff-v1'; // v1 + preseason prior from last season (same table, same version key)

// Presentation scale per sport: per 100 possessions, per 10 drives, per 9 (or 7) innings, per 90 minutes.
const SCALE: Record<string, number> = { possession: 100, drive: 10, inning: 9, minute: 90 };

interface TeamGame {
  team: number; opp: number; pts: number; oppPts: number; units: number; home: 0 | 1 | -1; // 1 home, -1 away, 0 neutral
  regFactor: number; // regulation length / actual length (OT games produce more units)
}

export interface RatingRow {
  team_id: number; games: number; adj_off: number; adj_def: number; adj_em: number; tempo: number; raw_off: number; raw_def: number;
}

export async function computeRatings(s: SportConfig, seasonYear: number, opts: { priorGames?: number; d1Only?: boolean } = {}) {
  const scale = s.scoringUnit === 'inning' ? s.regulationLength : SCALE[s.scoringUnit];
  const priorK = opts.priorGames ?? 6;

  const rows = await q<any>(
    `select g.id, g.home_team_id h, g.away_team_id a, g.home_score hs, g.away_score "as", g.neutral_site neutral, g.periods,
            hts.stats hstats, ats.stats astats,
            (select count(*) from team_seasons ts where ts.team_id=g.home_team_id and ts.season_year=g.season_year) hd1,
            (select count(*) from team_seasons ts where ts.team_id=g.away_team_id and ts.season_year=g.season_year) ad1
     from games g
     left join game_team_stats hts on hts.game_id=g.id and hts.team_id=g.home_team_id
     left join game_team_stats ats on ats.game_id=g.id and ats.team_id=g.away_team_id
     where g.sport_id=$1 and g.season_year=$2 and g.completed and g.home_score is not null and g.away_score is not null
       and g.home_team_id is not null and g.away_team_id is not null and coalesce(g.season_type, 2) <> 1`,
    [s.id, seasonYear]);

  const anyMembership = (await q<{ c: string }>(`select count(*) c from team_seasons ts join teams t on t.id=ts.team_id where t.sport_id=$1 and ts.season_year=$2`, [s.id, seasonYear]))[0].c !== '0';
  const d1Only = opts.d1Only ?? anyMembership;

  const tg: TeamGame[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (d1Only && (Number(r.hd1) === 0 || Number(r.ad1) === 0)) { skipped++; continue; }
    const hstats = r.hstats ?? {}, astats = r.astats ?? {};
    const ctxH = { score: r.hs, periods: r.periods }, ctxA = { score: r.as, periods: r.periods };
    let uH = s.units(hstats, astats, ctxH), uA = s.units(astats, hstats, ctxA);
    if (s.scoringUnit === 'possession') { // both teams get the same possession count
      if (uH == null && uA == null) { skipped++; continue; }
      const u = uH != null && uA != null ? (uH + uA) / 2 : (uH ?? uA)!;
      uH = uA = u;
    }
    if (uH == null || uA == null || uH <= 0 || uA <= 0) { skipped++; continue; }
    // OT / extra innings: scale tempo back to regulation for the tempo stat only.
    let regFactor = 1;
    if (s.scoringUnit === 'possession' && r.periods) {
      const regPeriods = s.id === 'wbb' ? 4 : 2; // WBB plays quarters, MBB halves
      const perPeriod = s.regulationLength / regPeriods;
      const otPeriods = Math.max(0, r.periods - regPeriods);
      regFactor = s.regulationLength / (s.regulationLength + otPeriods * 5);
      void perPeriod;
    } else if (s.scoringUnit === 'inning') {
      regFactor = s.regulationLength / Math.max(uH, uA);
    }
    const neutral = !!r.neutral;
    tg.push({ team: r.h, opp: r.a, pts: r.hs, oppPts: r.as, units: uH, home: neutral ? 0 : 1, regFactor });
    tg.push({ team: r.a, opp: r.h, pts: r.as, oppPts: r.hs, units: uA, home: neutral ? 0 : -1, regFactor });
  }
  if (tg.length === 0) return { ratings: [] as RatingRow[], leagueAvg: 0, hca: 0, games: 0, skipped };

  // League averages.
  const totPts = tg.reduce((a, g) => a + g.pts, 0), totUnits = tg.reduce((a, g) => a + g.units, 0);
  const L = (totPts / totUnits) * scale;                      // league efficiency
  const LT = tg.reduce((a, g) => a + g.units * g.regFactor, 0) / tg.length; // league tempo (regulation-normalized)

  // Home advantage starts at a sport prior and is re-estimated each iteration from the residual margin
  // in home games AFTER team strength is accounted for, so buy games don't inflate it.
  const priorHCA = s.scoringUnit === 'possession' ? 1.6 : s.scoringUnit === 'drive' ? 0.25 : s.scoringUnit === 'inning' ? 0.15 : 0.1;
  const homeGames = tg.filter((g) => g.home === 1);
  let hca = priorHCA;

  const additive = s.scoringUnit === 'inning' || s.scoringUnit === 'minute';
  const teams = [...new Set(tg.map((g) => g.team))];

  // Preseason prior: last season's final rating, regressed halfway to league average (scaled to this season's
  // league level). Teams with no history start at average. Worth priorK games, so it fades as games accumulate.
  const prev = await q<{ team_id: number; adj_off: string; adj_def: string; tempo: string }>(
    `select r.team_id, r.adj_off, r.adj_def, r.tempo from ratings r
     join (select max(as_of) a from ratings where sport_id=$1 and season_year=$2) m on r.as_of=m.a
     where r.sport_id=$1 and r.season_year=$2`, [s.id, seasonYear - 1]);
  const prevL = prev.length ? prev.reduce((a, r) => a + Number(r.adj_off), 0) / prev.length : 0;
  const prevT = prev.length ? prev.reduce((a, r) => a + Number(r.tempo), 0) / prev.length : 0;
  const prior = new Map<number, { o: number; d: number; t: number }>();
  for (const r of prev) {
    const regress = 0.5;
    prior.set(r.team_id, {
      o: L * (1 + regress * (Number(r.adj_off) / prevL - 1)),
      d: L * (1 + regress * (Number(r.adj_def) / prevL - 1)),
      t: LT * (1 + regress * (Number(r.tempo) / prevT - 1)),
    });
  }
  const adjO = new Map<number, number>(), adjD = new Map<number, number>(), adjT = new Map<number, number>();
  for (const t of teams) { adjO.set(t, L); adjD.set(t, L); adjT.set(t, LT); }
  const byTeam = new Map<number, TeamGame[]>();
  for (const g of tg) { if (!byTeam.has(g.team)) byTeam.set(g.team, []); byTeam.get(g.team)!.push(g); }

  for (let iter = 0; iter < 60; iter++) {
    let maxDelta = 0;
    const nextO = new Map<number, number>(), nextD = new Map<number, number>(), nextT = new Map<number, number>();
    for (const t of teams) {
      const gs = byTeam.get(t)!;
      let so = 0, sd = 0, st = 0;
      for (const g of gs) {
        const offEff = (g.pts / g.units) * scale - g.home * hca;       // remove home boost from offense
        const defEff = (g.oppPts / g.units) * scale + g.home * hca;    // opponent's offense was suppressed/helped by venue
        if (additive) {   // low-scoring sports: shift by opponent strength instead of scaling (multiplying overreacts to blowouts)
          so += offEff - (adjD.get(g.opp)! - L);
          sd += defEff - (adjO.get(g.opp)! - L);
        } else {
          so += (offEff * L) / adjD.get(g.opp)!;
          sd += (defEff * L) / adjO.get(g.opp)!;
        }
        st += (g.units * g.regFactor * LT) / adjT.get(g.opp)!;
      }
      const n = gs.length;
      // Shrink toward league average: prior worth priorK games.
      const pr = prior.get(t) ?? { o: L, d: L, t: LT };
      const o = (so + priorK * pr.o) / (n + priorK), d = (sd + priorK * pr.d) / (n + priorK), tp = (st + priorK * pr.t) / (n + priorK);
      maxDelta = Math.max(maxDelta, Math.abs(o - adjO.get(t)!), Math.abs(d - adjD.get(t)!));
      nextO.set(t, o); nextD.set(t, d); nextT.set(t, tp);
    }
    for (const t of teams) { adjO.set(t, nextO.get(t)!); adjD.set(t, nextD.get(t)!); adjT.set(t, nextT.get(t)!); }
    if (homeGames.length) {
      let resid = 0;
      for (const g of homeGames) {
        const expOff = (adjO.get(g.team)! * adjD.get(g.opp)!) / L;   // what the home offense "should" have scored per unit
        const expDef = (adjD.get(g.team)! * adjO.get(g.opp)!) / L;   // what the home defense "should" have allowed
        const actOff = (g.pts / g.units) * scale, actDef = (g.oppPts / g.units) * scale;
        resid += ((actOff - expOff) + (expDef - actDef)) / 2;        // per-side advantage observed in this game
      }
      const emp = resid / homeGames.length;
      hca = (homeGames.length * emp + 2000 * priorHCA) / (homeGames.length + 2000); // prior worth ~2000 home games; empirical takes over mid-season
    }
    if (maxDelta < 1e-4) break;
  }

  const ratings: RatingRow[] = teams.map((t) => {
    const gs = byTeam.get(t)!;
    const rawO = (gs.reduce((a, g) => a + g.pts, 0) / gs.reduce((a, g) => a + g.units, 0)) * scale;
    const rawD = (gs.reduce((a, g) => a + g.oppPts, 0) / gs.reduce((a, g) => a + g.units, 0)) * scale;
    return { team_id: t, games: gs.length, adj_off: adjO.get(t)!, adj_def: adjD.get(t)!, adj_em: adjO.get(t)! - adjD.get(t)!, tempo: adjT.get(t)!, raw_off: rawO, raw_def: rawD };
  });
  return { ratings, leagueAvg: L, hca, games: tg.length / 2, skipped };
}

export async function saveRatings(s: SportConfig, seasonYear: number, asOf: string, rows: RatingRow[]) {
  const byEm = [...rows].sort((a, b) => b.adj_em - a.adj_em);
  const byO = [...rows].sort((a, b) => b.adj_off - a.adj_off);
  const byD = [...rows].sort((a, b) => a.adj_def - b.adj_def);
  const rank = new Map(byEm.map((r, i) => [r.team_id, i + 1]));
  const oRank = new Map(byO.map((r, i) => [r.team_id, i + 1]));
  const dRank = new Map(byD.map((r, i) => [r.team_id, i + 1]));
  for (const r of rows) {
    await q(
      `insert into ratings(sport_id, season_year, team_id, as_of, model_version, games_played, adj_off, adj_def, adj_em, tempo, raw_off, raw_def, rank, off_rank, def_rank)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (sport_id, season_year, team_id, as_of, model_version) do update set games_played=excluded.games_played,
         adj_off=excluded.adj_off, adj_def=excluded.adj_def, adj_em=excluded.adj_em, tempo=excluded.tempo, raw_off=excluded.raw_off,
         raw_def=excluded.raw_def, rank=excluded.rank, off_rank=excluded.off_rank, def_rank=excluded.def_rank`,
      [s.id, seasonYear, r.team_id, asOf, MODEL_VERSION, r.games, r.adj_off, r.adj_def, r.adj_em, r.tempo, r.raw_off, r.raw_def,
       rank.get(r.team_id), oRank.get(r.team_id), dRank.get(r.team_id)]);
  }
}
