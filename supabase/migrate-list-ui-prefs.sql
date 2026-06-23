-- Persist per-list UI preferences across devices
-- Stores tab/filter/sort preferences in lists.ui_prefs
-- Safe to run multiple times.

ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS ui_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

