-- Incremental migrations for an EXISTING Supabase project
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS where possible.
-- Fresh installs: use schema.sql instead (already includes everything below).

-- 1) Personal watch ratings + notes (migrate-watch-ratings.sql)
alter table public.watchlist_items
  add column if not exists watch_rating numeric,
  add column if not exists watch_note text not null default '';

alter table public.watchlist_items
  drop constraint if exists watchlist_items_watch_rating_range;

alter table public.watchlist_items
  add constraint watchlist_items_watch_rating_range
  check (watch_rating is null or (watch_rating >= 0 and watch_rating <= 10));

update public.watchlist_items
set
  watch_rating = null,
  watch_note = ''
where watched = false;

-- 2) AniList community score on items (migrate-anilist-rating.sql)
alter table public.watchlist_items
  add column if not exists anilist_rating text not null default '';

-- 3) Share-link snapshots (migrate-list-snapshots.sql)
create table if not exists public.list_snapshots (
  share_id text primary key,
  list_name text not null default 'Shared list',
  title_count integer not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists list_snapshots_expires_at_idx
  on public.list_snapshots (expires_at);

alter table public.list_snapshots enable row level security;

drop policy if exists "list_snapshots_select" on public.list_snapshots;
create policy "list_snapshots_select"
  on public.list_snapshots for select to anon, authenticated
  using (expires_at > now());

drop policy if exists "list_snapshots_insert" on public.list_snapshots;
create policy "list_snapshots_insert"
  on public.list_snapshots for insert to anon, authenticated
  with check (true);

-- 4) Drop unused alt_title (alternate titles stay in local JSON only)
alter table public.watchlist_items
  drop column if exists alt_title;

-- 5) When each title was added (for "Recently added" sort; survives cloud sync)
alter table public.watchlist_items
  add column if not exists added_at timestamptz;

update public.watchlist_items
set added_at = updated_at
where added_at is null;

alter table public.watchlist_items
  alter column added_at set default now();

alter table public.watchlist_items
  alter column added_at set not null;

-- Note: local JSON may also store addedAt (ms). Sync reads/writes added_at here.
