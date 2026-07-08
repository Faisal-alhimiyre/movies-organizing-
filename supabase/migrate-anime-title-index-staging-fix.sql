-- Fix ETL inserts into anime_title_index_staging (run once in SQL Editor)
-- Safe to re-run.

alter table public.anime_title_index_staging disable row level security;

grant all on table public.anime_title_index_staging to service_role;
grant all on table public.anime_title_index to service_role;
grant select, update on table public.anime_dataset_meta to service_role;

grant usage, select on all sequences in schema public to service_role;
