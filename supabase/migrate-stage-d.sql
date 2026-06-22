-- Stage D: Three-state watch progress (Unwatched / In progress / Watched)
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE throughout.
-- For fresh installs use schema.sql which already includes everything.
--
-- Changes introduced in Stage D
-- ─────────────────────────────
-- 1. watch_progress now carries an optional `completed` boolean flag:
--      { "version": 1, "episodes": ["1:1","1:2"], "completed": true }
--    This allows the client to distinguish a fully-tracked-complete title from
--    an in-progress one without storing all episode counts server-side.
--
-- 2. `watched` column semantics (sync.js change, reflected here):
--      true  = legacy-complete (no granular progress) OR granular-complete
--      false = never touched, OR purely in-progress tracking
--    The sync layer now writes watched=false for in-progress items so that
--    watched_count is accurate.
--
-- 3. `lists.in_progress_count` — new denormalized counter.
--
-- 4. `lists.watched_count` updated to count correctly:
--      watched=true  OR  watch_progress.completed=true
--    (The two cases overlap once the client correctly sets watched=true for
--    granular-complete items, but the OR keeps the query correct for any
--    pre-migration rows that have completed=true but watched=false.)
--
-- 5. Existing in-progress rows (watched=true + episodes > 0 + no completed
--    flag + no rating + no note) are corrected to watched=false.
--
-- 6. Performance index on in-progress rows.

-- ── 1. Add in_progress_count column ─────────────────────────────────────────

ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS in_progress_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.lists
  DROP CONSTRAINT IF EXISTS lists_in_progress_count_nonneg;

ALTER TABLE public.lists
  ADD CONSTRAINT lists_in_progress_count_nonneg
    CHECK (in_progress_count >= 0);

-- ── 2. Relax / re-document watch_progress constraint ────────────────────────
-- The existing constraint already permits { version:1, episodes:[...], completed:... }
-- via the version=1 branch. We drop and re-add with clearer intent.

ALTER TABLE public.watchlist_items
  DROP CONSTRAINT IF EXISTS watchlist_items_watch_progress_version;

ALTER TABLE public.watchlist_items
  ADD CONSTRAINT watchlist_items_watch_progress_version CHECK (
    -- Any object with "version":1 is valid (episodes + optional completed flag)
    (watch_progress->>'version')::INT = 1
    OR watch_progress = '{}'::JSONB
    OR watch_progress = '{"version":1,"episodes":[]}'::JSONB
  );

-- ── 3. Performance index for in-progress queries ─────────────────────────────

CREATE INDEX IF NOT EXISTS watchlist_items_in_progress_idx
  ON public.watchlist_items (list_id)
  WHERE watched = FALSE
    AND jsonb_typeof(watch_progress->'episodes') = 'array'
    AND jsonb_array_length(watch_progress->'episodes') > 0;

-- ── 4. Update refresh_list_stats to compute all three counts ─────────────────

CREATE OR REPLACE FUNCTION public.refresh_list_stats(p_list_id TEXT)
RETURNS VOID
LANGUAGE SQL
AS $$
  UPDATE public.lists
  SET
    title_count = (
      SELECT COUNT(*)::INTEGER
      FROM public.watchlist_items
      WHERE list_id = p_list_id
    ),
    -- Watched = legacy-complete (watched=true) OR granular-complete (completed=true)
    watched_count = (
      SELECT COUNT(*)::INTEGER
      FROM public.watchlist_items
      WHERE list_id = p_list_id
        AND (
          watched = TRUE
          OR (watch_progress->>'completed')::BOOLEAN IS TRUE
        )
    ),
    -- In progress = watched=false, has at least one episode key, not marked complete
    in_progress_count = (
      SELECT COUNT(*)::INTEGER
      FROM public.watchlist_items
      WHERE list_id = p_list_id
        AND watched = FALSE
        AND (watch_progress->>'completed') IS DISTINCT FROM 'true'
        AND jsonb_typeof(watch_progress->'episodes') = 'array'
        AND jsonb_array_length(watch_progress->'episodes') > 0
    )
  WHERE list_id = p_list_id;
$$;

-- ── 5. Correct pre-migration in-progress rows ─────────────────────────────────
-- Rows where:
--   • watched=true (old sync wrote true for all entries)
--   • has granular episode progress
--   • NOT granular-complete (no completed flag)
--   • no user rating set (pure in-progress, not a watch + rate scenario)
--   • no watch note set
-- These should be watched=false under the new model.

UPDATE public.watchlist_items
SET watched = FALSE
WHERE watched = TRUE
  AND (watch_progress->>'completed') IS DISTINCT FROM 'true'
  AND jsonb_typeof(watch_progress->'episodes') = 'array'
  AND jsonb_array_length(watch_progress->'episodes') > 0
  AND watch_rating IS NULL
  AND (watch_note IS NULL OR watch_note = '');

-- ── 6. Re-compute all list stats with the updated function ───────────────────

SELECT public.refresh_list_stats(list_id)
FROM public.lists;
