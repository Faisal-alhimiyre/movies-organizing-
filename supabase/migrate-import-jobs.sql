-- Bulk import job persistence (replaces large localStorage payloads)
-- Run once in: Supabase Dashboard → SQL Editor

create table if not exists public.import_jobs (
  list_id text primary key references public.lists (list_id) on delete cascade,
  job_id text not null,
  account_id text not null,
  status text not null default 'idle',
  paused boolean not null default false,
  format text not null default 'tsv',
  stats jsonb not null default '{}'::jsonb,
  provider_ids jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  next_index integer not null default 0,
  checked_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists import_jobs_account_id_idx
  on public.import_jobs (account_id);

create index if not exists import_jobs_updated_at_idx
  on public.import_jobs (updated_at desc);

create table if not exists public.import_items (
  list_id text not null references public.lists (list_id) on delete cascade,
  item_id text not null,
  line integer not null default 0,
  title text not null default '',
  imported_title text not null default '',
  year integer,
  content_type text not null default '',
  status text not null default 'pending',
  match_status text not null default '',
  metadata_status text not null default '',
  failure_kind text not null default '',
  error text not null default '',
  provider_id text not null default '',
  watchlist_item_id text not null default '',
  pick jsonb,
  details jsonb,
  candidates jsonb,
  added_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (list_id, item_id)
);

create index if not exists import_items_list_status_idx
  on public.import_items (list_id, status);

create index if not exists import_items_list_line_idx
  on public.import_items (list_id, line);

alter table public.import_jobs enable row level security;
alter table public.import_items enable row level security;

grant all on table public.import_jobs to anon, authenticated, service_role;
grant all on table public.import_items to anon, authenticated, service_role;

-- After creating tables, run: supabase/migrate-import-jobs-fix.sql
-- (adds import_items.meta + RLS policies for import_jobs / import_items)
