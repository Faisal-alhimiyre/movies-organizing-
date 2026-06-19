-- Our Movie Nights — account + multi-list schema
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Model:
--   account  = one sign-in code (shared with friends you trust)
--   lists    = many named lists per account (e.g. "Classic movies")
--   watchlist_items = titles inside a list

drop table if exists public.list_snapshots;

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

-- One row per sign-in code
create table if not exists public.accounts (
  account_id text primary key,
  updated_at timestamptz not null default now()
);

-- Many lists per account
create table if not exists public.lists (
  list_id text primary key,
  account_id text not null references public.accounts (account_id) on delete cascade,
  name text not null default 'My list',
  description text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists lists_account_id_idx
  on public.lists (account_id);

-- One row per title
create table if not exists public.watchlist_items (
  list_id text not null references public.lists (list_id) on delete cascade,
  item_id text not null,
  content_type text not null check (content_type in ('movies', 'tvSeries', 'anime')),
  genre text not null,
  title text not null,
  kind text not null default 'movie' check (kind in ('movie', 'film series', 'series')),
  lead text not null default '',
  leads jsonb not null default '[]'::jsonb,
  summary text not null default '',
  link text not null default '',
  secondary_genres jsonb not null default '[]'::jsonb,
  poster text not null default '',
  imdb_rating text not null default '',
  anilist_rating text not null default '',
  year text not null default '',
  watched boolean not null default false,
  watch_rating numeric,          -- user's score 0-10 when watched (null = not rated yet)
  watch_note text not null default '',  -- private comment when watched
  added_at timestamptz not null default now(),  -- when the title was added to the list
  updated_at timestamptz not null default now(),
  primary key (list_id, item_id)
);

create index if not exists watchlist_items_list_id_idx
  on public.watchlist_items (list_id);

create index if not exists watchlist_items_list_type_genre_idx
  on public.watchlist_items (list_id, content_type, genre);

create index if not exists watchlist_items_title_idx
  on public.watchlist_items (list_id, title);

alter table public.accounts enable row level security;
alter table public.lists enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.list_snapshots enable row level security;

-- Accounts
create policy "accounts_select"
  on public.accounts for select to anon, authenticated using (true);
create policy "accounts_insert"
  on public.accounts for insert to anon, authenticated with check (true);
create policy "accounts_update"
  on public.accounts for update to anon, authenticated using (true) with check (true);
create policy "accounts_delete"
  on public.accounts for delete to anon, authenticated using (true);

-- Lists
create policy "lists_select"
  on public.lists for select to anon, authenticated using (true);
create policy "lists_insert"
  on public.lists for insert to anon, authenticated with check (true);
create policy "lists_update"
  on public.lists for update to anon, authenticated using (true) with check (true);
create policy "lists_delete"
  on public.lists for delete to anon, authenticated using (true);

-- Items
create policy "watchlist_items_select"
  on public.watchlist_items for select to anon, authenticated using (true);
create policy "watchlist_items_insert"
  on public.watchlist_items for insert to anon, authenticated with check (true);
create policy "watchlist_items_update"
  on public.watchlist_items for update to anon, authenticated using (true) with check (true);
create policy "watchlist_items_delete"
  on public.watchlist_items for delete to anon, authenticated using (true);

-- Share snapshots (read-only copies for import links)
create policy "list_snapshots_select"
  on public.list_snapshots for select to anon, authenticated
  using (expires_at > now());
create policy "list_snapshots_insert"
  on public.list_snapshots for insert to anon, authenticated with check (true);

-- Already on the OLD single-list schema? Run this once to upgrade:
--
-- create table if not exists public.accounts (
--   account_id text primary key,
--   updated_at timestamptz not null default now()
-- );
-- alter table public.lists add column if not exists account_id text;
-- alter table public.lists add column if not exists name text not null default 'My list';
-- alter table public.lists add column if not exists description text not null default '';
-- update public.lists set account_id = list_id where account_id is null;
-- update public.lists set name = 'My list' where coalesce(name, '') = '';
-- insert into public.accounts (account_id, updated_at)
--   select distinct account_id, updated_at from public.lists
--   on conflict (account_id) do nothing;
-- alter table public.lists drop constraint if exists lists_account_id_fkey;
-- alter table public.lists
--   add constraint lists_account_id_fkey
--   foreign key (account_id) references public.accounts (account_id) on delete cascade;

-- Already have watchlist_items but no watch_rating / watch_note? Run once:
--   supabase/migrate-watch-ratings.sql
--
-- Already have watchlist_items but no anilist_rating? Run once:
--   supabase/migrate-anilist-rating.sql
--
-- Upgrading an older project? Run once:
--   supabase/migrate-incremental.sql
--
-- added_at on watchlist_items is the source of truth for "Recently added" sort
-- (synced to local addedAt in the app). updated_at is last metadata save only.

-- Wipe all cloud data (run ONLY after migrate-to-accounts.sql or full schema.sql):
-- delete from public.watchlist_items;
-- delete from public.lists;
-- delete from public.accounts;
--
-- Fresh install from scratch (wipes everything, then re-run schema.sql):
-- drop table if exists public.watchlist_items cascade;
-- drop table if exists public.lists cascade;
-- drop table if exists public.accounts cascade;
-- drop table if exists public.list_snapshots cascade;
