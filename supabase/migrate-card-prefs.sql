-- Migrate: per-title UI preferences
-- Adds columns to watchlist_items so card preferences survive across devices.
--
--   selected_season  integer  — last season selected in the detail view
--   card_poster      text     — poster URL override (season poster on outside card)
--   no_specials      boolean  — true when Season 0 was confirmed to have no episodes
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- Safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS guards).

ALTER TABLE public.watchlist_items
  ADD COLUMN IF NOT EXISTS selected_season integer,
  ADD COLUMN IF NOT EXISTS card_poster     text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS no_specials     boolean NOT NULL DEFAULT false;
