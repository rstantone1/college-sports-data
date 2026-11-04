-- Applied directly in Supabase (Supabase-specific roles anon/authenticated). Kept here for record.
-- See Supabase migration history: 0003_public_read_and_views.
-- Contents: public_read select policies on all tables except raw_payloads; views v_ratings_latest, v_games;
-- materialized view mv_player_season (basketball season lines); refresh_rollups() function.
do $$ begin
  if exists (select 1 from pg_roles where rolname='anon') then raise notice 'apply via Supabase migration'; end if;
end $$;
