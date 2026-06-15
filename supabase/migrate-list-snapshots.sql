-- Temporary share links (snapshot copies — not live list access)
-- Run once in Supabase Dashboard → SQL Editor

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
