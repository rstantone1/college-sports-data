-- Betting lines, line movement, flagged bets, player props and projections. Idempotent (safe to re-run).

-- 1. Every book's pregame line for a game, by phase. Spread is from the home team's view (negative = home
--    favored), the same convention as games.spread. Prices are American odds.
create table if not exists game_lines (
  game_id           bigint not null references games(id) on delete cascade,
  source            text not null,   -- espn (core odds feed), pickcenter (old ESPN summaries), cfbd, cbbd, oddsapi
  book              text not null,   -- lowercased book name: draftkings, espn bet, consensus, bovada, fanduel ...
  phase             text not null check (phase in ('open', 'close', 'current')),
  spread            numeric,
  home_spread_price int,
  away_spread_price int,
  total             numeric,
  over_price        int,
  under_price       int,
  home_ml           int,
  away_ml           int,
  updated_at        timestamptz not null default now(),
  primary key (game_id, source, book, phase)
);
create index if not exists game_lines_game_idx on game_lines (game_id);

-- 2. Each change we see in a book's current line, so movement can be studied from here on.
create table if not exists line_snapshots (
  game_id           bigint not null references games(id) on delete cascade,
  source            text not null,
  book              text not null,
  taken_at          timestamptz not null default now(),
  spread            numeric,
  home_spread_price int,
  away_spread_price int,
  total             numeric,
  over_price        int,
  under_price       int,
  home_ml           int,
  away_ml           int,
  primary key (game_id, source, book, taken_at)
);

-- 3. The game's market line summarised: games.spread / games.total stay the closing (or latest) line;
--    these add the opener and a quality flag from the cleaning pass.
alter table games add column if not exists spread_open numeric,
                  add column if not exists total_open  numeric,
                  add column if not exists line_books  int,      -- how many books the summary line came from
                  add column if not exists line_flag   text,     -- null = fine, corrected = favorite fixed, dropped = unusable
                  add column if not exists home_ml     int,      -- closing moneylines (median of books)
                  add column if not exists away_ml     int,
                  add column if not exists lines_checked_at timestamptz;

-- 4. Bets we flag. Written before the game starts and never changed, except the grading columns.
create table if not exists bet_picks (
  id            bigserial primary key,
  sport_id      text not null,
  season_year   int not null,
  game_id       bigint not null references games(id) on delete cascade,
  kind          text not null default 'live',   -- live = flagged before the game; replay = backtest on a past season
  market        text not null check (market in ('spread', 'total', 'moneyline', 'prop')),
  side          text not null,                  -- home | away | over | under
  player_id     bigint,                         -- props only
  stat          text,                           -- props only
  line          numeric,                        -- the number at the time we flagged it
  price         int,                            -- American odds at that time (null = assume -110)
  book          text,
  our_number    numeric,                        -- our margin (home view), our total, or our player projection
  edge          numeric,                        -- points of disagreement in our side's favor
  cover_prob    numeric,                        -- our estimated chance this side wins the bet
  tier          text,                           -- best | strong | lean
  reasons       jsonb not null default '[]',    -- [{ "key": "...", "text": "..." }]
  model_version text not null,
  made_at       timestamptz not null default now(),
  close_line    numeric,
  close_price   int,
  clv           numeric,                        -- points the line moved our way by the close (positive = good)
  result        text check (result in ('win', 'loss', 'push', 'void')),
  graded_at     timestamptz,
  unique nulls not distinct (game_id, kind, market, player_id, stat)
);
create index if not exists bet_picks_sport_idx on bet_picks (sport_id, season_year, kind);
create index if not exists bet_picks_made_idx on bet_picks (made_at desc);

-- 5. Player prop lines from books (none in ESPN's feed for college; filled when a props source is connected).
create table if not exists prop_lines (
  game_id     bigint not null references games(id) on delete cascade,
  source      text not null,
  book        text not null,
  player_name text not null,
  player_id   bigint,                          -- matched to players.id when the name matches the roster
  stat        text not null,                   -- points, rebounds, assists, threes, pass_yds, rush_yds, rec_yds, receptions
  line        numeric not null,
  over_price  int,
  under_price int,
  taken_at    timestamptz not null default now(),
  primary key (game_id, source, book, player_name, stat, taken_at)
);

-- 6. Our projection for each player's stat line, written before the game.
create table if not exists player_projections (
  game_id       bigint not null references games(id) on delete cascade,
  player_id     bigint not null,
  team_id       bigint,
  kind          text not null default 'live',
  stat          text not null,
  projection    numeric not null,
  sd            numeric,
  minutes       numeric,
  model_version text not null,
  made_at       timestamptz not null default now(),
  primary key (game_id, player_id, stat, kind)
);

-- Read access for the site. Writes happen only from the data jobs (service connection).
do $$
declare t text;
begin
  foreach t in array array['game_lines', 'line_snapshots', 'bet_picks', 'prop_lines', 'player_projections'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'public_read') then
      execute format('create policy public_read on %I for select using (true)', t);
    end if;
  end loop;
end $$;
