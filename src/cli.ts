import { migrate, close, q } from './db.js';
import { sport, seasonYearFor, isoDate, SPORTS } from './sports.js';
import { ingestTeams } from './ingest/teams.js';
import { ingestGames } from './ingest/games.js';
import { ingestBoxScores } from './ingest/boxscores.js';
import { ingestRosters } from './ingest/rosters.js';
import { computeRatings, saveRatings } from './ratings/efficiency.js';
import { ingestNcaaGames, ingestNcaaBox } from './ingest/ncaa.js';
import { ensureSport } from './ingest/teams.js';
import type { SportConfig } from './sports.js';

// Baseball and softball come from NCAA.com; everything else from ESPN.
const isNcaa = (s: SportConfig) => s.id === 'bsb' || s.id === 'sb';
const teamsFor = async (s: SportConfig, y: number) => { if (isNcaa(s)) await ensureSport(s); else await ingestTeams(s, y); };
const gamesFor = (s: SportConfig, y: number, o: { until?: Date; refreshDays?: number }) => (isNcaa(s) ? ingestNcaaGames(s, y, o) : ingestGames(s, y, o));
const boxFor = (s: SportConfig, y: number, o: { plays?: boolean; limit?: number }) => (isNcaa(s) ? ingestNcaaBox(s, y, o) : ingestBoxScores(s, y, o));

const [, , cmd, ...rest] = process.argv;
const args: Record<string, string> = {};
for (const a of rest) { const m = /^--([^=]+)=(.*)$/.exec(a); if (m) args[m[1]] = m[2]; }

function season(sId: string): number {
  return args.season ? Number(args.season) : seasonYearFor(sport(sId), new Date());
}

async function main() {
  switch (cmd) {
    case 'migrate': await migrate(); break;

    case 'ingest:teams': { const s = sport(args.sport); await teamsFor(s, season(s.id)); break; }
    case 'ingest:games': { const s = sport(args.sport); await gamesFor(s, season(s.id), { until: args.until ? new Date(args.until) : undefined, refreshDays: args.refresh ? Number(args.refresh) : undefined }); break; }
    case 'ingest:box': { const s = sport(args.sport); await boxFor(s, season(s.id), { plays: args.plays === '1', limit: args.limit ? Number(args.limit) : undefined }); break; }
    case 'ingest:rosters': { const s = sport(args.sport); await ingestRosters(s, season(s.id)); break; }

    // Full daily refresh for one sport: schedule/scores, new box scores, ratings.
    case 'daily': {
      const s = sport(args.sport); const y = season(s.id);
      await teamsFor(s, y);
      await gamesFor(s, y, { refreshDays: 3 });
      await boxFor(s, y, { plays: args.plays === '1' });
      const r = await computeRatings(s, y);
      // Off-season: stamp ratings with the last game date instead of today, so history doesn't fill with copies.
      const lastGame = (await q<{ d: string | null }>(`select max(start_time)::date::text d from games where sport_id=$1 and season_year=$2 and completed`, [s.id, y]))[0]?.d;
      const today = isoDate(new Date());
      await saveRatings(s, y, lastGame && lastGame < today ? lastGame : today, r.ratings);
      try { await q(`select refresh_rollups()`); } catch (e) { console.warn('rollup refresh skipped:', (e as Error).message); }
      console.log(`${s.id} ${y}: ratings saved for ${r.ratings.length} teams (${r.games} games, ${r.skipped} skipped, HCA ${r.hca.toFixed(2)}, league ${r.leagueAvg.toFixed(1)})`);
      break;
    }

    // Finish any unprocessed box scores from the previous season, then re-rate it as of its last game.
    case 'catchup': {
      const s = sport(args.sport); const y = season(s.id) - 1;
      const left = await q<{ c: string }>(`select count(*) c from games where sport_id=$1 and season_year=$2 and completed and box_fetched_at is null`, [s.id, y]);
      const n = Number(left[0].c);
      console.log(`${s.id} ${y}: ${n} box scores outstanding`);
      if (n === 0) break;
      await boxFor(s, y, { plays: args.plays === '1', limit: Number(args.limit ?? 2500) });
      const last = await q<{ d: string }>(`select max(start_time)::date::text d from games where sport_id=$1 and season_year=$2 and completed`, [s.id, y]);
      const r = await computeRatings(s, y);
      await saveRatings(s, y, last[0].d, r.ratings);
      try { await q(`select refresh_rollups()`); } catch { /* local db */ }
      console.log(`${s.id} ${y}: re-rated ${r.ratings.length} teams as of ${last[0].d}`);
      break;
    }

    case 'ratings': {
      const s = sport(args.sport); const y = season(s.id);
      const r = await computeRatings(s, y, { priorGames: args.prior ? Number(args.prior) : undefined });
      const asOf = args.asof ?? isoDate(new Date());
      await saveRatings(s, y, asOf, r.ratings);
      try { await q(`select refresh_rollups()`); } catch (e) { console.warn('rollup refresh skipped:', (e as Error).message); }
      console.log(`${s.id} ${y}: ${r.ratings.length} teams rated from ${r.games} games (${r.skipped} skipped). League eff ${r.leagueAvg.toFixed(1)}, home adv ${r.hca.toFixed(2)} per side.`);
      break;
    }

    case 'top': {
      const s = sport(args.sport); const y = season(s.id); const n = Number(args.n ?? 25);
      const rows = await q(
        `select r.rank, t.short_name, c.short_name conf, r.games_played gp, round(r.adj_em,1) em, round(r.adj_off,1) o, r.off_rank "o#", round(r.adj_def,1) d, r.def_rank "d#", round(r.tempo,1) t
         from ratings r join teams t on t.id=r.team_id
         left join team_seasons ts on ts.team_id=t.id and ts.season_year=r.season_year left join conferences c on c.id=ts.conference_id
         where r.sport_id=$1 and r.season_year=$2 and r.as_of=(select max(as_of) from ratings where sport_id=$1 and season_year=$2)
         order by r.rank limit $3`, [s.id, y, n]);
      console.table(rows);
      break;
    }

    case 'status': {
      const rows = await q(
        `select s.id sport, g.season_year season, count(*) games, count(*) filter (where g.completed) final,
                count(*) filter (where g.box_fetched_at is not null) boxed,
                (select count(*) from teams t where t.sport_id=s.id) teams,
                (select count(*) from players p where p.sport_id=s.id) players
         from sports s left join games g on g.sport_id=s.id group by 1,2 order by 1,2`);
      console.table(rows);
      break;
    }

    default:
      console.log(`commands:
  migrate
  ingest:teams   --sport=mbb [--season=2027]
  ingest:games   --sport=mbb [--season=2027] [--until=YYYY-MM-DD] [--refresh=3]
  ingest:box     --sport=mbb [--season=2027] [--plays=1] [--limit=N]
  ingest:rosters --sport=mbb [--season=2027]
  ratings        --sport=mbb [--season=2027] [--prior=6] [--asof=YYYY-MM-DD]
  daily          --sport=mbb [--plays=1]
  top            --sport=mbb [--n=25]
  status
sports: ${Object.keys(SPORTS).join(', ')}`);
  }
}

main().then(() => close()).catch(async (e) => { console.error(e); await close(); process.exit(1); });
