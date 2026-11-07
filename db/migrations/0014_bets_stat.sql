-- Best-price picks (stat = 'price') live next to our model's pick for the same game; the site tells them apart.
create or replace view v_bets as
select b.id, b.sport_id, b.season_year, b.game_id, b.kind, b.market, b.side, b.line, b.price, b.book, b.our_number,
       b.edge, b.cover_prob, b.tier, b.reasons, b.made_at, b.close_line, b.clv, b.result, b.graded_at,
       g.start_time, g.completed, g.status, g.home_score, g.away_score, g.neutral_site,
       h.short_name as home_name, h.abbreviation as home_abbr, h.logo_url as home_logo,
       a.short_name as away_name, a.abbreviation as away_abbr, a.logo_url as away_logo,
       b.stat, b.close_price, b.model_version
from bet_picks b
join games g on g.id = b.game_id
left join teams h on h.id = g.home_team_id
left join teams a on a.id = g.away_team_id;
-- The old point-gap shopping flags are replaced by priced ones.
delete from bet_picks where model_version = 'shop-v1' and result is null;
