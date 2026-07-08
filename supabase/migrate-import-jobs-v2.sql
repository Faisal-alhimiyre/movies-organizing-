-- Superseded by migrate-import-jobs-fix.sql (meta column + RLS policies).
-- Kept for reference; safe to re-run migrate-import-jobs-fix.sql instead.

alter table public.import_items
  add column if not exists meta jsonb not null default '{}'::jsonb;
