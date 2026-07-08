-- Fast activation + recovery for partial runs.
-- Safe to re-run. Run the full file in SQL Editor.

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

  -- Index names are unique per schema; use a staging-specific name that won't
  -- collide with indexes left on anime_title_index after a rename swap.
  create index if not exists anime_title_index_stg_norm_gin_idx
    on public.anime_title_index_staging using gin (normalized_search_terms);

  alter table public.anime_title_index_staging disable row level security;
  grant all on table public.anime_title_index_staging to service_role;
  grant usage, select on all sequences in schema public to service_role;
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

-- Finish activation (works after a partial swap too):
select public.activate_anime_title_index(
  '2026-27',
  '2026-27',
  '2026-07-04'::date,
  now(),
  '9ed7e3fd8f0f47b63d977e915a555b7f6e552a7a25a465773451dbccd9cb8e03',
  41537,
  41397,
  140
);

select count(*) as active_rows from public.anime_title_index;
select active_version, accepted_rows from public.anime_dataset_meta where id = 1;
