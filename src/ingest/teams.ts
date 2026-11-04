import { q, one } from '../db.js';
import { espn } from '../espn.js';
import type { SportConfig } from '../sports.js';

export async function ensureSport(s: SportConfig) {
  await q(
    `insert into sports(id, name, espn_path, espn_groups, scoring_unit, season_label)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (id) do update set name=excluded.name, espn_path=excluded.espn_path,
       espn_groups=excluded.espn_groups, scoring_unit=excluded.scoring_unit, season_label=excluded.season_label`,
    [s.id, s.name, s.espnPath, s.espnGroups ?? null, s.scoringUnit, s.seasonLabel]);
}

export async function upsertTeam(s: SportConfig, t: any): Promise<number> {
  const logos: any[] = t.logos ?? [];
  const pick = (rel: string) => logos.find((l) => (l.rel ?? []).includes(rel))?.href;
  const row = await one<{ id: number }>(
    `insert into teams(sport_id, espn_id, slug, display_name, short_name, mascot, abbreviation, color, alt_color, logo_url, logo_dark_url, is_active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (sport_id, espn_id) do update set
       slug=coalesce(excluded.slug, teams.slug), display_name=excluded.display_name,
       short_name=coalesce(excluded.short_name, teams.short_name), mascot=coalesce(excluded.mascot, teams.mascot),
       abbreviation=coalesce(excluded.abbreviation, teams.abbreviation), color=coalesce(excluded.color, teams.color),
       alt_color=coalesce(excluded.alt_color, teams.alt_color), logo_url=coalesce(excluded.logo_url, teams.logo_url),
       logo_dark_url=coalesce(excluded.logo_dark_url, teams.logo_dark_url), is_active=excluded.is_active
     returning id`,
    [s.id, String(t.id), t.slug ?? null, t.displayName ?? t.name ?? `Team ${t.id}`, t.location ?? t.shortDisplayName ?? null,
     t.name ?? null, t.abbreviation ?? null, t.color ?? null, t.alternateColor ?? null,
     pick('default') ?? logos[0]?.href ?? t.logo ?? null, pick('dark') ?? t.logoDark ?? null, t.isActive ?? true]);
  return row!.id;
}

// Loads the full D-I team list and, via standings, each team's conference for the season.
export async function ingestTeams(s: SportConfig, seasonYear: number) {
  await ensureSport(s);
  const data = await espn.teams(s);
  const teams: any[] = data?.sports?.[0]?.leagues?.[0]?.teams?.map((x: any) => x.team) ?? [];
  const idByEspn = new Map<string, number>();
  for (const t of teams) idByEspn.set(String(t.id), await upsertTeam(s, t));
  console.log(`${s.id}: ${teams.length} teams upserted`);

  let withConf = 0;
  try {
    const st = await espn.standings(s, seasonYear);
    const children: any[] = st?.children ?? [];
    for (const c of children) {
      const conf = await one<{ id: number }>(
        `insert into conferences(sport_id, espn_id, name, short_name) values ($1,$2,$3,$4)
         on conflict (sport_id, espn_id) do update set name=excluded.name, short_name=excluded.short_name returning id`,
        [s.id, String(c.id), c.name ?? null, c.shortName ?? c.abbreviation ?? null]);
      for (const e of c.standings?.entries ?? []) {
        const espnId = String(e.team?.id);
        let teamId = idByEspn.get(espnId);
        if (!teamId && e.team) { teamId = await upsertTeam(s, e.team); idByEspn.set(espnId, teamId); }
        if (!teamId) continue;
        await q(
          `insert into team_seasons(team_id, season_year, conference_id) values ($1,$2,$3)
           on conflict (team_id, season_year) do update set conference_id=excluded.conference_id`,
          [teamId, seasonYear, conf!.id]);
        withConf++;
      }
    }
    console.log(`${s.id}: ${children.length} conferences, ${withConf} team-season memberships for ${seasonYear}`);
  } catch (e) {
    console.warn(`${s.id}: standings unavailable (${(e as Error).message}); conference membership skipped`);
  }
  await q(`insert into seasons(sport_id, year) values ($1,$2) on conflict do nothing`, [s.id, seasonYear]);
}
