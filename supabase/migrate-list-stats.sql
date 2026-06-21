-- Denormalized list stats on public.lists
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Adds:
--   lists.title_count   — number of titles in the list
--   lists.watched_count — number of watched titles
--
-- Counts are maintained by a statement-level trigger on watchlist_items
-- and backfilled from existing rows below.

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

-- Backfill from current items
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
