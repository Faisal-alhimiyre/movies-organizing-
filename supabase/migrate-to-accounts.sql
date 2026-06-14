-- Upgrade from OLD schema (lists + watchlist_items only) to account + multi-list
-- Run once in: Supabase Dashboard → SQL Editor → Run

-- 1. Accounts table
create table if not exists public.accounts (
  account_id text primary key,
  updated_at timestamptz not null default now()
);

-- 2. New columns on lists (safe if already present)
alter table public.lists add column if not exists account_id text;
alter table public.lists add column if not exists name text;
alter table public.lists add column if not exists description text;

-- 3. Backfill existing rows (old list_id = account_id)
update public.lists
set account_id = list_id
where account_id is null;

update public.lists
set name = 'My list'
where name is null or name = '';

update public.lists
set description = ''
where description is null;

alter table public.lists alter column name set default 'My list';
alter table public.lists alter column description set default '';

-- 4. Create account rows for every list owner
insert into public.accounts (account_id, updated_at)
select distinct account_id, coalesce(updated_at, now())
from public.lists
on conflict (account_id) do nothing;

-- 5. Link lists → accounts
alter table public.lists drop constraint if exists lists_account_id_fkey;
alter table public.lists
  add constraint lists_account_id_fkey
  foreign key (account_id) references public.accounts (account_id) on delete cascade;

-- 6. RLS on accounts (ignore errors if policies already exist)
alter table public.accounts enable row level security;

drop policy if exists "accounts_select" on public.accounts;
drop policy if exists "accounts_insert" on public.accounts;
drop policy if exists "accounts_update" on public.accounts;
drop policy if exists "accounts_delete" on public.accounts;

create policy "accounts_select"
  on public.accounts for select to anon, authenticated using (true);
create policy "accounts_insert"
  on public.accounts for insert to anon, authenticated with check (true);
create policy "accounts_update"
  on public.accounts for update to anon, authenticated using (true) with check (true);
create policy "accounts_delete"
  on public.accounts for delete to anon, authenticated using (true);

-- 7. Watch ratings + comments (when user marks a title watched)
alter table public.watchlist_items
  add column if not exists watch_rating numeric,
  add column if not exists watch_note text not null default '';

alter table public.watchlist_items
  drop constraint if exists watchlist_items_watch_rating_range;

alter table public.watchlist_items
  add constraint watchlist_items_watch_rating_range
  check (watch_rating is null or (watch_rating >= 0 and watch_rating <= 10));

update public.watchlist_items
set watch_rating = null, watch_note = ''
where watched = false;
