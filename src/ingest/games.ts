import { q, one } from '../db.js';
import { espn } from '../espn.js';
import { seasonDates, yyyymmdd, type SportConfig } from '../sports.js';
import { upsertTeam } from './teams.js';

const teamCache = new Map<string, number>();
async function teamId(s: SportConfig, t: any): Promise<number | null> {
  if (!t?.id) return null;
  const k = `${s.id}:${t.id}`;
  if (teamCache.has(k)) return teamCache.get(k)!;
  const hit = await one<{ id: number }>(`select id from teams where sport_id=$1 and espn_id=$2`, [s.id, String(t.id)]);
  const id = hit?.id ?? (await upsertTeam(s, t));
  teamCache.set(k, id);
  return id;
}

export async function upsertGameFromEvent(s: SportConfig, ev: any, seasonYear: number): Promise<number | null> {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c: any) => c.homeAway === 'home');
  const away = comp.competitors?.find((c: any) => c.homeAway === 'away');
  const homeId = await teamId(s, home?.team);
  const awayId = await teamId(s, away?.team);
  const status: string = comp.status?.type?.name ?? ev.status?.type?.name ?? 'STATUS_SCHEDULED';
  const completed = !!(comp.status?.type?.completed ?? ev.status?.type?.completed) || status === 'STATUS_FINAL';
  const score = (c: any) => (c?.score != null && c.score !== '' ? Number(c.score) : null);
  const notes = (comp.notes ?? []).map((n: any) => n.headline).filter(Boolean).join(' | ') || null;

  const row = await one<{ id: number }>(
    `insert into games(sport_id, espn_id, season_year, season_type, start_time, status, completed, neutral_site, conference_game,
        venue_name, venue_city, venue_state, attendance, home_team_id, away_team_id, home_score, away_score, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     on conflict (sport_id, espn_id) do update set
       season_type=coalesce(excluded.season_type, games.season_type), start_time=excluded.start_time, status=excluded.status,
       completed=excluded.completed, neutral_site=excluded.neutral_site, conference_game=coalesce(excluded.conference_game, games.conference_game),
       venue_name=coalesce(excluded.venue_name, games.venue_name), venue_city=coalesce(excluded.venue_city, games.venue_city),
       venue_state=coalesce(excluded.venue_state, games.venue_state), attendance=coalesce(excluded.attendance, games.attendance),
       home_team_id=coalesce(excluded.home_team_id, games.home_team_id), away_team_id=coalesce(excluded.away_team_id, games.away_team_id),
       home_score=excluded.home_score, away_score=excluded.away_score, notes=coalesce(excluded.notes, games.notes)
     returning id`,
    [s.id, String(ev.id), seasonYear, ev.season?.type ?? null, comp.date ?? ev.date ?? null, status, completed,
     comp.neutralSite ?? false, comp.conferenceCompetition ?? null,
     comp.venue?.fullName ?? null, comp.venue?.address?.city ?? null, comp.venue?.address?.state ?? null,
     comp.attendance ?? null, homeId, awayId, score(home), score(away), notes]);
  return row!.id;
}

// Sweep every date in the season window (through today or `until`). Recent dates are always re-fetched
// because scores and statuses change; older dates come from the cache.
export async function ingestGames(s: SportConfig, seasonYear: number, opts: { until?: Date; refreshDays?: number } = {}) {
  const until = opts.until ?? new Date();
  const refreshDays = opts.refreshDays ?? 3;
  const dates = seasonDates(s, seasonYear, until);
  let games = 0, finals = 0;
  for (const d of dates) {
    const ageDays = (until.getTime() - d.getTime()) / 86_400_000;
    const fresh = ageDays <= refreshDays;
    const sb = await espn.scoreboard(s, yyyymmdd(d), fresh);
    for (const ev of sb?.events ?? []) {
      const id = await upsertGameFromEvent(s, ev, seasonYear);
      if (id) { games++; if (ev.status?.type?.completed) finals++; }
    }
  }
  console.log(`${s.id} ${seasonYear}: ${dates.length} dates swept, ${games} games upserted (${finals} final)`);
}
