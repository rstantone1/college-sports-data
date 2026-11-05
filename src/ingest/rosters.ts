import { q, one } from '../db.js';
import { espn } from '../espn.js';
import type { SportConfig } from '../sports.js';

const inches = (h?: string) => {
  const m = /(\d+)'\s*(\d+)/.exec(h ?? '');
  return m ? Number(m[1]) * 12 + Number(m[2]) : null;
};
const lbs = (w?: string) => { const n = parseInt(w ?? '', 10); return Number.isFinite(n) ? n : null; };

// Official roster pages: height, weight, class, hometown. Fills in what box scores can't.
export async function ingestRosters(s: SportConfig, seasonYear: number) {
  const teams = await q<{ id: number; espn_id: string; display_name: string }>(
    `select t.id, t.espn_id, t.display_name from teams t
     where t.sport_id=$1 and t.is_active
       and (exists (select 1 from team_seasons ts where ts.team_id=t.id and ts.season_year=$2)
            or not exists (select 1 from team_seasons ts join teams x on x.id=ts.team_id where x.sport_id=$1 and ts.season_year=$2))
     order by t.id`, [s.id, seasonYear]);  // Division I members only (the team list includes every division in football)
  let players = 0;
  for (const t of teams) {
    let data: any;
    try { data = await espn.roster(s, t.espn_id); }
    catch (e) { console.warn(`roster ${s.id}/${t.display_name}: ${(e as Error).message}`); continue; }
    const athletes: any[] = Array.isArray(data?.athletes?.[0]?.items)
      ? data.athletes.flatMap((g: any) => g.items)    // football groups by position
      : data?.athletes ?? [];
    for (const a of athletes) {
      const p = await one<{ id: number }>(
        `insert into players(sport_id, espn_id, display_name, first_name, last_name) values ($1,$2,$3,$4,$5)
         on conflict (sport_id, espn_id) do update set display_name=excluded.display_name,
           first_name=coalesce(excluded.first_name, players.first_name), last_name=coalesce(excluded.last_name, players.last_name)
         returning id`,
        [s.id, String(a.id), a.displayName ?? a.fullName, a.firstName ?? null, a.lastName ?? null]);
      await q(
        `insert into rosters(player_id, team_id, season_year, jersey, position, height_in, weight_lb, class_year, hometown, home_state, home_country)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (player_id, team_id, season_year) do update set
           jersey=coalesce(excluded.jersey, rosters.jersey), position=coalesce(excluded.position, rosters.position),
           height_in=coalesce(excluded.height_in, rosters.height_in), weight_lb=coalesce(excluded.weight_lb, rosters.weight_lb),
           class_year=coalesce(excluded.class_year, rosters.class_year), hometown=coalesce(excluded.hometown, rosters.hometown),
           home_state=coalesce(excluded.home_state, rosters.home_state), home_country=coalesce(excluded.home_country, rosters.home_country),
           last_seen=now()`,
        [p!.id, t.id, seasonYear, a.jersey ?? null, a.position?.abbreviation ?? null, inches(a.displayHeight), lbs(a.displayWeight),
         a.experience?.displayValue ?? null, a.birthPlace?.city ?? null, a.birthPlace?.state ?? null, a.birthPlace?.country ?? null]);
      players++;
    }
  }
  console.log(`${s.id} ${seasonYear}: rosters for ${teams.length} teams, ${players} player-seasons`);
}
