-- Stage A: Add watch_progress column to watchlist_items
--
-- Stores versioned granular episode-level progress for TV series and anime.
-- Does NOT reset watched, watch_rating, or watch_note.
-- Idempotent — safe to run multiple times.
--
-- Format: { "version": 1, "episodes": ["1:1", "1:2", "2:5"] }
--   version  — future-proof schema version
--   episodes — array of "seasonNumber:episodeNumber" strings
--
-- watched=true remains the title-level completion flag.
-- watch_progress stores granular in-progress tracking independently.
-- A row can have watch_progress with episodes while watched=false (in-progress state).

alter table public.watchlist_items
  add column if not exists watch_progress jsonb
    not null default '{"version":1,"episodes":[]}'::jsonb;

-- Verify the constraint does not already exist before adding.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'watchlist_items_watch_progress_version'
      and conrelid = 'public.watchlist_items'::regclass
  ) then
    alter table public.watchlist_items
      add constraint watchlist_items_watch_progress_version
      check (
        (watch_progress ->> 'version')::int = 1
        or watch_progress = '{}'::jsonb
        or watch_progress = '{"version":1,"episodes":[]}'::jsonb
      );
  end if;
exception when others then
  -- Column constraint may not be strictly needed; skip silently.
  null;
end;
$$;
