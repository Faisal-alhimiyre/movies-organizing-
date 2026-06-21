-- Title metadata on watchlist_items: age rating + duration (+ TV/anime season counts)
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Maps to local JSON / app fields:
--   age_rating    → ageRating   (e.g. PG-13, R, TV-MA, 18+)
--   runtime       → runtime     (e.g. 142 min, ~23 min/ep)
--   season_count  → seasonCount (e.g. 3)
--   episode_count → episodeCount
--
-- Safe to re-run (IF NOT EXISTS). Web + Flutter sync already read/write these columns.

alter table public.watchlist_items
  add column if not exists age_rating text not null default '',
  add column if not exists runtime text not null default '',
  add column if not exists season_count text not null default '',
  add column if not exists episode_count text not null default '';

-- Verify (optional):
-- select column_name, data_type, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'watchlist_items'
--   and column_name in ('age_rating', 'runtime', 'season_count', 'episode_count')
-- order by column_name;
