// Turn a season in the database into the engine's input, and bundle many seasons into a "data pack" file so the
// backtester and tuner can run with no database at all.
import { q } from '../db.js';
import type { SportConfig } from '../sports.js';
import type { PackGame, SportModel } from './engine.js';

const SCALE: Record<string, number> = { possession: 100, drive: 10, minute: 90 };
const HCA_PRIOR: Record<string, number> = { possession: 1.6, drive: 0.65, inning: 0.15, minute: 0.1 };

export function sportModel(s: SportConfig): SportModel {
  return { id: s.id, unit: s.scoringUnit as SportModel['unit'], scale: s.scoringUnit === 'inning' ? s.regulationLength : SCALE[s.scoringUnit], hcaPrior: HCA_PRIOR[s.scoringUnit] };
}

export interface SeasonData { year: number; members: number[]; games: PackGame[] }

export async function loadSeason(s: SportConfig, year: number, until?: Date): Promise<SeasonData> {
  const rows = await q<any>(
    `select g.id, extract(epoch from g.start_time)*1000 t, g.home_team_id h, g.away_team_id a, g.home_score hs, g.away_score "as",
            g.neutral_site neutral, g.periods, g.spread, hts.stats hstats, ats.stats astats,
            exists (select 1 from team_seasons ts where ts.team_id=g.home_team_id and ts.season_year=g.season_year) hd1,
            exists (select 1 from team_seasons ts where ts.team_id=g.away_team_id and ts.season_year=g.season_year) ad1
     from games g
     left join game_team_stats hts on hts.game_id=g.id and hts.team_id=g.home_team_id
     left join game_team_stats ats on ats.game_id=g.id and ats.team_id=g.away_team_id
     where g.sport_id=$1 and g.season_year=$2 and g.completed and g.home_score is not null and g.away_score is not null
       and g.home_team_id is not null and g.away_team_id is not null and coalesce(g.season_type, 2) <> 1
       and ($3::timestamptz is null or g.start_time < $3)
     order by g.start_time`, [s.id, year, until ?? null]);
  const members = (await q<{ team_id: number }>(
    `select ts.team_id from team_seasons ts join teams t on t.id=ts.team_id where t.sport_id=$1 and ts.season_year=$2`, [s.id, year])).map((r) => Number(r.team_id));
  const noMembership = members.length === 0;   // no conference data: every game counts
  const games: PackGame[] = [];
  for (const r of rows) {
    const hstats = r.hstats ?? {}, astats = r.astats ?? {};
    let uH = s.units(hstats, astats, { score: r.hs, periods: r.periods }), uA = s.units(astats, hstats, { score: r.as, periods: r.periods });
    if (s.scoringUnit === 'possession') {
      if (uH == null && uA == null) continue;
      const u = uH != null && uA != null ? (uH + uA) / 2 : (uH ?? uA)!;
      uH = uA = u;
    }
    if (uH == null || uA == null || uH <= 0 || uA <= 0) continue;
    if (s.scoringUnit === 'inning') { uH = Math.max(uH, s.regulationLength); uA = Math.max(uA, s.regulationLength); }
    let rf = 1;
    if (s.scoringUnit === 'possession' && r.periods) {
      const regPeriods = s.id === 'wbb' ? 4 : 2;
      rf = s.regulationLength / (s.regulationLength + Math.max(0, r.periods - regPeriods) * 5);
    } else if (s.scoringUnit === 'inning') rf = s.regulationLength / Math.max(uH, uA);
    games.push({
      id: Number(r.id), t: Number(r.t), h: Number(r.h), a: Number(r.a), hs: r.hs, as: r.as, n: r.neutral ? 1 : 0,
      uh: uH, ua: uA, rf, d1: noMembership || (r.hd1 && r.ad1) ? 1 : 0, sp: r.spread == null ? null : Number(r.spread),
    });
  }
  return { year, members, games };
}
