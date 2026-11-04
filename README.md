# college-sports-data

Working name. A cross-sport, men's-and-women's college sports data layer: schedules, results, box scores,
rosters, play-by-play, and opponent-adjusted ratings, with one adapter and one schema for every sport.

This is the foundation. The consumer site, the API for media, and the athlete-side tools are built on top of it.

## What's here

```
db/migrations/0001_core.sql   schema (sport-agnostic; sport-specific stats live in jsonb)
src/sports.ts                 the sport registry: ESPN path, season window, scoring unit, how to count units
src/espn.ts                   polite ESPN JSON client with a raw-payload cache (nothing is fetched twice)
src/ingest/teams.ts           teams + conferences + season membership (realignment history)
src/ingest/games.ts           schedule and scores, swept by date across the season window
src/ingest/boxscores.ts       team and player box scores, rosters-from-boxes, optional play-by-play
src/ingest/rosters.ts         official rosters: height, weight, class, hometown
src/ratings/efficiency.ts     opponent-adjusted efficiency ratings (aeff-v1)
src/cli.ts                    commands
```

## Sports

| id   | sport              | scoring unit | status |
|------|--------------------|--------------|--------|
| mbb  | Men's basketball   | possession   | live: 2026-27 ingesting; 2025-26 backfilled for validation |
| wbb  | Women's basketball | possession   | live: 2026-27 ingesting; 2025-26 backfilled for validation |
| cfb  | Football           | drive        | adapter written, not yet run |
| bsb  | Baseball           | inning       | adapter written; season starts Feb |
| sb   | Softball           | inning       | adapter written; season starts Feb |
| msoc | Men's soccer       | minute       | adapter written; box scores thin on ESPN |
| wsoc | Women's soccer     | minute       | adapter written; box scores thin on ESPN |

Adding a sport is one entry in `src/sports.ts`.

## Data source

ESPN's public JSON (`site.api.espn.com`) is the single adapter for all seven sports: scoreboard by date,
teams, standings (conference membership by season), game summaries (team box, player box, play-by-play with
shot coordinates for basketball, drives for football), and rosters. Every response is trimmed and cached in
`raw_payloads` so parsers can be re-run without re-fetching.

Known limits: it's unofficial (no SLA; paced at ~3 requests/second with retries); low-major baseball/softball
games sometimes have no box score; soccer has scores but little else. `stats.ncaa.org` is the planned
fallback for gaps. CollegeFootballData (free API key) is an optional second source for football/men's hoops.

Facts (scores, stats) aren't copyrightable. Logos and headshots are trademarks/likenesses; the schema stores
logo URLs for development but the public product should use licensed or text-first treatments.

## Ratings (aeff-v1)

Each team-game yields an offensive efficiency (points per scoring unit, scaled per 100 possessions / 10 drives
/ 9 innings / 90 minutes) and the opponent's mirror as defense. Iterate: a team's adjusted offense is its
average efficiency scaled by each opponent's adjusted defense, and vice versa, until stable. Home advantage is
re-estimated each pass from the strength-adjusted residual in home games (prior worth ~2000 home games, so
buy-game-heavy Novembers don't inflate it). Early-season shrinkage: a league-average prior worth 6 games.
Only games between teams with conference membership that season count (drops exhibitions and non-D-I).
Tempo is scoring units per regulation game, opponent-adjusted.

Roadmap for v2: preseason priors from last season's rating + returning production, recency weighting,
win probability and projected records, bracketology.

## Run it

```bash
cp .env.example .env            # set DATABASE_URL
npm install
npm run db:migrate
npx tsx src/cli.ts ingest:teams --sport=mbb
npx tsx src/cli.ts ingest:games --sport=mbb
npx tsx src/cli.ts ingest:box   --sport=mbb --plays=1
npx tsx src/cli.ts ratings      --sport=mbb
npx tsx src/cli.ts top          --sport=mbb --n=25
npx tsx src/cli.ts status
```

Daily refresh (schedule + scores + new box scores + ratings): `npx tsx src/cli.ts daily --sport=mbb --plays=1`.
Run it per sport from a scheduler (GitHub Actions cron, Netlify scheduled function, or a Supabase cron + edge
function) every few hours during the season.

Backfill a past season: `--season=2026 --until=2026-04-10` on `ingest:games`, then `ingest:box`, then `ratings --asof=2026-04-10`.

## Storage

About 53 KB of trimmed raw cache per game plus parsed rows. A basketball season is ~5,800 games, so roughly
300–400 MB per sport-season including play-by-play. Postgres anywhere (local, Supabase, Neon). The raw cache
can move to object storage if the database gets expensive.
