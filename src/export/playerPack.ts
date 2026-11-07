// Research export for player projections (the groundwork for player props): every player's line in every game,
// slimmed to the stats props are written on, with the game's date, teams and venue. Public box-score data only.
import { gzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { q } from '../db.js';
import type { SportConfig } from '../sports.js';

const HOOPS = ['minutes', 'points', 'rebounds', 'offensiveRebounds', 'assists', 'threePointFieldGoalsMade', 'threePointFieldGoalsAttempted',
  'fieldGoalsAttempted', 'freeThrowsAttempted', 'turnovers', 'steals', 'blocks', 'fouls'];
const CFB: Record<string, string[]> = {
  passing: ['completions', 'passingAttempts', 'passingYards', 'passingTouchdowns', 'interceptions'],
  rushing: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns'],
  receiving: ['receptions', 'receivingYards', 'receivingTouchdowns', 'receivingTargets'],
};

export async function exportPlayerPack(s: SportConfig, from: number, to: number, out: string) {
  const hoops = s.id !== 'cfb';
  const seasons: any[] = [];
  for (let y = from; y <= to; y++) {
    const games = await q<any>(
      `select g.id, (extract(epoch from g.start_time)*1000)::bigint t, g.home_team_id h, g.away_team_id a, coalesce(g.neutral_site,false) n,
              g.home_score hs, g.away_score "as", g.spread sp, g.total tot
       from games g where g.sport_id=$1 and g.season_year=$2 and g.completed and g.home_score is not null order by g.start_time`, [s.id, y]);
    const groups = hoops ? null : Object.keys(CFB);
    const keys = hoops ? HOOPS : [...new Set(Object.values(CFB).flat())];
    const rows = await q<any>(
      `select ps.game_id g, ps.team_id tm, ps.player_id p, ps.starter st, ps.did_not_play dnp, ps.stat_group grp,
              (select jsonb_object_agg(k, ps.stats->k) from unnest($3::text[]) k where ps.stats ? k) x
       from game_player_stats ps join games g on g.id=ps.game_id
       where g.sport_id=$1 and g.season_year=$2 and g.completed and ($4::text[] is null or ps.stat_group = any($4::text[]))`,
      [s.id, y, keys, groups]);
    seasons.push({
      year: y,
      games: games.map((g) => ({ id: Number(g.id), t: Number(g.t), h: Number(g.h), a: Number(g.a), n: g.n, hs: g.hs, as: g.as, sp: g.sp == null ? null : Number(g.sp), tot: g.tot == null ? null : Number(g.tot) })),
      rows: rows.map((r) => ({ g: Number(r.g), tm: Number(r.tm), p: Number(r.p), st: r.st ? 1 : 0, dnp: r.dnp ? 1 : 0, grp: r.grp, x: r.x ?? {} })),
    });
    console.log(`${s.id} ${y}: ${games.length} games, ${rows.length} player lines`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, gzipSync(JSON.stringify({ sport: s.id, seasons })));
  console.log(`wrote ${out}`);
}
