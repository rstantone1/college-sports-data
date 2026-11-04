import { migrate, close, q } from './db.js';
import { sport, seasonYearFor, isoDate, SPORTS } from './sports.js';
import { ingestTeams } from './ingest/teams.js';
import { ingestGames } from './ingest/games.js';
import { ingestBoxScores } from './ingest/boxscores.js';
import { ingestRosters } from './ingest/rosters.js';
import { computeRatings, saveRatings } from './ratings/efficiency.js';

const [, , cmd, ...rest] = process.argv;
const args: Record<string, string> = {};
for (const a of rest) { const m = /^--([^=]+)=(.*)$/.exec(a); if (m) args[m[1]] = m[2]; }

function season(sId: string): number {
  return args.season ? Number(args.season) : seasonYearFor(sport(sId), new Date());
}

async function main() {
  switch (cmd) {
    case 'migrate': await migrate(); break;

    case 'ingest:teams': { const s = sport(args.sport); await ingestTeams(s, season(s.id)); break; }
    case 'ingest:games': { const s = sport(args.sport); await ingestGames(s, season(s.id), { until: args.until ? new Date(args.until) : undefined, refreshDays: args.refresh ? Number(args.refresh) : undefined }); break; }
    case 'ingest:box': { const s = sport(args.sport); await ingestBoxScores(s, season(s.id), { plays: args.plays === '1', limit: args.limit ? Number(args.limit) : undefined }); break; }
    case 'ingest:rosters': { const s = sport(args.sport); await ingestRosters(s, season(s.id)); break; }

    // Full daily refresh for one sport: schedule/scores, new box scores, ratings.
    case 'daily': {
      const s = sport(args.sport); const y = season(s.id);
      await ingestTeams(s, y);
      await ingestGames(s, y, { refreshDays: 3 });
      await ingestBoxScores(s, y, { plays: args.plays === '1' });
      const r = await computeRatings(s, y);
      await saveRatings(s, y, isoDate(new Date()), r.ratings);
      console.log(`${s.id} ${y}: ratings saved for ${r.ratings.length} teams (${r.games} games, ${r.skipped} skipped, HCA ${r.hca.toFixed(2)}, league ${r.leagueAvg.toFixed(1)})`);
      break;
    }

    case 'ratings': {
      const s = sport(args.sport); const y = season(s.id);
      const r = await computeRatings(s, y, { priorGames: args.prior ? Number(args.prior) : undefined });
      const asOf = args.asof ?? isoDate(new Date());
      await saveRatings(s, y, asOf, r.ratings);
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
