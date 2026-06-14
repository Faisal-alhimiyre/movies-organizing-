-- Add personal rating + comment when a title is marked watched
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Columns on watchlist_items:
--   watched       = true when user marked it watched
--   watch_rating  = user's score 0–10 (decimals OK, e.g. 8.5), null if not rated yet
--   watch_note    = private comment to yourself (empty string if none)
--
-- The app syncs these automatically after you run this migration.

alter table public.watchlist_items
  add column if not exists watch_rating numeric,
  add column if not exists watch_note text not null default '';

-- Rating must be between 0 and 10 when set
alter table public.watchlist_items
  drop constraint if exists watchlist_items_watch_rating_range;

alter table public.watchlist_items
  add constraint watchlist_items_watch_rating_range
  check (watch_rating is null or (watch_rating >= 0 and watch_rating <= 10));

-- Unwatched titles should not keep an old rating or comment
update public.watchlist_items
set
  watch_rating = null,
  watch_note = ''
where watched = false;
