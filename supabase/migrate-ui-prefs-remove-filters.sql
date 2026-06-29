-- Remove transient filter/sort/search keys from lists.ui_prefs JSONB.
-- Keeps the ui_prefs column and any permanent keys (theme, language, layout, etc.).
-- Safe to run multiple times.
--
-- Keys removed (obsolete browsing state):
--   type, watchedFilter, ratingFilterSource, ratingFilterSort, selectedGenres,
--   search, searchQuery, sortSource, sortDirection, selectedFilters,
--   genreFilter, genreFilters, genres, contentType, typeFilter

UPDATE public.lists
SET ui_prefs = ui_prefs
  - 'type'
  - 'watchedFilter'
  - 'ratingFilterSource'
  - 'ratingFilterSort'
  - 'selectedGenres'
  - 'search'
  - 'searchQuery'
  - 'sortSource'
  - 'sortDirection'
  - 'selectedFilters'
  - 'genreFilter'
  - 'genreFilters'
  - 'genres'
  - 'contentType'
  - 'typeFilter'
WHERE ui_prefs IS NOT NULL
  AND ui_prefs != '{}'::jsonb;
