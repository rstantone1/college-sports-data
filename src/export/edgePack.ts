// Research export: every game with its market lines, venue, game type and the box-score numbers behind "luck"
// measures, plus each team's conference by season. Used offline to test which factors predict results against the
// closing line. Contains only public game data.
import { gzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { q } from '../db.js';
import type { SportConfig } from '../sports.js';

const HOOPS_KEYS = ['fieldGoalsMade', 'fieldGoalsAttempted', 'threePointFieldGoalsMade', 'threePointFieldGoalsAttempted',
  'freeThrowsMade', 'freeThrowsAttempted', 'offensiveRebounds', 'defensiveRebounds', 'totalTurnovers', 'turnovers', 'assists',
  'steals', 'blocks', 'fouls'];
const CFB_KEYS = ['turnovers', 'fumblesLost', 'interceptions', 'totalYards', 'drives', 'firstDowns', 'rushingAttempts',
  'rushingYards', 'netPassingYards', 'yardsPerPass'];

export async function exportEdgePack(s: SportConfig, from: number, to: number, out: string) {
  const keys = s.id === 'cfb' ? CFB_KEYS : HOOPS_KEYS;
  const seasons: any[] = [];
  for (let y = from; y <= to; y++) {
    const games = await q<any>(
      `select g.id, g.espn_id e, (extract(epoch from g.start_time)*1000)::bigint t, g.home_team_id h, g.away_team_id a,
              g.home_score hs, g.away_score "as", coalesce(g.neutral_site,false) n, g.conference_game cg, g.season_type st,
              g.venue_city vc, g.venue_state vs, g.attendance att, g.periods per, g.completed c,
              g.spread sp, g.total tot, g.spread_open spo, g.total_open toto, g.home_ml hml, g.away_ml aml, g.line_books nb, g.line_flag lf
       from games g
       where g.sport_id=$1 and g.season_year=$2 and g.home_team_id is not null and g.away_team_id is not null
       order by g.start_time`, [s.id, y]);
    const stats = await q<any>(
      `select ts.game_id g, ts.team_id tm, (select jsonb_object_agg(k, ts.stats->k) from unnest($3::text[]) k where ts.stats ? k) st
       from game_team_stats ts join games g on g.id=ts.game_id
       where g.sport_id=$1 and g.season_year=$2`, [s.id, y, keys]);
    const conf = await q<any>(`select ts.team_id tm, ts.conference_id c from team_seasons ts join teams t on t.id=ts.team_id where t.sport_id=$1 and ts.season_year=$2`, [s.id, y]);
    const num = (x: any) => (x == null ? null : Number(x));
    seasons.push({
      year: y,
      games: games.map((g) => ({ ...g, id: Number(g.id), t: Number(g.t), h: Number(g.h), a: Number(g.a), sp: num(g.sp), tot: num(g.tot), spo: num(g.spo), toto: num(g.toto) })),
      stats: stats.map((x) => ({ g: Number(x.g), tm: Number(x.tm), st: x.st })),
      conf: conf.map((x) => ({ tm: Number(x.tm), c: x.c == null ? null : Number(x.c) })),
    });
    console.log(`${s.id} ${y}: ${games.length} games, ${games.filter((g) => g.sp != null).length} with a line, ${stats.length} team box scores`);
  }
  const teams = await q<any>(`select id, short_name n, abbreviation ab from teams where sport_id=$1`, [s.id]);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, gzipSync(JSON.stringify({ sport: s.id, seasons, teams: teams.map((t) => ({ ...t, id: Number(t.id) })) })));
  console.log(`wrote ${out}`);
}
