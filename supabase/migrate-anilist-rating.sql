-- Add AniList community score (0–100) on watchlist_items
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run

alter table public.watchlist_items
  add column if not exists anilist_rating text not null default '';
