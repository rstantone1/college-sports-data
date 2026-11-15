-- Transfer portal scoreboard (hoops): what each team kept, lost and added, measured in last season's production.
-- One row per player who played last season: where he or she was, where he or she is now, and a single production number.
create or replace view v_portal_players as
select ps.sport_id, s.year as season_year, ps.player_id, ps.display_name, ps.team_id as from_team_id, cur.team_id as to_team_id,
       case when cur.team_id is null then 'gone' when cur.team_id = ps.team_id then 'kept' else 'moved' end as status,
       cur.position, cur.class_year, ps.gp, ps.gs, ps.min, ps.pts, ps.reb, ps.ast,
       round(v.value, 1) as value,
       -- Production in a weaker league is worth less at the next stop: scale by how good the old team was.
       round(v.value * greatest(0.25, 1 + coalesce(rt.adj_em, 0) / 35.0), 1) as value_adj
from (select sp.id as sport_id, y as year from (values ('mbb'), ('wbb')) sp(id), generate_series(2010, 2040) y) s
join mv_player_season ps on ps.sport_id = s.sport_id and ps.season_year = s.year - 1
cross join lateral (select greatest(0, ps.pts + 0.4 * ps.fgm - 0.7 * ps.fga - 0.4 * (ps.fta - ps.ftm) + 0.42 * ps.reb + ps.stl + 0.7 * ps.ast + 0.7 * ps.blk - ps.tov)::numeric as value) v
left join lateral (select r.team_id, r.class_year, r.position from rosters r where r.player_id = ps.player_id and r.season_year = s.year order by r.last_seen desc nulls last limit 1) cur on true
left join v_ratings_latest rt on rt.sport_id = ps.sport_id and rt.season_year = ps.season_year and rt.team_id = ps.team_id
-- A player with two teams in one season counts once, at the team where he or she played more.
where not exists (select 1 from mv_player_season o where o.sport_id = ps.sport_id and o.season_year = ps.season_year and o.player_id = ps.player_id
                  and (o.min > ps.min or (o.min = ps.min and o.team_id < ps.team_id)));
grant select on v_portal_players to anon, authenticated;

create or replace view v_portal_teams as
select sport_id, season_year, team_id,
       sum(kept) as kept, sum(lost_moved) as lost_moved, sum(lost_gone) as lost_gone, sum(added) as added, sum(added_raw) as added_raw,
       sum(n_kept)::int as n_kept, sum(n_out)::int as n_out, sum(n_gone)::int as n_gone, sum(n_in)::int as n_in
from (
  select sport_id, season_year, from_team_id as team_id,
         sum(value) filter (where status = 'kept') as kept, sum(value) filter (where status = 'moved') as lost_moved, sum(value) filter (where status = 'gone') as lost_gone,
         0::numeric as added, 0::numeric as added_raw,
         count(*) filter (where status = 'kept') as n_kept, count(*) filter (where status = 'moved') as n_out, count(*) filter (where status = 'gone') as n_gone, 0::bigint as n_in
  from v_portal_players group by 1, 2, 3
  union all
  select sport_id, season_year, to_team_id, 0, 0, 0, sum(value_adj), sum(value), 0, 0, 0, count(*)
  from v_portal_players where status = 'moved' group by 1, 2, 3
) x group by 1, 2, 3;
grant select on v_portal_teams to anon, authenticated;
