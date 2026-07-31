-- Shared series / season / episode catalog cache (app-owned, not user data).
--
-- Used by Edge Functions (tmdb-metadata, tvdb-metadata) so one successful
-- upstream fetch can serve all users until TTL expires — reduces rate limits
-- and the "no season data cached" empty state on cold devices.
--
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run
-- Idempotent — safe to run multiple times.
--
-- Security model matches title_provider_cache: open read/write for anon until
-- Phase 4 auth/RLS hardening. Prefer Edge Function writes via service role.

create table if not exists public.series_metadata_cache (
  cache_key text primary key,
  provider text not null,
  kind text not null,
  locale text not null default 'en',
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint series_metadata_cache_provider_check
    check (provider in ('tmdb', 'tvdb', 'anilist', 'omdb')),
  constraint series_metadata_cache_kind_check
    check (char_length(kind) between 1 and 64)
);

create index if not exists series_metadata_cache_expires_idx
  on public.series_metadata_cache (expires_at);

create index if not exists series_metadata_cache_provider_kind_idx
  on public.series_metadata_cache (provider, kind);

alter table public.series_metadata_cache enable row level security;

drop policy if exists "series_metadata_cache_select" on public.series_metadata_cache;
create policy "series_metadata_cache_select"
  on public.series_metadata_cache for select to anon, authenticated
  using (true);

drop policy if exists "series_metadata_cache_insert" on public.series_metadata_cache;
create policy "series_metadata_cache_insert"
  on public.series_metadata_cache for insert to anon, authenticated
  with check (true);

drop policy if exists "series_metadata_cache_update" on public.series_metadata_cache;
create policy "series_metadata_cache_update"
  on public.series_metadata_cache for update to anon, authenticated
  using (true) with check (true);

-- Optional: allow edge / maintenance to delete expired rows later
drop policy if exists "series_metadata_cache_delete" on public.series_metadata_cache;
create policy "series_metadata_cache_delete"
  on public.series_metadata_cache for delete to anon, authenticated
  using (true);
