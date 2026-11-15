-- The track-record page used to download every pick ever made (37,000+ rows) and add them up in the browser.
-- This does the adding up in the database: one row per sport, kind, confidence range, scored-or-pending.
create or replace view v_record_bins as
select p.sport_id, p.kind,
       (g.completed and g.home_score is not null and g.home_score <> g.away_score) as scored,
       case when p.f < 0.6 then 0 when p.f < 0.7 then 1 when p.f < 0.8 then 2 when p.f < 0.9 then 3 when p.f < 0.95 then 4 else 5 end as bin,
       count(*)::int as n,
       (count(*) filter (where (p.home_prob >= 0.5) = (g.home_score > g.away_score)))::int as won,
       sum(p.f)::float8 as said,
       sum(abs(p.margin - (g.home_score - g.away_score)))::float8 as err,
       min(p.made_at) as first_made
from (select game_id, sport_id, kind, made_at, home_prob, margin, greatest(home_prob, 1 - home_prob) as f from predictions where not estimated) p
join games g on g.id = p.game_id
group by 1, 2, 3, 4;
grant select on v_record_bins to anon, authenticated;
