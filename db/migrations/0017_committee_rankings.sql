-- The playoff committee's weekly rankings (one row per team per release), read by the playoff simulator.
create table if not exists committee_rankings (
  sport_id     text not null,
  season_year  int not null,
  released_at  timestamptz not null,
  team_id      bigint not null references teams(id),
  rank         int not null,
  primary key (sport_id, season_year, released_at, team_id)
);
alter table committee_rankings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'committee_rankings' and policyname = 'public_read') then
    create policy public_read on committee_rankings for select using (true);
  end if;
end $$;
grant select on committee_rankings to anon, authenticated;
