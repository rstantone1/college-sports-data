-- Draft board: draft-eligible college players (juniors and seniors) ranked by this season's production.
-- Production per game by position, scaled for the strength of the team's schedule, then ordered so the mix of
-- positions matches how the NFL spends its picks. It measures what a player has done on the field this season;
-- it is not a scouting grade. Offensive linemen and specialists have no box-score stats, so they are not ranked.
drop materialized view if exists mv_draft_board;
create materialized view mv_draft_board as
select (select max(season_year) from mv_cfb_season where sport_id = 'cfb') + 1 as draft_year, q.* from (
with y as (select max(season_year) as yr from mv_cfb_season where sport_id = 'cfb'),
st as (
  select s.player_id, s.team_id, max(replace(s.display_name, ' ESPN ', ' ')) as name, max(s.games) as g,
    coalesce(sum((s.totals->>'passingYards')::numeric) filter (where s.stat_group = 'passing'), 0) as pyd,
    coalesce(sum((s.totals->>'passingTouchdowns')::numeric) filter (where s.stat_group = 'passing'), 0) as ptd,
    coalesce(sum((s.totals->>'interceptions')::numeric) filter (where s.stat_group = 'passing'), 0) as pint,
    coalesce(sum((s.totals->>'passingAttempts')::numeric) filter (where s.stat_group = 'passing'), 0) as patt,
    coalesce(sum((s.totals->>'completions')::numeric) filter (where s.stat_group = 'passing'), 0) as pcmp,
    coalesce(sum((s.totals->>'rushingYards')::numeric) filter (where s.stat_group = 'rushing'), 0) as ryd,
    coalesce(sum((s.totals->>'rushingTouchdowns')::numeric) filter (where s.stat_group = 'rushing'), 0) as rtd,
    coalesce(sum((s.totals->>'rushingAttempts')::numeric) filter (where s.stat_group = 'rushing'), 0) as ratt,
    coalesce(sum((s.totals->>'receivingYards')::numeric) filter (where s.stat_group = 'receiving'), 0) as cyd,
    coalesce(sum((s.totals->>'receivingTouchdowns')::numeric) filter (where s.stat_group = 'receiving'), 0) as ctd,
    coalesce(sum((s.totals->>'receptions')::numeric) filter (where s.stat_group = 'receiving'), 0) as rec,
    coalesce(sum((s.totals->>'totalTackles')::numeric) filter (where s.stat_group = 'defensive'), 0) as tkl,
    coalesce(sum((s.totals->>'tacklesForLoss')::numeric) filter (where s.stat_group = 'defensive'), 0) as tfl,
    coalesce(sum((s.totals->>'sacks')::numeric) filter (where s.stat_group = 'defensive'), 0) as sck,
    coalesce(sum((s.totals->>'passesDefended')::numeric) filter (where s.stat_group = 'defensive'), 0) as pd,
    coalesce(sum((s.totals->>'interceptions')::numeric) filter (where s.stat_group = 'interceptions'), 0) as dint
  from mv_cfb_season s, y where s.sport_id = 'cfb' and s.season_year = y.yr group by 1, 2
), p as (
  select st.*, r.class_year, r.height_in, r.weight_lb, r.position as roster_pos,
    case when r.position = 'QB' then 'QB' when r.position in ('RB', 'FB') then 'RB' when r.position = 'WR' then 'WR' when r.position = 'TE' then 'TE'
         when r.position in ('DL', 'DT', 'NT', 'DE', 'EDGE') then 'DL' when r.position = 'LB' then 'LB' when r.position in ('DB', 'CB', 'S') then 'DB' end as pos,
    rt.short_name as school, rt.logo_url, rt.color, rt.adj_em, rt.rank as team_rank
  from st join y on true
  join rosters r on r.player_id = st.player_id and r.team_id = st.team_id and r.season_year = y.yr
  join v_ratings_latest rt on rt.sport_id = 'cfb' and rt.season_year = y.yr and rt.team_id = st.team_id
  where r.class_year in ('Junior', 'Senior') and st.g >= 5
), sc as (
  select p.*, (case pos
      when 'QB' then case when patt >= 120 then pyd + 20 * ptd - 45 * pint + 0.9 * ryd + 20 * rtd end
      when 'RB' then ryd + 0.9 * cyd + 20 * (rtd + ctd)
      when 'WR' then cyd + 20 * ctd + 2 * rec + 0.8 * ryd
      when 'TE' then cyd + 20 * ctd + 3 * rec
      when 'DL' then 5 * sck + 3 * (tfl - sck) + 0.8 * tkl + 2 * pd
      when 'LB' then tkl + 2.5 * tfl + 2.5 * sck + 2.5 * pd + 6 * dint
      when 'DB' then 0.7 * tkl + 4 * pd + 8 * dint + 2 * tfl end) / g * (1 + greatest(-20, least(25, adj_em)) / 50.0) as score
  from p where pos is not null
), rk as (
  select sc.*, row_number() over (partition by pos order by score desc) as pos_rank,
    (case pos when 'QB' then 5 when 'RB' then 8 when 'WR' then 16 when 'TE' then 6 when 'DL' then 24 when 'LB' then 11 else 24 end)::numeric as share
  from sc where score is not null
)
select row_number() over (order by (pos_rank - 0.5) / share, score desc) as rank, pos, pos_rank, player_id, team_id, name, school, logo_url, color, team_rank, class_year, height_in, weight_lb, roster_pos, g as games,
  case pos when 'QB' then pyd::int || ' pass yds, ' || ptd::int || ' TD, ' || pint::int || ' INT' || case when ryd >= 150 then ', ' || ryd::int || ' rush yds' else '' end
    when 'RB' then ryd::int || ' rush yds, ' || round(ryd / nullif(ratt, 0), 1) || ' a carry, ' || (rtd + ctd)::int || ' TD'
    when 'WR' then rec::int || ' catches, ' || cyd::int || ' yds, ' || ctd::int || ' TD'
    when 'TE' then rec::int || ' catches, ' || cyd::int || ' yds, ' || ctd::int || ' TD'
    when 'DL' then trim(trailing '.0' from sck::text) || ' sacks, ' || trim(trailing '.0' from tfl::text) || ' tackles for loss, ' || tkl::int || ' tackles'
    when 'LB' then tkl::int || ' tackles, ' || trim(trailing '.0' from tfl::text) || ' for loss, ' || trim(trailing '.0' from sck::text) || ' sacks'
    else tkl::int || ' tackles, ' || dint::int || ' INT, ' || pd::int || ' passes broken up' end as line,
  round(score, 1) as score
from rk order by 1 limit 400
) q;
create unique index mv_draft_board_pk on mv_draft_board (rank);
create or replace view v_draft_board as select * from mv_draft_board;
grant select on v_draft_board to anon, authenticated;
create or replace function refresh_portal() returns void language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently mv_portal_players;
  refresh materialized view mv_draft_board;
end $$;
