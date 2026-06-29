-- Per-list UI preferences (permanent settings only; filters are session-local).
-- Transient filter/sort keys are stripped by migrate-ui-prefs-remove-filters.sql.
-- Safe to run multiple times.

ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS ui_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

