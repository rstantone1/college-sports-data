-- mv_cfb_season grouped by games played as well as by player, so a player whose stat keys appeared in different
-- numbers of games got two rows and the unique index blocked every refresh. Rebuilt with games counted separately.
-- (Applied to Supabase on Nov 5 by renaming the old view to mv_cfb_season_old; this file is the record.)
select 1;
