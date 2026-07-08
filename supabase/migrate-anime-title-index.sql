-- Offline anime identity index (Phase 2)
-- Run once in: Supabase Dashboard → SQL Editor
--
-- DATA SOURCE (ODbL 1.0 + DbCL 1.0):
--   anime-offline-database by manami-project (ARCHIVED / read-only)
--   https://github.com/manami-project/anime-offline-database
--   Pinned release: 2026-27 · lastUpdate 2026-07-04 · 41,537 entries
--
-- ATTRIBUTION (required):
--   "Anime identity data contains information from anime-offline-database
--    by manami-project, available under ODbL 1.0 and DbCL 1.0."
--
-- UPSTREAM STATUS:
--   Repository is archived — no future official releases are expected.
--   Do not auto-download from unverified forks. See docs/ANIME-DATASET.md.
--
-- SHARE-ALIKE:
--   This searchable derivative index is a Produced Work under ODbL.
--   See docs/ANIME-DATA-LICENSE.md
--
-- SEPARATION:
--   Licensed identity metadata only — never merge user watchlist data here.
--
-- POPULATION: scripts/anime-index-etl/ (pinned release; manual replacement only)
-- SEARCH: edge function anime-index-search

create extension if not exists pg_trgm;

-- Drop Phase 1 stub if present (safe on fresh installs)
drop table if exists public.anime_title_index_staging;
drop table if exists public.anime_title_index;

create table public.anime_title_index (
  id bigint generated always as identity primary key,
  anilist_id integer,
  mal_id integer,
  canonical_title text not null default '',
  english_title text not null default '',
  romaji_title text not null default '',
  native_title text not null default '',
  synonyms jsonb not null default '[]'::jsonb,
  start_year integer,
  format text not null default '',
  provider_urls jsonb not null default '[]'::jsonb,
  picture_url text not null default '',
  normalized_search_terms text[] not null default '{}',
  dataset_version text not null default '',
  upstream_last_update date,
  updated_at timestamptz not null default now(),
  constraint anime_title_index_anilist_unique unique (anilist_id)
);

create table public.anime_title_index_staging (
  like public.anime_title_index including all
);

create table if not exists public.anime_dataset_meta (
  id integer primary key default 1 check (id = 1),
  active_version text not null default '',
  upstream_release text not null default '',
  upstream_last_update date,
  downloaded_at timestamptz,
  checksum_sha256 text not null default '',
  imported_rows integer not null default 0,
  accepted_rows integer not null default 0,
  rejected_rows integer not null default 0,
  previous_version text not null default '',
  notes text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.anime_dataset_meta (id)
values (1)
on conflict (id) do nothing;

create index if not exists anime_title_index_start_year_idx
  on public.anime_title_index (start_year);

create index if not exists anime_title_index_format_idx
  on public.anime_title_index (format);

create index if not exists anime_title_index_normalized_gin_idx
  on public.anime_title_index using gin (normalized_search_terms);

create index if not exists anime_title_index_english_trgm_idx
  on public.anime_title_index using gin (english_title gin_trgm_ops);

create index if not exists anime_title_index_canonical_trgm_idx
  on public.anime_title_index using gin (canonical_title gin_trgm_ops);

create index if not exists anime_title_index_staging_normalized_gin_idx
  on public.anime_title_index_staging using gin (normalized_search_terms);

-- Shared canonical metadata cache (user-requested titles only — NOT part of ODbL dump)
create table if not exists public.title_provider_cache (
  provider text not null,
  provider_id text not null,
  canonical_title text not null default '',
  display_title text not null default '',
  year text not null default '',
  content_type text not null default 'anime',
  poster text not null default '',
  payload jsonb not null default '{}'::jsonb,
  request_count integer not null default 1 check (request_count >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, provider_id)
);

create index if not exists title_provider_cache_updated_idx
  on public.title_provider_cache (updated_at desc);

-- Atomic activation: rename staging → active (instant; no 41k-row copy)
create or replace function public.recreate_anime_title_index_staging()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'anime_title_index_staging'
  ) then
    return;
  end if;

  create table public.anime_title_index_staging (
    id bigint generated always as identity primary key,
    anilist_id integer,
    mal_id integer,
    canonical_title text not null default '',
    english_title text not null default '',
    romaji_title text not null default '',
    native_title text not null default '',
    synonyms jsonb not null default '[]'::jsonb,
    start_year integer,
    format text not null default '',
    provider_urls jsonb not null default '[]'::jsonb,
    picture_url text not null default '',
    normalized_search_terms text[] not null default '{}',
    dataset_version text not null default '',
    upstream_last_update date,
    updated_at timestamptz not null default now(),
    constraint anime_title_index_staging_anilist_unique unique (anilist_id)
  );

  create index if not exists anime_title_index_stg_norm_gin_idx
    on public.anime_title_index_staging using gin (normalized_search_terms);
end;
$$;

create or replace function public.ensure_anime_title_index_search_indexes()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('statement_timeout', '0', true);

  drop index if exists public.anime_title_index_staging_normalized_gin_idx;

  create index if not exists anime_title_index_start_year_idx
    on public.anime_title_index (start_year);

  create index if not exists anime_title_index_format_idx
    on public.anime_title_index (format);

  create index if not exists anime_title_index_normalized_gin_idx
    on public.anime_title_index using gin (normalized_search_terms);

  create index if not exists anime_title_index_english_trgm_idx
    on public.anime_title_index using gin (english_title gin_trgm_ops);

  create index if not exists anime_title_index_canonical_trgm_idx
    on public.anime_title_index using gin (canonical_title gin_trgm_ops);
end;
$$;

create or replace function public.truncate_anime_title_index_staging()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate public.anime_title_index_staging;
end;
$$;

create or replace function public.activate_anime_title_index(
  p_version text,
  p_upstream_release text,
  p_upstream_last_update date,
  p_downloaded_at timestamptz,
  p_checksum_sha256 text,
  p_imported_rows integer,
  p_accepted_rows integer,
  p_rejected_rows integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  staging_count integer;
  active_count integer;
  staging_exists boolean;
begin
  perform set_config('statement_timeout', '0', true);

  select exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'anime_title_index_staging'
  ) into staging_exists;

  select count(*) into active_count from public.anime_title_index;

  if staging_exists then
    select count(*) into staging_count from public.anime_title_index_staging;

    if staging_count > 0 then
      if p_accepted_rows > 0 and staging_count < p_accepted_rows * 0.95 then
        raise exception 'Staging count % below expected accepted %', staging_count, p_accepted_rows;
      end if;

      drop table if exists public.anime_title_index_old;
      alter table public.anime_title_index rename to anime_title_index_old;
      alter table public.anime_title_index_staging rename to anime_title_index;
    end if;
  elsif active_count < 35000 then
    raise exception 'No staging table and active index only has % rows', active_count;
  end if;

  perform public.recreate_anime_title_index_staging();
  perform public.ensure_anime_title_index_search_indexes();
  drop table if exists public.anime_title_index_old;

  update public.anime_dataset_meta
  set
    previous_version = active_version,
    active_version = p_version,
    upstream_release = p_upstream_release,
    upstream_last_update = p_upstream_last_update,
    downloaded_at = p_downloaded_at,
    checksum_sha256 = p_checksum_sha256,
    imported_rows = p_imported_rows,
    accepted_rows = p_accepted_rows,
    rejected_rows = p_rejected_rows,
    updated_at = now()
  where id = 1;
end;
$$;

alter table public.anime_title_index enable row level security;
alter table public.anime_title_index_staging enable row level security;
alter table public.anime_dataset_meta enable row level security;
alter table public.title_provider_cache enable row level security;

-- Edge function uses service role; no anon SELECT on full index.
