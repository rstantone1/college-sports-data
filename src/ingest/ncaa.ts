// NCAA.com adapter (via the public ncaa-api mirror). Used for baseball and softball, where ESPN carries only
// about half the games and no box scores. One scoreboard call per date + one box score call per final game.
import { q, one } from '../db.js';
import { seasonDates, type SportConfig } from '../sports.js';

const BASE = process.env.NCAA_API_BASE ?? 'https://ncaa-api.henrygd.me';
const DELAY = Number(process.env.NCAA_DELAY_MS ?? 260); // mirror allows ~5 req/s per IP
let last = 0;
async function pace() { const w = last + DELAY - Date.now(); if (w > 0) await new Promise((r) => setTimeout(r, w)); last = Date.now(); }

async function get(path: string, attempt = 1): Promise<any> {
  await pace();
  const res = await fetch(`${BASE}/${path}`, { headers: { accept: 'application/json', 'user-agent': 'college-sports-data/0.1' }, signal: AbortSignal.timeout(20000) });  // never hang a run on one slow request
  if (res.status === 404) return null;
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`ncaa ${res.status} after ${attempt} tries: ${path}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt * attempt));
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`ncaa ${res.status}: ${path}`);
  return res.json();
}

async function cached(kind: string, key: string, path: string, fresh: boolean) {
  if (!fresh) {
    const hit = await one<{ payload: any }>(`select payload from raw_payloads where source='ncaa' and kind=$1 and key=$2`, [kind, key]);
    if (hit) return hit.payload;
  }
  const payload = await get(path);
  // History backfills set RAW_CACHE=0: parsed rows are kept, the raw response isn't.
  if (payload != null && process.env.RAW_CACHE !== '0') {
    await q(`insert into raw_payloads(source, kind, key, payload) values ('ncaa',$1,$2,$3)
             on conflict (source, kind, key) do update set payload=excluded.payload, fetched_at=now()`,
      [kind, key, JSON.stringify(payload)]);
  }
  return payload;
}

const ABBR: Record<string, string> = { sec: 'SEC', acc: 'ACC', 'big-ten': 'Big Ten', 'big-12': 'Big 12', 'pac-12': 'Pac-12', 'big-east': 'Big East',
  aac: 'American', 'mid-american': 'MAC', mac: 'MAC', 'mountain-west': 'Mountain West', mwc: 'Mountain West', wcc: 'WCC', wac: 'WAC',
  swac: 'SWAC', meac: 'MEAC', caa: 'CAA', 'coastal': 'CAA', asun: 'ASUN', 'atlantic-sun': 'ASUN', 'atlantic-10': 'A-10', mvc: 'MVC',
  'missouri-valley': 'MVC', 'sun-belt': 'Sun Belt', 'conference-usa': 'C-USA', cusa: 'C-USA', 'big-south': 'Big South', 'big-west': 'Big West',
  'big-sky': 'Big Sky', 'ohio-valley': 'OVC', ovc: 'OVC', 'southern': 'SoCon', socon: 'SoCon', southland: 'Southland', summit: 'Summit',
  'summit-league': 'Summit', horizon: 'Horizon', 'horizon-league': 'Horizon', 'america-east': 'America East', patriot: 'Patriot',
  'ivy-league': 'Ivy', metro: 'MAAC', ivy: 'Ivy', maac: 'MAAC', nec: 'NEC', 'northeast': 'NEC', dii: 'D-II', independent: 'Independent', 'dl-independent': 'Independent' };
// Division II / III / NAIA leagues whose teams show up as non-conference opponents. Not rated as D-I.
const NON_D1 = new Set(['ccs', 'ciaa', 'conference-carolinas', 'g-mac', 'gulf-south', 'little-east', 'lone-star', 'nsic', 'pac', 'peach-belt',
  'sac', 'siac', 'uac-', 'uac', 'dii', 'diii', 'gliac', 'gnac', 'glvc', 'mec', 'rmac', 'ssc', 'ccaa', 'psac', 'cacc', 'ne10', 'northeast-10',
  'eccc', 'gac', 'great-american', 'mountain-east', 'miaa', 'heartland', 'naia', 'nccaa', 'usca', 'east-coast', 'sunshine-state']);
const confName = (seo: string, name?: string) => (name && name.trim()) || ABBR[seo] || seo.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

const logo = (seo: string) => `https://www.ncaa.com/sites/default/files/images/logos/schools/bgl/${seo}.svg`;
const toNum = (v: any) => { const n = Number(String(v ?? '').replace('%', '')); return Number.isFinite(n) ? n : undefined; };
const ip = (v: any) => { const [f, p] = String(v ?? '').split('.').map(Number); return Number.isFinite(f) ? f + (Number.isFinite(p) ? p / 3 : 0) : undefined; };

const teamIds = new Map<string, number>();
async function team(s: SportConfig, t: any, seasonYear: number): Promise<number | null> {
  const seo = t?.names?.seo ?? t?.seoname;
  if (!seo) return null;
  const key = `${s.id}:${seo}`;
  let id = teamIds.get(key);
  if (!id) {
    const name = t.names?.short ?? t.nameShort ?? seo;
    const row = await one<{ id: number }>(
      `insert into teams(sport_id, espn_id, slug, display_name, short_name, mascot, abbreviation, color, logo_url)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (sport_id, espn_id) do update set display_name=excluded.display_name, short_name=excluded.short_name,
         abbreviation=coalesce(excluded.abbreviation, teams.abbreviation), color=coalesce(excluded.color, teams.color),
         mascot=coalesce(excluded.mascot, teams.mascot), logo_url=coalesce(teams.logo_url, excluded.logo_url)
       returning id`,
      [s.id, `ncaa:${seo}`, seo, t.names?.full ?? name, name, t.teamName ?? null, t.names?.char6 ?? t.name6Char ?? null,
       t.color ? String(t.color).replace('#', '') : null, logo(seo)]);
    id = row!.id; teamIds.set(key, id);
  }
  const conf = (t.conferences ?? []).find((c: any) => c?.conferenceSeo && c.conferenceSeo !== 'top-25');
  if (conf && NON_D1.has(conf.conferenceSeo)) return id;
  if (conf) {
    const nm = confName(conf.conferenceSeo, conf.conferenceName);
    const c = await one<{ id: number }>(
      `insert into conferences(sport_id, espn_id, name, short_name) values ($1,$2,$3,$4)
       on conflict (sport_id, espn_id) do update set name=excluded.name, short_name=excluded.short_name returning id`,
      [s.id, `ncaa:${conf.conferenceSeo}`, nm, ABBR[conf.conferenceSeo] ?? nm]);
    await q(`insert into team_seasons(team_id, season_year, conference_id) values ($1,$2,$3)
             on conflict (team_id, season_year) do update set conference_id=excluded.conference_id`, [id, seasonYear, c!.id]);
  }
  return id;
}

const pad = (n: number) => String(n).padStart(2, '0');

export async function ingestNcaaGames(s: SportConfig, seasonYear: number, opts: { until?: Date; refreshDays?: number } = {}) {
  const code = s.id === 'sb' ? 'softball' : 'baseball';
  const until = opts.until ?? new Date();
  const dates = seasonDates(s, seasonYear, until);
  let n = 0, finals = 0;
  for (const d of dates) {
    const y = d.getUTCFullYear(), m = pad(d.getUTCMonth() + 1), dd = pad(d.getUTCDate());
    const fresh = (Date.now() - d.getTime()) / 864e5 <= (opts.refreshDays ?? 3);
    const sb = await cached('scoreboard', `${s.id}:${y}${m}${dd}`, `scoreboard/${code}/d1/${y}/${m}/${dd}/all-conf`, fresh);
    for (const w of sb?.games ?? []) {
      const g = w.game;
      const h = await team(s, g.home, seasonYear), a = await team(s, g.away, seasonYear);
      const final = g.gameState === 'final';
      const score = (x: any) => (x?.score !== '' && x?.score != null ? Number(x.score) : null);
      await q(
        `insert into games(sport_id, espn_id, season_year, season_type, start_time, status, completed, neutral_site, home_team_id, away_team_id, home_score, away_score)
         values ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,$10,$11)
         on conflict (sport_id, espn_id) do update set start_time=excluded.start_time, status=excluded.status, completed=excluded.completed,
           home_score=excluded.home_score, away_score=excluded.away_score, season_type=excluded.season_type`,
        [s.id, `ncaa:${g.gameID}`, seasonYear, /champ|regional|super/i.test(g.bracketRound ?? '') ? 3 : 2,
         g.startTimeEpoch ? new Date(Number(g.startTimeEpoch) * 1000) : new Date(`${y}-${m}-${dd}T17:00:00Z`),
         final ? 'STATUS_FINAL' : g.gameState === 'live' ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED', final,
         h, a, score(g.home), score(g.away)]);
      n++; if (final) finals++;
    }
  }
  console.log(`${s.id} ${seasonYear}: ${dates.length} dates swept, ${n} games upserted (${finals} final)`);
}

export async function ingestNcaaBox(s: SportConfig, seasonYear: number, opts: { limit?: number } = {}) {
  const todo = await q<{ id: number; espn_id: string; home_team_id: number; away_team_id: number }>(
    `select id, espn_id, home_team_id, away_team_id from games where sport_id=$1 and season_year=$2 and completed and box_fetched_at is null
     order by start_time limit $3`, [s.id, seasonYear, opts.limit ?? 100000]);
  let n = 0, missing = 0, next = 0;
  const work = async () => {
    while (next < todo.length) {
      const g = todo[next++];
      try {
        const gid = g.espn_id.replace('ncaa:', '');
        const bx = await cached('summary', `${s.id}:${gid}`, `game/${gid}/boxscore`, false);
        if (!bx?.teamBoxscore) { missing++; await q(`update games set box_fetched_at=now() where id=$1`, [g.id]); continue; }
        const side = new Map<string, number>();
        for (const t of bx.teams ?? []) side.set(String(t.teamId), t.isHome ? g.home_team_id : g.away_team_id);
        const pitched = new Map<number, number>();
        for (const tb of bx.teamBoxscore) {
          const tid = side.get(String(tb.teamId)); if (tid) pitched.set(tid, ip(tb.teamStats?.pitcherTotals?.inningsPitched) ?? NaN);
        }
        for (const tb of bx.teamBoxscore) {
          const tid = side.get(String(tb.teamId)); if (!tid) continue;
          const opp = tid === g.home_team_id ? g.away_team_id : g.home_team_id;
          const bt = tb.teamStats?.batterTotals ?? {}, pt = tb.teamStats?.pitcherTotals ?? {};
          const stats: Record<string, number | undefined> = {
            atBats: toNum(bt.atBats), runs: toNum(bt.runsScored), hits: toNum(bt.hits), rbi: toNum(bt.runsBattedIn),
            walks: toNum(bt.walks), strikeouts: toNum(bt.strikeouts), leftOnBase: toNum(tb.teamStats?.battingStats?.leftOnBase),
            inningsPitched: ip(pt.inningsPitched), hitsAllowed: toNum(pt.hitsAllowed), runsAllowed: toNum(pt.runsAllowed),
            earnedRunsAllowed: toNum(pt.earnedRunsAllowed), walksAllowed: toNum(pt.walksAllowed), strikeoutsPitched: toNum(pt.strikeouts),
            inningsBatted: pitched.get(opp),
          };
          for (const k of Object.keys(stats)) if (stats[k] === undefined || Number.isNaN(stats[k])) delete stats[k];
          await q(`insert into game_team_stats(game_id, team_id, stats) values ($1,$2,$3)
                   on conflict (game_id, team_id) do update set stats=excluded.stats`, [g.id, tid, JSON.stringify(stats)]);

          for (const p of tb.playerStats ?? []) {
            const name = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
            if (!name) continue;
            const key = `ncaa:${tid}:${name.toLowerCase()}`; // NCAA box scores carry no player id; team + name is stable within a season
            const pl = await one<{ id: number }>(
              `insert into players(sport_id, espn_id, display_name) values ($1,$2,$3)
               on conflict (sport_id, espn_id) do update set display_name=excluded.display_name returning id`, [s.id, key, name]);
            await q(`insert into rosters(player_id, team_id, season_year, jersey, position) values ($1,$2,$3,$4,$5)
                     on conflict (player_id, team_id, season_year) do update set jersey=coalesce(excluded.jersey, rosters.jersey),
                       position=coalesce(excluded.position, rosters.position), last_seen=now()`,
              [pl!.id, tid, seasonYear, p.number != null ? String(p.number) : null, p.position ?? null]);
            const groups: [string, any][] = [];
            if (p.batterStats) groups.push(['batting', {
              atBats: toNum(p.batterStats.atBats), runs: toNum(p.batterStats.runsScored), hits: toNum(p.batterStats.hits),
              rbi: toNum(p.batterStats.runsBattedIn), walks: toNum(p.batterStats.walks), strikeouts: toNum(p.batterStats.strikeouts) }]);
            if (p.pitcherStats) groups.push(['pitching', {
              inningsPitched: ip(p.pitcherStats.inningsPitched), hitsAllowed: toNum(p.pitcherStats.hitsAllowed),
              runsAllowed: toNum(p.pitcherStats.runsAllowed), earnedRunsAllowed: toNum(p.pitcherStats.earnedRunsAllowed),
              walksAllowed: toNum(p.pitcherStats.walksAllowed), strikeouts: toNum(p.pitcherStats.strikeouts) }]);
            for (const [grp, st] of groups) {
              for (const k of Object.keys(st)) if (st[k] === undefined) delete st[k];
              await q(`insert into game_player_stats(game_id, team_id, player_id, starter, did_not_play, stat_group, stats)
                       values ($1,$2,$3,$4,$5,$6,$7)
                       on conflict (game_id, player_id, stat_group) do update set stats=excluded.stats, starter=excluded.starter`,
                [g.id, tid, pl!.id, !!p.starter, p.participated === false, grp, JSON.stringify(st)]);
            }
          }
        }
        await q(`update games set box_fetched_at=now() where id=$1`, [g.id]);
        n++;
        if (n % 200 === 0) console.log(`${s.id}: ${n}/${todo.length} box scores`);
      } catch (e) {
        console.warn(`box ${s.id}/${g.espn_id}: ${(e as Error).message}`);
        // A box score that still fails three days after the game isn't coming; stop retrying it every run.
        await q(`update games set box_fetched_at=now() where id=$1 and start_time < now() - interval '3 days'`, [g.id]).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, work));
  console.log(`${s.id} ${seasonYear}: ${n} box scores ingested, ${missing} without a box score`);
}
