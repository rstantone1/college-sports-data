// The prediction log. Every scheduled game gets one pick, written before it starts and never edited; the public
// track record is built from these rows and nothing else. A game whose opponent is outside the division gets a
// pick from a stand-in rating, flagged `estimated`, and is kept out of the record.
import { q } from './db.js';
import type { SportConfig } from './sports.js';
import { normCdf, predictMargin, type Rated, type Rating, type SportModel } from './model/engine.js';
import { sportModel } from './model/pack.js';
import { MODEL_VERSION } from './ratings/efficiency.js';

// Spread of real results around the prediction, per sport (fitted on 2025-26; re-fit by the tuner).
export const RESULT_SD: Record<string, number> = { mbb: 11.3, wbb: 12.5, cfb: 16.8, bsb: 4.3, sb: 3.8 };

// What a typical team from outside the division is worth: set from the margin rated teams beat them by.
const OUTSIDER_MARGIN: Record<string, number> = { mbb: 40, wbb: 45, cfb: 29, bsb: 9, sb: 5.3 };
const TYPICAL_UNITS: Record<string, number> = { mbb: 68, wbb: 70, cfb: 11.5, bsb: 9, sb: 7 };

function outsider(m: SportModel, r: Rated): Rating {
  const em = (OUTSIDER_MARGIN[m.id] ?? 20) * (m.scale / (TYPICAL_UNITS[m.id] ?? m.scale));
  return { team: 0, games: 0, o: r.L - em / 2, d: r.L + em / 2, em: -em, t: r.LT, rawO: r.L, rawD: r.L };
}

export async function writePredictions(s: SportConfig, seasonYear: number, rated: Rated, asOf: string, daysAhead = 3) {
  const m = sportModel(s);
  const games = await q<{ id: number; h: number; a: number; neutral: boolean }>(
    `select g.id, g.home_team_id h, g.away_team_id a, g.neutral_site neutral from games g
     where g.sport_id=$1 and g.season_year=$2 and not g.completed and g.home_team_id is not null and g.away_team_id is not null
       and g.start_time > now() and g.start_time < now() + ($3 || ' days')::interval
       and not exists (select 1 from predictions p where p.game_id=g.id and p.kind='live')
       and not exists (select 1 from games x where x.id=g.id and x.status ~* 'cancel|postpone')`, [s.id, seasonYear, String(daysAhead)]);
  let n = 0, est = 0;
  for (const g of games) {
    const H = rated.ratings.get(Number(g.h)), A = rated.ratings.get(Number(g.a));
    if (!H && !A) continue;
    const home = H ?? outsider(m, rated), away = A ?? outsider(m, rated);
    const { margin, units } = predictMargin(m, rated, home, away, !!g.neutral);
    const sd = RESULT_SD[s.id] ?? 10;
    const prob = normCdf(margin / sd);
    // Expected scores, for display: split the total implied by both offenses around the margin.
    const additive = m.unit === 'inning' || m.unit === 'minute';
    const hEff = additive ? home.o + away.d - rated.L : (home.o * away.d) / rated.L;
    const aEff = additive ? away.o + home.d - rated.L : (away.o * home.d) / rated.L;
    const total = ((hEff + aEff) * units) / m.scale;
    await q(
      `insert into predictions(sport_id, season_year, game_id, kind, ratings_as_of, model_version, home_prob, margin, home_pts, away_pts, estimated)
       values ($1,$2,$3,'live',$4,$5,$6,$7,$8,$9,$10) on conflict do nothing`,
      [s.id, seasonYear, g.id, asOf, MODEL_VERSION, prob, margin, (total + margin) / 2, (total - margin) / 2, !H || !A]);
    n++; if (!H || !A) est++;
  }
  console.log(`${s.id} ${seasonYear}: ${n} picks written (${est} with a stand-in opponent), ${games.length - n} skipped`);
}
