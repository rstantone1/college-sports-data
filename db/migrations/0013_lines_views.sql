-- Lines on the game view the site reads, and a bets view with team names. Columns are only appended to v_games,
-- so existing readers keep working.
create or replace view v_games as
select g.id, g.sport_id, g.espn_id, g.season_year, g.season_type, g.start_time, g.status, g.completed, g.neutral_site,
       g.conference_game, g.venue_name, g.venue_city, g.venue_state, g.attendance, g.home_team_id, g.away_team_id,
       g.home_score, g.away_score, g.periods, g.notes, g.box_fetched_at,
       h.short_name as home_name, h.abbreviation as home_abbr, h.color as home_color, h.logo_url as home_logo,
       a.short_name as away_name, a.abbreviation as away_abbr, a.color as away_color, a.logo_url as away_logo,
       g.spread, g.total, g.spread_open, g.total_open, g.home_ml, g.away_ml, g.line_books
from games g
left join teams h on h.id = g.home_team_id
left join teams a on a.id = g.away_team_id;

create or replace view v_bets as
select b.id, b.sport_id, b.season_year, b.game_id, b.kind, b.market, b.side, b.line, b.price, b.book, b.our_number,
       b.edge, b.cover_prob, b.tier, b.reasons, b.made_at, b.close_line, b.clv, b.result, b.graded_at,
       g.start_time, g.completed, g.status, g.home_score, g.away_score, g.neutral_site,
       h.short_name as home_name, h.abbreviation as home_abbr, h.logo_url as home_logo,
       a.short_name as away_name, a.abbreviation as away_abbr, a.logo_url as away_logo
from bet_picks b
join games g on g.id = b.game_id
left join teams h on h.id = g.home_team_id
left join teams a on a.id = g.away_team_id;
