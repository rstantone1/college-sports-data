// Live ratings: load a season from the database and run it through the shared engine (src/model/engine.ts).
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
import { rate, type Params, type Prior } from '../model/engine.js';
import { loadSeason, sportModel } from '../model/pack.js';
import { paramsFor } from '../model/params.js';

export const MODEL_VERSION = 'aeff-v1'; // v1 + preseason prior from last season (same table, same version key)


export interface RatingRow {
  team_id: number; games: number; adj_off: number; adj_def: number; adj_em: number; tempo: number; raw_off: number; raw_def: number;
}

export async function computeRatings(s: SportConfig, seasonYear: number, opts: { priorGames?: number; regress?: number; until?: Date; params?: Partial<Params> } = {}) {
  const m = sportModel(s);
  const season = await loadSeason(s, seasonYear, opts.until);
  const prevRows = await q<{ team_id: number; adj_off: string; adj_def: string; tempo: string }>(
    `select r.team_id, r.adj_off, r.adj_def, r.tempo from ratings r
     join (select max(as_of) a from ratings where sport_id=$1 and season_year=$2) mx on r.as_of=mx.a
     where r.sport_id=$1 and r.season_year=$2`, [s.id, seasonYear - 1]);
  const prev = new Map<number, Prior>(prevRows.map((r) => [Number(r.team_id), { o: Number(r.adj_off), d: Number(r.adj_def), t: Number(r.tempo) }]));
  const p: Params = { ...paramsFor(s.id), ...(opts.params ?? {}) };
  if (opts.priorGames != null) p.priorGames = opts.priorGames;
  if (opts.regress != null) p.regress = opts.regress;
  const r = rate(m, season.games, season.members, prev, p, opts.until?.getTime());
  const ratings: RatingRow[] = [...r.ratings.values()].map((x) => ({
    team_id: x.team, games: x.games, adj_off: x.o, adj_def: x.d, adj_em: x.em, tempo: x.t, raw_off: x.rawO, raw_def: x.rawD,
  }));
  return { ratings, leagueAvg: r.L, hca: r.hca, games: r.games, skipped: season.games.filter((g) => !g.d1).length };
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
