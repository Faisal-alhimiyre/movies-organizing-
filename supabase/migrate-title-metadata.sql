-- Optional title metadata: age rating, runtime, seasons/episodes
-- Run once in Supabase SQL Editor (or use migrate-incremental.sql section 7).

alter table public.watchlist_items
  add column if not exists age_rating text not null default '',
  add column if not exists runtime text not null default '',
  add column if not exists season_count text not null default '',
  add column if not exists episode_count text not null default '';
