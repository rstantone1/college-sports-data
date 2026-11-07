-- Men's spread leans were retired Nov 7 (no edge over ten seasons, negative line movement this season).
-- Remove the ones an older run flagged for games not yet played.
delete from bet_picks b using games g
 where g.id = b.game_id and b.sport_id = 'mbb' and b.kind = 'live' and b.market = 'spread' and b.tier = 'lean'
   and b.stat is null and b.result is null and not g.completed;
