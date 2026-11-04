import { q, one } from '../db.js';
import { espn, parseStat } from '../espn.js';
import type { SportConfig } from '../sports.js';

const playerCache = new Map<string, number>();
async function playerId(s: SportConfig, a: any): Promise<number | null> {
  if (!a?.id) return null;
  const k = `${s.id}:${a.id}`;
  if (playerCache.has(k)) return playerCache.get(k)!;
  const row = await one<{ id: number }>(
    `insert into players(sport_id, espn_id, display_name, first_name, last_name) values ($1,$2,$3,$4,$5)
     on conflict (sport_id, espn_id) do update set display_name=excluded.display_name,
       first_name=coalesce(excluded.first_name, players.first_name), last_name=coalesce(excluded.last_name, players.last_name)
     returning id`,
    [s.id, String(a.id), a.displayName ?? a.shortName ?? `Player ${a.id}`, a.firstName ?? null, a.lastName ?? null]);
  playerCache.set(k, row!.id);
  return row!.id;
}

// Flatten ESPN's team statistics list (flat or grouped) into {key: number}.
function teamStats(statistics: any[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const st of statistics ?? []) {
    if (Array.isArray(st.stats)) {
      for (const inner of st.stats) Object.assign(out, parseStat(inner.name, inner.displayValue ?? String(inner.value ?? '')));
    } else if (st.name) {
      Object.assign(out, parseStat(st.name, st.displayValue ?? String(st.value ?? '')));
    }
  }
  return out;
}

function playerStats(keys: string[], values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  keys.forEach((k, i) => {
    const v = values[i];
    if (k === 'fullInnings.partInnings') {           // pitching IP like "6.1" = 6 and 1/3
      const [f, p] = String(v ?? '').split('.').map(Number);
      if (Number.isFinite(f)) out['inningsPitched'] = f + (Number.isFinite(p) ? p / 3 : 0);
      return;
    }
    Object.assign(out, parseStat(k, v));
  });
  return out;
}

export interface BoxOptions { plays?: boolean }

// Pregame lines. ESPN's pickcenter lists several providers: the market ("consensus" through 2022, then a named
// sportsbook) and model projections (numberfire, teamrankings). We keep the whole list and pull out the market
// line as the home-team spread (negative = home favored) and the total.
const MARKET = ['consensus', 'draftkings', 'espn bet', 'caesars', 'bet365', 'fanduel', 'westgate', 'william hill', 'pointsbet', 'betmgm', 'unibet'];
export function parseOdds(sum: any): { raw: any[] | null; spread: number | null; total: number | null; provider: string | null } {
  const pc: any[] = Array.isArray(sum?.pickcenter) ? sum.pickcenter : [];
  if (!pc.length) return { raw: null, spread: null, total: null, provider: null };
  const raw = pc.map((x) => ({
    provider: x.provider?.name ?? null, spread: x.spread ?? null, overUnder: x.overUnder ?? null, details: x.details ?? null,
    homeFavorite: x.homeTeamOdds?.favorite ?? null, homeML: x.homeTeamOdds?.moneyLine ?? null, awayML: x.awayTeamOdds?.moneyLine ?? null,
  }));
  const rank = (n: string | null) => { const i = MARKET.indexOf((n ?? '').toLowerCase()); return i < 0 ? 99 : i; };
  const m = [...raw].filter((x) => x.spread != null || x.overUnder != null).sort((a, b) => rank(a.provider) - rank(b.provider))[0];
  if (!m || rank(m.provider) === 99) return { raw, spread: null, total: null, provider: null };
  let spread: number | null = m.spread == null ? null : Number(m.spread);
  if (spread != null) {
    // ESPN's spread is from the home team's view, but be defensive: the favorite flag is authoritative when present.
    if (m.homeFavorite === true && spread > 0) spread = -spread;
    if (m.homeFavorite === false && spread < 0) spread = -spread;
  }
  return { raw, spread, total: m.overUnder == null ? null : Number(m.overUnder), provider: m.provider };
}

// Refetch summaries for games that have no line stored yet and save only the odds. Used once to fill in games
// ingested before odds were kept; ingestBoxScore handles it for everything after.
export async function ingestOdds(s: SportConfig, seasonYear: number, opts: { limit?: number } = {}) {
  const todo = await q<{ id: number; espn_id: string }>(
    `select id, espn_id from games where sport_id=$1 and season_year=$2 and completed and odds is null
     order by start_time limit $3`, [s.id, seasonYear, opts.limit ?? 100000]);
  let n = 0, found = 0, failed = 0, next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const g = todo[next++];
      try {
        const sum = await espn.summary(s, g.espn_id, true);
        const o = parseOdds(sum);
        // Mark looked-at games with an empty array so they aren't refetched forever.
        await q(`update games set odds=$2, spread=$3, total=$4, odds_provider=$5 where id=$1`,
          [g.id, JSON.stringify(o.raw ?? []), o.spread, o.total, o.provider]);
        n++; if (o.spread != null) found++;
      } catch (e) { failed++; console.warn(`odds ${s.id}/${g.espn_id}: ${(e as Error).message}`); }
      if (n % 200 === 0 && n) console.log(`${s.id}: ${n}/${todo.length} checked, ${found} with a line`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`${s.id} ${seasonYear}: ${n} games checked, ${found} with a market line, ${failed} failed`);
}

export async function ingestBoxScore(s: SportConfig, gameRow: { id: number; espn_id: string }, opts: BoxOptions = {}) {
  const sum = await espn.summary(s, gameRow.espn_id);
  const comp = sum?.header?.competitions?.[0];
  const competitors: any[] = comp?.competitors ?? [];
  const teamIds = new Map<string, number>();
  for (const c of competitors) {
    const t = await one<{ id: number }>(`select id from teams where sport_id=$1 and espn_id=$2`, [s.id, String(c.team?.id ?? c.id)]);
    if (t) teamIds.set(String(c.team?.id ?? c.id), t.id);
  }

  // Game-level details that only the summary has.
  const gi = sum?.gameInfo;
  const odds = parseOdds(sum);
  await q(
    `update games set venue_name=coalesce($2, venue_name), venue_city=coalesce($3, venue_city), venue_state=coalesce($4, venue_state),
       attendance=coalesce($5, attendance), periods=coalesce($6, periods), season_type=coalesce($7, season_type),
       neutral_site=coalesce($8, neutral_site), conference_game=coalesce($9, conference_game),
       odds=coalesce($10, odds), spread=coalesce($11, spread), total=coalesce($12, total), odds_provider=coalesce($13, odds_provider) where id=$1`,
    [gameRow.id, gi?.venue?.fullName ?? null, gi?.venue?.address?.city ?? null, gi?.venue?.address?.state ?? null,
     gi?.attendance ?? comp?.attendance ?? null,
     competitors[0]?.linescores?.length ?? null, sum?.header?.season?.type ?? null,
     comp?.neutralSite ?? null, comp?.conferenceCompetition ?? null,
     odds.raw ? JSON.stringify(odds.raw) : null, odds.spread, odds.total, odds.provider]);

  // Team box score.
  for (const t of sum?.boxscore?.teams ?? []) {
    const tid = teamIds.get(String(t.team?.id));
    if (!tid) continue;
    const stats = teamStats(t.statistics);
    const c = competitors.find((x) => String(x.team?.id ?? x.id) === String(t.team.id));
    if (c?.linescores?.length) {
      // Diamond sports: innings batted = linescore entries (handles walk-offs and 7-inning run rules).
      if (s.scoringUnit === 'inning') stats['inningsBatted'] = c.linescores.length;
      stats['periods'] = c.linescores.length;
    }
    if (Object.keys(stats).length === 0) continue;
    await q(
      `insert into game_team_stats(game_id, team_id, stats) values ($1,$2,$3)
       on conflict (game_id, team_id) do update set stats=excluded.stats`,
      [gameRow.id, tid, JSON.stringify(stats)]);
  }

  // Football drives -> stats.drives per team.
  if (s.scoringUnit === 'drive') {
    const drives: any[] = sum?.drives?.previous ?? [];
    const count = new Map<number, number>();
    for (const d of drives) {
      if (/END OF (HALF|GAME)/i.test(d.result ?? '')) continue;   // kneel-downs aren't real possessions
      const tid = teamIds.get(String(d.team?.id));
      if (tid) count.set(tid, (count.get(tid) ?? 0) + 1);
    }
    for (const [tid, n] of count) {
      await q(`insert into game_team_stats(game_id, team_id, stats) values ($1,$2,$3)
               on conflict (game_id, team_id) do update set stats = game_team_stats.stats || excluded.stats`,
        [gameRow.id, tid, JSON.stringify({ drives: n })]);
    }
  }

  // Player box score (+ roster membership for the season). Batched: a few round trips per game.
  const seasonYear = sum?.header?.season?.year;
  type Row = { tid: number; a: any; group: string; keys: string[] };
  const rows: Row[] = [];
  for (const side of sum?.boxscore?.players ?? []) {
    const tid = teamIds.get(String(side.team?.id));
    if (!tid) continue;
    for (const group of side.statistics ?? []) {
      for (const a of group.athletes ?? []) if (a.athlete?.id) rows.push({ tid, a, group: group.type ?? group.name ?? 'box', keys: group.keys ?? group.names ?? [] });
    }
  }
  if (rows.length) {
    const uniq = new Map<string, any>();
    for (const r of rows) uniq.set(String(r.a.athlete.id), r.a.athlete);
    const athletes = [...uniq.values()];
    const pv: unknown[] = [];
    const ph = athletes.map((a, i) => {
      pv.push(s.id, String(a.id), a.displayName ?? a.shortName ?? `Player ${a.id}`, a.firstName ?? null, a.lastName ?? null);
      return `($${i * 5 + 1},$${i * 5 + 2},$${i * 5 + 3},$${i * 5 + 4},$${i * 5 + 5})`;
    }).join(',');
    const ids = await q<{ id: number; espn_id: string }>(
      `insert into players(sport_id, espn_id, display_name, first_name, last_name) values ${ph}
       on conflict (sport_id, espn_id) do update set display_name=excluded.display_name,
         first_name=coalesce(excluded.first_name, players.first_name), last_name=coalesce(excluded.last_name, players.last_name)
       returning id, espn_id`, pv);
    const pidOf = new Map(ids.map((r) => [r.espn_id, r.id]));

    const sv: unknown[] = [];
    const seen = new Set<string>();
    const sh: string[] = [];
    for (const r of rows) {
      const pid = pidOf.get(String(r.a.athlete.id)); if (!pid) continue;
      const k = `${pid}:${r.group}`; if (seen.has(k)) continue; seen.add(k);
      const dnp = !!r.a.didNotPlay || (r.a.stats ?? []).length === 0;
      const b = sv.length;
      sv.push(gameRow.id, r.tid, pid, r.a.starter ?? null, dnp, r.group, JSON.stringify(dnp ? {} : playerStats(r.keys, r.a.stats)));
      sh.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
    }
    if (sh.length) await q(
      `insert into game_player_stats(game_id, team_id, player_id, starter, did_not_play, stat_group, stats) values ${sh.join(',')}
       on conflict (game_id, player_id, stat_group) do update set team_id=excluded.team_id, starter=excluded.starter,
         did_not_play=excluded.did_not_play, stats=excluded.stats`, sv);

    if (seasonYear) {
      const rv: unknown[] = []; const rh: string[] = []; const rs = new Set<string>();
      for (const r of rows) {
        const pid = pidOf.get(String(r.a.athlete.id)); if (!pid) continue;
        const k = `${pid}:${r.tid}`; if (rs.has(k)) continue; rs.add(k);
        const b = rv.length;
        rv.push(pid, r.tid, seasonYear, r.a.athlete?.jersey ?? null, r.a.athlete?.position?.abbreviation ?? null);
        rh.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
      }
      if (rh.length) await q(
        `insert into rosters(player_id, team_id, season_year, jersey, position) values ${rh.join(',')}
         on conflict (player_id, team_id, season_year) do update set
           jersey=coalesce(excluded.jersey, rosters.jersey), position=coalesce(excluded.position, rosters.position), last_seen=now()`, rv);
    }
  }

  // Play-by-play (basketball has shot coordinates). Off by default: big.
  if (opts.plays && Array.isArray(sum?.plays) && sum.plays.length) {
    const prow: any[] = [];
    for (const p of sum.plays) {
      const tid = p.team?.id ? teamIds.get(String(p.team.id)) ?? null : null;
      prow.push([gameRow.id, Number(p.sequenceNumber ?? p.id), p.period?.number ?? null, p.clock?.displayValue ?? null, tid,
        p.type?.text ?? null, p.text ?? null, !!p.scoringPlay, p.scoreValue ?? null, p.homeScore ?? null, p.awayScore ?? null,
        p.coordinate?.x ?? null, p.coordinate?.y ?? null,
        JSON.stringify((p.participants ?? []).map((x: any) => ({ espn_id: x.athlete?.id })))]);
    }
    // batched multi-row insert
    const cols = 14;
    for (let i = 0; i < prow.length; i += 500) {
      const chunk = prow.slice(i, i + 500);
      const values = chunk.map((_, r) => `(${Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}`).join(',')})`).join(',');
      await q(
        `insert into plays(game_id, sequence, period, clock, team_id, play_type, description, scoring_play, score_value, home_score, away_score, x, y, participants)
         values ${values} on conflict (game_id, sequence) do nothing`, chunk.flat());
    }
  }

  await q(`update games set box_fetched_at=now() where id=$1`, [gameRow.id]);
}

// Box scores for every completed game that doesn't have one yet.
export async function ingestBoxScores(s: SportConfig, seasonYear: number, opts: BoxOptions & { limit?: number } = {}) {
  const todo = await q<{ id: number; espn_id: string }>(
    `select id, espn_id from games where sport_id=$1 and season_year=$2 and completed and box_fetched_at is null
     order by start_time limit $3`, [s.id, seasonYear, opts.limit ?? 100000]);
  let n = 0, failed = 0, next = 0;
  // Several games in flight: ESPN requests stay paced globally, database writes overlap.
  const worker = async () => {
    while (next < todo.length) {
      const g = todo[next++];
      try { await ingestBoxScore(s, g, opts); n++; }
      catch (e) { failed++; console.warn(`box ${s.id}/${g.espn_id}: ${(e as Error).message}`); }
      if (n % 100 === 0 && n) console.log(`${s.id}: ${n}/${todo.length} box scores`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`${s.id} ${seasonYear}: ${n} box scores ingested, ${failed} failed`);
}
