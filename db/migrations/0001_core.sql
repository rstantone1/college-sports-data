-- Core schema: one set of tables for every sport.
-- Sport-specific stats live in jsonb; the sport config (src/sports.ts) says how to read them.

create table if not exists sports (
  id            text primary key,             -- 'mbb', 'wbb', 'cfb', 'bsb', 'sb', 'msoc', 'wsoc'
  name          text not null,
  espn_path     text not null,                -- 'basketball/mens-college-basketball'
  espn_groups   text,                         -- ESPN "groups" param that means "all D-I" (50 for hoops, 80 FBS)
  scoring_unit  text not null,                -- 'possession' | 'drive' | 'inning' | 'minute'
  season_label  text not null default 'split' -- 'split' (2026-27 -> ESPN year 2027) | 'calendar' (2026)
);

create table if not exists seasons (
  sport_id    text not null references sports(id),
  year        int  not null,                  -- ESPN season year
  start_date  date,
  end_date    date,
  primary key (sport_id, year)
);

create table if not exists conferences (
  id          bigserial primary key,
  sport_id    text not null references sports(id),
  espn_id     text not null,
  name        text,
  short_name  text,
  unique (sport_id, espn_id)
);

create table if not exists teams (
  id              bigserial primary key,
  sport_id        text not null references sports(id),
  espn_id         text not null,
  slug            text,
  display_name    text not null,               -- 'Tennessee Volunteers'
  short_name      text,                        -- 'Tennessee'
  mascot          text,                        -- 'Volunteers'
  abbreviation    text,
  color           text,
  alt_color       text,
  logo_url        text,
  logo_dark_url   text,
  is_active       boolean default true,
  unique (sport_id, espn_id)
);
create index if not exists teams_sport_idx on teams(sport_id);

-- Which conference a team was in for a given season (realignment history lives here).
create table if not exists team_seasons (
  team_id        bigint not null references teams(id),
  season_year    int not null,
  conference_id  bigint references conferences(id),
  primary key (team_id, season_year)
);

create table if not exists players (
  id            bigserial primary key,
  sport_id      text not null references sports(id),
  espn_id       text not null,
  display_name  text not null,
  first_name    text,
  last_name     text,
  unique (sport_id, espn_id)
);

-- Roster membership per team per season. A player with rows on two teams across years is a transfer.
create table if not exists rosters (
  player_id     bigint not null references players(id),
  team_id       bigint not null references teams(id),
  season_year   int not null,
  jersey        text,
  position      text,
  height_in     int,
  weight_lb     int,
  class_year    text,                           -- 'Freshman', 'Senior', 'Graduate'...
  hometown      text,
  home_state    text,
  home_country  text,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  primary key (player_id, team_id, season_year)
);
create index if not exists rosters_team_season_idx on rosters(team_id, season_year);

create table if not exists games (
  id              bigserial primary key,
  sport_id        text not null references sports(id),
  espn_id         text not null,
  season_year     int not null,
  season_type     int,                           -- ESPN: 1 preseason, 2 regular, 3 postseason
  start_time      timestamptz,
  status          text,                          -- 'STATUS_SCHEDULED' | 'STATUS_FINAL' | ...
  completed       boolean not null default false,
  neutral_site    boolean default false,
  conference_game boolean,
  venue_name      text,
  venue_city      text,
  venue_state     text,
  attendance      int,
  home_team_id    bigint references teams(id),
  away_team_id    bigint references teams(id),
  home_score      int,
  away_score      int,
  periods         int,                           -- regulation + OT count as reported
  notes           text,                          -- tournament / event name when present
  box_fetched_at  timestamptz,                   -- null until summary (box score) has been ingested
  unique (sport_id, espn_id)
);
create index if not exists games_sport_season_idx on games(sport_id, season_year, start_time);
create index if not exists games_home_idx on games(home_team_id);
create index if not exists games_away_idx on games(away_team_id);
create index if not exists games_needs_box_idx on games(sport_id) where completed and box_fetched_at is null;

create table if not exists game_team_stats (
  game_id   bigint not null references games(id) on delete cascade,
  team_id   bigint not null references teams(id),
  stats     jsonb not null,                      -- {"fieldGoalsMade":19,"fieldGoalsAttempted":62,...}
  primary key (game_id, team_id)
);

create table if not exists game_player_stats (
  game_id      bigint not null references games(id) on delete cascade,
  team_id      bigint not null references teams(id),
  player_id    bigint not null references players(id),
  starter      boolean,
  did_not_play boolean default false,
  stat_group   text,                             -- 'batting' | 'pitching' for diamond sports; null for hoops
  stats        jsonb not null,
  primary key (game_id, player_id, stat_group)
);
create index if not exists gps_player_idx on game_player_stats(player_id);

create table if not exists plays (
  game_id       bigint not null references games(id) on delete cascade,
  sequence      bigint not null,
  period        int,
  clock         text,
  team_id       bigint references teams(id),
  play_type     text,
  description   text,
  scoring_play  boolean,
  score_value   int,
  home_score    int,
  away_score    int,
  x             numeric,
  y             numeric,
  participants  jsonb,                           -- [{player_id}] resolved where possible
  primary key (game_id, sequence)
);

-- Every raw payload we pull, so parsers can be re-run without re-fetching.
create table if not exists raw_payloads (
  id          bigserial primary key,
  source      text not null,                    -- 'espn'
  kind        text not null,                    -- 'scoreboard' | 'summary' | 'teams' | 'roster'
  key         text not null,                    -- e.g. 'mbb:2026-11-03' or 'mbb:401906848'
  fetched_at  timestamptz not null default now(),
  payload     jsonb not null,
  unique (source, kind, key)
);

-- Team ratings, one row per team per rating date, so history is kept.
create table if not exists ratings (
  sport_id       text not null references sports(id),
  season_year    int not null,
  team_id        bigint not null references teams(id),
  as_of          date not null,
  model_version  text not null,
  games_played   int not null,
  adj_off        numeric,                        -- points per 100 scoring units, opponent-adjusted
  adj_def        numeric,
  adj_em         numeric,                        -- adj_off - adj_def
  tempo          numeric,                        -- scoring units per regulation game
  raw_off        numeric,
  raw_def        numeric,
  rank           int,
  off_rank       int,
  def_rank       int,
  primary key (sport_id, season_year, team_id, as_of, model_version)
);
create index if not exists ratings_latest_idx on ratings(sport_id, season_year, as_of desc);

create table if not exists schema_migrations (
  name        text primary key,
  applied_at  timestamptz not null default now()
);
