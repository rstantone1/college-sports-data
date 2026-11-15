-- The portal views were too slow to read live (about 3 seconds for a whole sport). Store the per-player rows once
-- per data refresh; the two public views keep their names and columns.
create materialized view if not exists mv_portal_players as
select ps.sport_id, s.year as season_year, ps.player_id, ps.display_name, ps.team_id as from_team_id, cur.team_id as to_team_id,
       case when cur.team_id is null then 'gone' when cur.team_id = ps.team_id then 'kept' else 'moved' end as status,
       cur.position, cur.class_year, ps.gp, ps.gs, ps.min, ps.pts, ps.reb, ps.ast,
       round(v.value, 1) as value,
       -- Production against a weaker schedule is worth less at the next stop: scale by how good the old team was.
       round(v.value * greatest(0.25, 1 + coalesce(rt.adj_em, 0) / 35.0), 1) as value_adj
from (select distinct t.sport_id, ts.season_year as year from team_seasons ts join teams t on t.id = ts.team_id where t.sport_id in ('mbb', 'wbb')) s
join mv_player_season ps on ps.sport_id = s.sport_id and ps.season_year = s.year - 1
cross join lateral (select greatest(0, ps.pts + 0.4 * ps.fgm - 0.7 * ps.fga - 0.4 * (ps.fta - ps.ftm) + 0.42 * ps.reb + ps.stl + 0.7 * ps.ast + 0.7 * ps.blk - ps.tov)::numeric as value) v
left join lateral (select r.team_id, r.class_year, r.position from rosters r where r.player_id = ps.player_id and r.season_year = s.year order by r.last_seen desc nulls last limit 1) cur on true
left join v_ratings_latest rt on rt.sport_id = ps.sport_id and rt.season_year = ps.season_year and rt.team_id = ps.team_id
-- A player who appeared for two teams in one season counts once, with the team he or she played more for.
where not exists (select 1 from mv_player_season o where o.sport_id = ps.sport_id and o.season_year = ps.season_year and o.player_id = ps.player_id
                  and (o.min > ps.min or (o.min = ps.min and o.team_id < ps.team_id)));
create unique index if not exists mv_portal_players_pk on mv_portal_players (sport_id, season_year, player_id);
create index if not exists mv_portal_players_from on mv_portal_players (sport_id, season_year, from_team_id);
create index if not exists mv_portal_players_to on mv_portal_players (sport_id, season_year, to_team_id);
create or replace view v_portal_players as select * from mv_portal_players;
grant select on v_portal_players to anon, authenticated;
create or replace function refresh_portal() returns void language sql security definer set search_path = public as $$
  refresh materialized view concurrently mv_portal_players;
$$;
