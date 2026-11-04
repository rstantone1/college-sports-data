-- Lock every table from the public API until read policies are added deliberately for the site.
alter table sports enable row level security;
alter table seasons enable row level security;
alter table conferences enable row level security;
alter table teams enable row level security;
alter table team_seasons enable row level security;
alter table players enable row level security;
alter table rosters enable row level security;
alter table games enable row level security;
alter table game_team_stats enable row level security;
alter table game_player_stats enable row level security;
alter table plays enable row level security;
alter table raw_payloads enable row level security;
alter table ratings enable row level security;
alter table schema_migrations enable row level security;
