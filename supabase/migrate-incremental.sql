-- Incremental migrations for an EXISTING Supabase project
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS where possible.
-- Fresh installs: use schema.sql instead (already includes everything below).
--
-- Sections:
--   1) watch_rating, watch_note
--   2) anilist_rating
--   3) list_snapshots
--   4) drop alt_title
--   5) added_at
--   6) list title_count / watched_count
--   7) age_rating, runtime, season_count, episode_count  ← duration + age group

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

-- 6) Denormalized list stats (migrate-list-stats.sql)
alter table public.lists
  add column if not exists title_count integer not null default 0,
  add column if not exists watched_count integer not null default 0;

alter table public.lists
  drop constraint if exists lists_title_count_nonneg;

alter table public.lists
  add constraint lists_title_count_nonneg
  check (title_count >= 0);

alter table public.lists
  drop constraint if exists lists_watched_count_nonneg;

alter table public.lists
  add constraint lists_watched_count_nonneg
  check (watched_count >= 0);

alter table public.lists
  drop constraint if exists lists_watched_lte_titles;

alter table public.lists
  add constraint lists_watched_lte_titles
  check (watched_count <= title_count);

update public.lists l
set
  title_count = coalesce(stats.title_count, 0),
  watched_count = coalesce(stats.watched_count, 0)
from (
  select
    list_id,
    count(*)::integer as title_count,
    count(*) filter (where watched)::integer as watched_count
  from public.watchlist_items
  group by list_id
) stats
where l.list_id = stats.list_id;

update public.lists
set title_count = 0, watched_count = 0
where list_id not in (
  select distinct list_id from public.watchlist_items
);

create or replace function public.refresh_list_stats(p_list_id text)
returns void
language sql
as $$
  update public.lists
  set
    title_count = (
      select count(*)::integer
      from public.watchlist_items
      where list_id = p_list_id
    ),
    watched_count = (
      select count(*)::integer
      from public.watchlist_items
      where list_id = p_list_id and watched = true
    )
  where list_id = p_list_id;
$$;

create or replace function public.refresh_list_stats_after_item_insert()
returns trigger
language plpgsql
as $$
declare
  affected_list_id text;
begin
  for affected_list_id in
    select distinct list_id from new_items
  loop
    perform public.refresh_list_stats(affected_list_id);
  end loop;

  return null;
end;
$$;

create or replace function public.refresh_list_stats_after_item_delete()
returns trigger
language plpgsql
as $$
declare
  affected_list_id text;
begin
  for affected_list_id in
    select distinct list_id from old_items
  loop
    perform public.refresh_list_stats(affected_list_id);
  end loop;

  return null;
end;
$$;

create or replace function public.refresh_list_stats_after_item_update()
returns trigger
language plpgsql
as $$
declare
  affected_list_id text;
begin
  for affected_list_id in
    select distinct list_id
    from (
      select list_id from new_items
      union
      select list_id from old_items
    ) affected
  loop
    perform public.refresh_list_stats(affected_list_id);
  end loop;

  return null;
end;
$$;

drop trigger if exists watchlist_items_refresh_list_stats on public.watchlist_items;
drop trigger if exists watchlist_items_refresh_list_stats_insert on public.watchlist_items;
drop trigger if exists watchlist_items_refresh_list_stats_update on public.watchlist_items;
drop trigger if exists watchlist_items_refresh_list_stats_delete on public.watchlist_items;

create trigger watchlist_items_refresh_list_stats_insert
  after insert on public.watchlist_items
  referencing new table as new_items
  for each statement
  execute function public.refresh_list_stats_after_item_insert();

create trigger watchlist_items_refresh_list_stats_delete
  after delete on public.watchlist_items
  referencing old table as old_items
  for each statement
  execute function public.refresh_list_stats_after_item_delete();

create trigger watchlist_items_refresh_list_stats_update
  after update on public.watchlist_items
  referencing new table as new_items old table as old_items
  for each statement
  execute function public.refresh_list_stats_after_item_update();

-- 7) Title metadata: age rating, runtime, seasons/episodes (migrate-title-metadata.sql)
alter table public.watchlist_items
  add column if not exists age_rating text not null default '',
  add column if not exists runtime text not null default '',
  add column if not exists season_count text not null default '',
  add column if not exists episode_count text not null default '';
