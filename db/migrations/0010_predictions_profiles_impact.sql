-- Prediction log, team profiles, game impact, player advanced stats. Idempotent (safe to re-run).

-- 1. Every pick, written before the game starts and never edited. The public track record is built from this.
create table if not exists predictions (
  sport_id      text not null,
  season_year   int  not null,
  game_id       bigint not null references games(id) on delete cascade,
  kind          text not null default 'live',          -- live = made before tip; replay = backtest on a past season
  made_at       timestamptz not null default now(),
  ratings_as_of date,
  model_version text not null,
  home_prob     numeric not null,                      -- chance the home team wins
  margin        numeric not null,                      -- predicted home score minus away score
  home_pts      numeric,
  away_pts      numeric,
  estimated     boolean not null default false,        -- one side used a stand-in rating (non-D-I opponent)
  primary key (game_id, kind)
);
create index if not exists predictions_sport_season_idx on predictions (sport_id, season_year, kind);
alter table predictions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='predictions' and policyname='public_read') then
    create policy public_read on predictions for select using (true);
  end if;
end $$;

-- 2. How much each game moved a team's rating (points per 100 of adjusted margin; positive = helped).
create table if not exists team_game_impact (
  sport_id    text not null,
  season_year int  not null,
  team_id     bigint not null references teams(id) on delete cascade,
  game_id     bigint not null references games(id) on delete cascade,
  game_adj_em numeric not null,   -- the team's opponent- and venue-adjusted margin in this game alone
  contrib     numeric not null,   -- how much the rating would drop if this game were removed
  primary key (sport_id, season_year, team_id, game_id)
);
alter table team_game_impact enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='team_game_impact' and policyname='public_read') then
    create policy public_read on team_game_impact for select using (true);
  end if;
end $$;

-- 3. Team profile: records, splits, luck, schedule strength and the box-score rates behind the rating.
create materialized view if not exists mv_team_profile as
with r as (
  select * from v_ratings_latest
),
tg as (
  select g.sport_id, g.season_year, t.team_id, g.id game_id, g.start_time,
         case when t.team_id = g.home_team_id then g.home_score else g.away_score end pf,
         case when t.team_id = g.home_team_id then g.away_score else g.home_score end pa,
         case when g.neutral_site then 'N' when t.team_id = g.home_team_id then 'H' else 'A' end site,
         case when t.team_id = g.home_team_id then g.away_team_id else g.home_team_id end opp,
         g.conference_game
  from games g join lateral (values (g.home_team_id), (g.away_team_id)) t(team_id) on true
  where g.completed and g.home_score is not null and coalesce(g.season_type, 2) <> 1
),
d1 as (
  select tg.*, exists (select 1 from team_seasons ts where ts.team_id = tg.opp and ts.season_year = tg.season_year) opp_d1
  from tg where exists (select 1 from team_seasons ts where ts.team_id = tg.team_id and ts.season_year = tg.season_year)
),
rec as (
  select sport_id, season_year, team_id,
         count(*) gp, count(*) filter (where pf > pa) wins,
         count(*) filter (where site='H' and pf > pa) home_w, count(*) filter (where site='H' and pf < pa) home_l,
         count(*) filter (where site='A' and pf > pa) road_w, count(*) filter (where site='A' and pf < pa) road_l,
         count(*) filter (where site='N' and pf > pa) neutral_w, count(*) filter (where site='N' and pf < pa) neutral_l,
         sum(pf) pf, sum(pa) pa,
         count(*) filter (where opp_d1) d1_gp, count(*) filter (where opp_d1 and pf > pa) d1_wins
  from d1 group by 1,2,3
),
last10 as (
  select sport_id, season_year, team_id, count(*) filter (where pf > pa) w, count(*) filter (where pf < pa) l
  from (select *, row_number() over (partition by sport_id, season_year, team_id order by start_time desc) rn from d1) x
  where rn <= 10 group by 1,2,3
),
sos as (
  select d.sport_id, d.season_year, d.team_id,
         avg(ro.adj_em) sos, avg(ro.adj_em) filter (where not coalesce(d.conference_game, false)) nc_sos,
         count(*) filter (where ro.rank <= 50 and (d.site='H' and ro.rank <= 30 or d.site='N' and ro.rank <= 50 or d.site='A' and ro.rank <= 75)) q1_gp,
         count(*) filter (where d.pf > d.pa and ro.rank <= 50 and (d.site='H' and ro.rank <= 30 or d.site='N' and ro.rank <= 50 or d.site='A' and ro.rank <= 75)) q1_w
  from d1 d join r ro on ro.sport_id = d.sport_id and ro.season_year = d.season_year and ro.team_id = d.opp
  group by 1,2,3
),
box as (
  select t.sport_id, t.season_year, t.team_id, t.games box_games, t.totals o, t.opp_totals x from mv_team_season t
)
select rec.sport_id, rec.season_year, rec.team_id,
       rec.gp, rec.wins, rec.gp - rec.wins losses, rec.home_w, rec.home_l, rec.road_w, rec.road_l, rec.neutral_w, rec.neutral_l,
       rec.d1_gp, rec.d1_wins, rec.pf, rec.pa,
       last10.w last10_w, last10.l last10_l,
       -- Luck: wins above what the scoring margin says (Pythagorean expectation with a sport exponent).
       round(rec.wins - rec.gp * power(rec.pf, e.ex) / nullif(power(rec.pf, e.ex) + power(rec.pa, e.ex), 0), 2) luck,
       round(sos.sos, 2) sos, round(sos.nc_sos, 2) nc_sos, sos.q1_gp, sos.q1_w,
       -- Hoops: the Four Factors on both ends, plus shot mix.
       case when rec.sport_id in ('mbb','wbb') then round(((box.o->>'fieldGoalsMade')::numeric + 0.5*(box.o->>'threePointFieldGoalsMade')::numeric) / nullif((box.o->>'fieldGoalsAttempted')::numeric, 0), 4) end efg,
       case when rec.sport_id in ('mbb','wbb') then round(coalesce((box.o->>'totalTurnovers')::numeric, (box.o->>'turnovers')::numeric) / nullif((box.o->>'fieldGoalsAttempted')::numeric - (box.o->>'offensiveRebounds')::numeric + coalesce((box.o->>'totalTurnovers')::numeric, (box.o->>'turnovers')::numeric) + 0.475*(box.o->>'freeThrowsAttempted')::numeric, 0), 4) end tov_pct,
       case when rec.sport_id in ('mbb','wbb') then round((box.o->>'offensiveRebounds')::numeric / nullif((box.o->>'offensiveRebounds')::numeric + (box.x->>'defensiveRebounds')::numeric, 0), 4) end orb_pct,
       case when rec.sport_id in ('mbb','wbb') then round((box.o->>'freeThrowsAttempted')::numeric / nullif((box.o->>'fieldGoalsAttempted')::numeric, 0), 4) end ftr,
       case when rec.sport_id in ('mbb','wbb') then round(((box.x->>'fieldGoalsMade')::numeric + 0.5*(box.x->>'threePointFieldGoalsMade')::numeric) / nullif((box.x->>'fieldGoalsAttempted')::numeric, 0), 4) end d_efg,
       case when rec.sport_id in ('mbb','wbb') then round(coalesce((box.x->>'totalTurnovers')::numeric, (box.x->>'turnovers')::numeric) / nullif((box.x->>'fieldGoalsAttempted')::numeric - (box.x->>'offensiveRebounds')::numeric + coalesce((box.x->>'totalTurnovers')::numeric, (box.x->>'turnovers')::numeric) + 0.475*(box.x->>'freeThrowsAttempted')::numeric, 0), 4) end d_tov_pct,
       case when rec.sport_id in ('mbb','wbb') then round((box.o->>'defensiveRebounds')::numeric / nullif((box.o->>'defensiveRebounds')::numeric + (box.x->>'offensiveRebounds')::numeric, 0), 4) end drb_pct,
       case when rec.sport_id in ('mbb','wbb') then round((box.x->>'freeThrowsAttempted')::numeric / nullif((box.x->>'fieldGoalsAttempted')::numeric, 0), 4) end d_ftr,
       case when rec.sport_id in ('mbb','wbb') then round((box.o->>'threePointFieldGoalsAttempted')::numeric / nullif((box.o->>'fieldGoalsAttempted')::numeric, 0), 4) end tpa_rate,
       case when rec.sport_id in ('mbb','wbb') then round((box.o->>'threePointFieldGoalsMade')::numeric / nullif((box.o->>'threePointFieldGoalsAttempted')::numeric, 0), 4) end tp_pct,
       case when rec.sport_id in ('mbb','wbb') then round((box.x->>'threePointFieldGoalsMade')::numeric / nullif((box.x->>'threePointFieldGoalsAttempted')::numeric, 0), 4) end d_tp_pct,
       case when rec.sport_id in ('mbb','wbb') then round((box.o->>'freeThrowsMade')::numeric / nullif((box.o->>'freeThrowsAttempted')::numeric, 0), 4) end ft_pct,
       case when rec.sport_id in ('mbb','wbb') then round((box.o->>'assists')::numeric / nullif((box.o->>'fieldGoalsMade')::numeric, 0), 4) end ast_rate,
       -- Football: yards per play and turnovers, both sides.
       case when rec.sport_id = 'cfb' then round((box.o->>'totalYards')::numeric / nullif((box.o->>'rushingAttempts')::numeric + (box.o->>'netPassingYards')::numeric / nullif((box.o->>'yardsPerPass')::numeric, 0), 0), 2) end ypp,
       case when rec.sport_id = 'cfb' then round((box.x->>'totalYards')::numeric / nullif((box.x->>'rushingAttempts')::numeric + (box.x->>'netPassingYards')::numeric / nullif((box.x->>'yardsPerPass')::numeric, 0), 0), 2) end d_ypp,
       case when rec.sport_id = 'cfb' then round((box.o->>'yardsPerRushAttempt')::numeric / nullif(box.box_games, 0), 2) end ypr,
       case when rec.sport_id = 'cfb' then round((box.o->>'yardsPerPass')::numeric / nullif(box.box_games, 0), 2) end ypa,
       case when rec.sport_id = 'cfb' then round((box.o->>'turnovers')::numeric / nullif(box.box_games, 0), 2) end to_pg,
       case when rec.sport_id = 'cfb' then round((box.x->>'turnovers')::numeric / nullif(box.box_games, 0), 2) end d_to_pg,
       -- Diamond: batting and pitching rates.
       case when rec.sport_id in ('bsb','sb') then round((box.o->>'hits')::numeric / nullif((box.o->>'atBats')::numeric, 0), 4) end avg,
       case when rec.sport_id in ('bsb','sb') then round(((box.o->>'hits')::numeric + (box.o->>'walks')::numeric) / nullif((box.o->>'atBats')::numeric + (box.o->>'walks')::numeric, 0), 4) end obp,
       case when rec.sport_id in ('bsb','sb') then round((box.o->>'strikeouts')::numeric / nullif((box.o->>'atBats')::numeric, 0), 4) end k_rate,
       case when rec.sport_id in ('bsb','sb') then round((box.o->>'walks')::numeric / nullif((box.o->>'atBats')::numeric + (box.o->>'walks')::numeric, 0), 4) end bb_rate,
       case when rec.sport_id in ('bsb','sb') then round(e.reg * (box.o->>'earnedRunsAllowed')::numeric / nullif((box.o->>'inningsPitched')::numeric, 0), 2) end era,
       case when rec.sport_id in ('bsb','sb') then round(((box.o->>'hitsAllowed')::numeric + (box.o->>'walksAllowed')::numeric) / nullif((box.o->>'inningsPitched')::numeric, 0), 3) end whip,
       case when rec.sport_id in ('bsb','sb') then round(e.reg * (box.o->>'strikeoutsPitched')::numeric / nullif((box.o->>'inningsPitched')::numeric, 0), 2) end k9,
       case when rec.sport_id in ('bsb','sb') then round((box.x->>'hits')::numeric / nullif((box.x->>'atBats')::numeric, 0), 4) end d_avg
from rec
join (values ('mbb', 11.5, 40.0), ('wbb', 11.5, 40.0), ('cfb', 2.37, 60.0), ('bsb', 1.83, 9.0), ('sb', 1.83, 7.0)) e(sport, ex, reg) on e.sport = rec.sport_id
left join last10 on last10.sport_id = rec.sport_id and last10.season_year = rec.season_year and last10.team_id = rec.team_id
left join sos on sos.sport_id = rec.sport_id and sos.season_year = rec.season_year and sos.team_id = rec.team_id
left join box on box.sport_id = rec.sport_id and box.season_year = rec.season_year and box.team_id = rec.team_id;
create unique index if not exists mv_team_profile_pk on mv_team_profile (sport_id, season_year, team_id);
grant select on mv_team_profile to anon, authenticated;

-- 4. Player advanced stats (hoops): per-40, usage, shooting efficiency, from the season rollups.
create or replace view v_player_adv as
select p.sport_id, p.season_year, p.team_id, p.player_id, p.display_name, p.gp, p.gs, p.min, p.pts, p.reb, p.ast, p.stl, p.blk, p.tov, p.fga, p.fgm, p.tpa, p.tpm, p.fta, p.ftm,
       round(p.pts / nullif(p.gp, 0), 1) ppg, round(p.reb / nullif(p.gp, 0), 1) rpg, round(p.ast / nullif(p.gp, 0), 1) apg, round(p.min / nullif(p.gp, 0), 1) mpg,
       round(40 * p.pts / nullif(p.min, 0), 1) pts40, round(40 * p.reb / nullif(p.min, 0), 1) reb40, round(40 * p.ast / nullif(p.min, 0), 1) ast40,
       round(40 * p.stl / nullif(p.min, 0), 2) stl40, round(40 * p.blk / nullif(p.min, 0), 2) blk40, round(40 * p.tov / nullif(p.min, 0), 2) tov40,
       round((p.fgm + 0.5 * p.tpm) / nullif(p.fga, 0), 4) efg,
       round(p.pts / nullif(2 * (p.fga + 0.44 * p.fta), 0), 4) ts,
       round(p.tpm / nullif(p.tpa, 0), 4) tp_pct, round(p.ftm / nullif(p.fta, 0), 4) ft_pct,
       round(p.tpa / nullif(p.fga, 0), 4) tpa_rate, round(p.fta / nullif(p.fga, 0), 4) ftr,
       round(p.ast / nullif(p.tov, 0), 2) ast_tov,
       -- Usage: share of the team's possessions this player ends while on the floor.
       round(((p.fga + 0.44 * p.fta + p.tov) / nullif(p.min, 0)) /
             nullif(((t.totals->>'fieldGoalsAttempted')::numeric + 0.44 * (t.totals->>'freeThrowsAttempted')::numeric + coalesce((t.totals->>'totalTurnovers')::numeric, (t.totals->>'turnovers')::numeric)) / nullif(t.games * 200.0, 0), 0) / 5, 4) usage,
       round(p.min / nullif(t.games * 200.0, 0) * 5, 4) min_share
from mv_player_season p
left join mv_team_season t on t.sport_id = p.sport_id and t.season_year = p.season_year and t.team_id = p.team_id;
grant select on v_player_adv to anon, authenticated;

create or replace function refresh_rollups() returns void language sql security definer set search_path = public as $$
  refresh materialized view concurrently mv_player_season;
  refresh materialized view concurrently mv_diamond_season;
  refresh materialized view concurrently mv_cfb_season;
  refresh materialized view concurrently mv_team_season;
  refresh materialized view concurrently mv_team_profile;
$$;
