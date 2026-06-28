/**
 * watch-progress.js
 *
 * Pure progress helpers — mirrors flutter_app/lib/core/utils/watch_progress.dart.
 *
 * Exposed as window.WatchlistProgress.
 *
 * Progress is stored INSIDE the existing watched-map entry alongside rating/note:
 *
 *   watched["tvSeries::Action::Breaking Bad"] = {
 *     rating: 9,
 *     note: "Amazing",
 *     progress: { version: 1, episodes: ["1:1", "1:2", "2:5"] }
 *   }
 *
 * Legacy formats accepted (all map to "legacy-complete"):
 *   null / missing key       → unwatched
 *   true                     → legacy-complete
 *   {}                       → legacy-complete
 *   { rating, note }         → legacy-complete (has user data, no granular progress)
 *   { …, progress: {…} }     → new granular format
 *
 * Episode keys are "seasonNumber:episodeNumber" strings, e.g. "1:5", "0:2" (specials).
 */
(function () {
  "use strict";

  const PROGRESS_VERSION = 1;

  // ─── key helpers ─────────────────────────────────────────────────────────────

  function episodeKey(seasonNum, episodeNum) {
    return `${seasonNum}:${episodeNum}`;
  }

  // ─── progress parsing ─────────────────────────────────────────────────────────

  /**
   * Parse the raw inner progress object `{ version, episodes }` safely.
   * Returns a normalised object even for null/bad input.
   */
  function parseProgressObject(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { version: PROGRESS_VERSION, episodes: [] };
    }
    const episodes = Array.isArray(raw.episodes)
      ? raw.episodes.filter((k) => typeof k === "string" && k.includes(":"))
      : [];
    const result = { version: PROGRESS_VERSION, episodes };
    // Preserve seasonTotals and completed flag — required for completion detection.
    if (raw.seasonTotals && typeof raw.seasonTotals === "object") {
      result.seasonTotals = raw.seasonTotals;
    }
    if (raw.completed === true) result.completed = true;
    if (typeof raw.moviePosition === "number" && Number.isFinite(raw.moviePosition)) {
      const pos = Math.max(0, Math.min(1, raw.moviePosition));
      if (pos > 0) result.moviePosition = Math.round(pos * 1000) / 1000;
    }
    if (raw.episodeRatings && typeof raw.episodeRatings === "object") {
      const cleaned = {};
      for (const [k, v] of Object.entries(raw.episodeRatings)) {
        if (typeof k !== "string" || !k.includes(":")) continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 10) continue;
        cleaned[k] = Math.round(n * 10) / 10;
      }
      if (Object.keys(cleaned).length) result.episodeRatings = cleaned;
    }
    return result;
  }

  /**
   * Normalise raw progress for persistence (localStorage / Supabase).
   * Returns null when there is nothing meaningful to store.
   */
  function exportProgressObject(raw) {
    const parsed = parseProgressObject(raw);
    if (parsed.episodes.length > 0) return parsed;
    if (typeof parsed.moviePosition === "number" && parsed.moviePosition > 0) {
      return parsed;
    }
    if (parsed.episodeRatings && Object.keys(parsed.episodeRatings).length > 0) {
      return parsed;
    }
    if (parsed.seasonTotals && Object.keys(parsed.seasonTotals).length > 0) {
      return parsed;
    }
    if (parsed.completed === true) return parsed;
    return null;
  }

  /**
   * Extract the progress sub-object from a full WatchEntry (which may also
   * have rating/note). Returns null when the entry is legacy-complete.
   */
  function getProgress(entry) {
    if (!entry || entry === true) return null;
    if (typeof entry !== "object") return null;
    if (entry.progress) return parseProgressObject(entry.progress);
    return null;
  }

  /** True when the entry has a granular progress field (not legacy-complete). */
  function hasGranularProgress(entry) {
    return getProgress(entry) !== null;
  }

  /**
   * True when the entry represents legacy-complete (title marked watched without
   * granular progress). Unwatched entries (null / missing) return false.
   */
  function isLegacyComplete(entry) {
    if (!entry) return false;
    return getProgress(entry) === null;
  }

  // ─── episode-level queries ────────────────────────────────────────────────────

  /**
   * Whether a specific episode is watched.
   *
   * Legacy-complete (no progress field) treats every episode as watched.
   */
  function isEpisodeWatched(entry, seasonNum, episodeNum) {
    if (!entry) return false;
    const progress = getProgress(entry);
    if (!progress) return Boolean(entry); // legacy-complete
    return progress.episodes.includes(episodeKey(seasonNum, episodeNum));
  }

  // ─── season-level queries ─────────────────────────────────────────────────────

  /**
   * How many aired episodes in a season are watched.
   *
   * @param airedEps  array of { seasonNumber, episodeNumber } objects
   */
  function watchedCountForSeason(entry, seasonNum, airedEps) {
    if (!entry || !airedEps) return 0;
    const progress = getProgress(entry);
    if (!progress) {
      // Legacy-complete: count all aired
      return (airedEps || []).length;
    }
    return airedEps.filter((ep) =>
      progress.episodes.includes(episodeKey(ep.seasonNumber, ep.episodeNumber))
    ).length;
  }

  function isSeasonFullyWatched(entry, seasonNum, airedEps) {
    if (!entry || !airedEps || airedEps.length === 0) return false;
    const progress = getProgress(entry);
    if (!progress) return Boolean(entry); // legacy-complete
    return airedEps.every((ep) =>
      progress.episodes.includes(episodeKey(ep.seasonNumber, ep.episodeNumber))
    );
  }

  function isSeasonPartiallyWatched(entry, seasonNum, airedEps) {
    if (!entry) return false;
    const progress = getProgress(entry);
    if (!progress) return false; // legacy-complete = fully watched, not partial
    if (!airedEps || airedEps.length === 0) return false;
    const watchedCount = airedEps.filter((ep) =>
      progress.episodes.includes(episodeKey(ep.seasonNumber, ep.episodeNumber))
    ).length;
    return watchedCount > 0 && watchedCount < airedEps.length;
  }

  // ─── title-level state derivation ────────────────────────────────────────────

  /**
   * Derive the watch state for a title.
   *
   * @param entry    watched-map value for this item (null = unwatched)
   * @param seasons  array of season objects. Each season:
   *                   { seasonNumber: int, episodes: [{ seasonNumber, episodeNumber, airDate? }] }
   *                 Only pass regular seasons (seasonNumber > 0) for completion.
   *                 Pass null/[] if episode data is not yet available.
   * @returns { state: 'unwatched'|'inprogress'|'watched', watchedEps, totalEps }
   */
  function itemWatchState(entry, seasons) {
    if (!entry) {
      return { state: "unwatched", watchedEps: 0, totalEps: _countAiredRegular(seasons) };
    }

    const regularSeasons = (seasons || []).filter((s) => s.seasonNumber > 0);

    // No episode data — binary state.
    if (!seasons || regularSeasons.length === 0) {
      return { state: "watched", watchedEps: 0, totalEps: 0 };
    }

    // Legacy-complete — no granular progress.
    const progress = getProgress(entry);
    if (!progress) {
      const total = _countAiredRegular(seasons);
      return { state: "watched", watchedEps: total, totalEps: total };
    }

    const airedKeys = _airedEpisodeKeys(regularSeasons);
    const totalCount = airedKeys.length;
    const watchedCount = airedKeys.filter((k) => progress.episodes.includes(k)).length;

    if (watchedCount === 0) return { state: "unwatched", watchedEps: 0, totalEps: totalCount };
    if (watchedCount >= totalCount) return { state: "watched", watchedEps: watchedCount, totalEps: totalCount };
    return { state: "inprogress", watchedEps: watchedCount, totalEps: totalCount };
  }

  // ─── mutation helpers ─────────────────────────────────────────────────────────
  // All return NEW entry objects — callers write back to state.watched.

  function getMoviePosition(entry) {
    const progress = getProgress(entry);
    if (!progress || typeof progress.moviePosition !== "number") return 0;
    const pos = Number(progress.moviePosition);
    if (!Number.isFinite(pos) || pos <= 0) return 0;
    return Math.max(0, Math.min(1, pos));
  }

  /**
   * @param {number} fraction 0–1 through the movie runtime
   */
  function setMoviePosition(entry, fraction) {
    const pos = Math.max(0, Math.min(1, Number(fraction) || 0));
    const base =
      entry && entry !== true && typeof entry === "object" ? { ...entry } : {};

    if (pos <= 0) {
      const existing = getProgress(base);
      if (!existing) return Object.keys(base).length ? base : null;
      const next = { ...existing };
      delete next.moviePosition;
      delete next.completed;
      if (_isEmptyProgress(next)) {
        delete base.progress;
        return Object.keys(base).length ? base : null;
      }
      base.progress = next;
      return base;
    }

    const episodes = getProgress(base)?.episodes || [];
    const rawProg = base.progress && typeof base.progress === "object" ? base.progress : null;
    const newProgress = {
      version: PROGRESS_VERSION,
      episodes: [...episodes],
      moviePosition: Math.round(pos * 1000) / 1000,
    };
    if (rawProg?.episodeRatings && typeof rawProg.episodeRatings === "object") {
      newProgress.episodeRatings = { ...rawProg.episodeRatings };
    }
    if (rawProg?.seasonTotals && typeof rawProg.seasonTotals === "object") {
      newProgress.seasonTotals = { ...rawProg.seasonTotals };
    }
    base.progress = newProgress;
    return base;
  }

  /** Movie watch state from stored position (0–1). */
  function movieWatchState(entry, completeThreshold = 0.97) {
    if (!entry) return "unwatched";
    const progress = getProgress(entry);
    if (!progress) return isLegacyComplete(entry) ? "watched" : "unwatched";
    const pos = getMoviePosition(entry);
    if (pos <= 0) return "unwatched";
    if (pos >= completeThreshold) return "watched";
    return "inprogress";
  }

  function _isEmptyProgress(prog) {
    if (!prog) return true;
    if (Array.isArray(prog.episodes) && prog.episodes.length > 0) return false;
    if (typeof prog.moviePosition === "number" && prog.moviePosition > 0) return false;
    if (prog.episodeRatings && Object.keys(prog.episodeRatings).length > 0) {
      return false;
    }
    if (prog.seasonTotals && Object.keys(prog.seasonTotals).length > 0) {
      return false;
    }
    if (prog.completed === true) return false;
    return true;
  }

  /**
   * Mark a single episode as watched.
   *
   * If the entry is legacy-complete AND allAiredKeys is provided, materialises
   * all aired keys first (only done on explicit user interaction).
   */
  function markEpisodeWatched(entry, seasonNum, episodeNum, allAiredKeys) {
    const key = episodeKey(seasonNum, episodeNum);
    const progress = getProgress(entry);
    let base;

    if (!entry) {
      base = [];
    } else if (!progress) {
      // Legacy-complete: materialise all aired + add the key.
      base = allAiredKeys ? [...allAiredKeys] : [];
    } else {
      base = [...progress.episodes];
    }

    if (!base.includes(key)) base.push(key);
    return _buildEntry(entry, base);
  }

  /**
   * Unmark a single episode.
   * REQUIRES allAiredKeys when the entry is legacy-complete, to materialise the
   * correct starting set minus the unchecked episode.
   */
  function unmarkEpisodeWatched(entry, seasonNum, episodeNum, allAiredKeys) {
    const key = episodeKey(seasonNum, episodeNum);
    const progress = getProgress(entry);
    let base;

    if (!entry) {
      base = [];
    } else if (!progress) {
      const keys = Array.isArray(allAiredKeys) ? allAiredKeys : [];
      base = keys.filter((k) => k !== key);
    } else {
      base = progress.episodes.filter((k) => k !== key);
    }

    return _buildEntry(entry, base);
  }

  /**
   * Mark all currently aired episodes in a season as watched.
   * @param airedKeys  array of "s:e" strings for this season's aired episodes.
   */
  function markSeasonWatched(entry, airedKeys) {
    const progress = getProgress(entry);
    const existing = progress ? [...progress.episodes] : [];
    const merged = [...new Set([...existing, ...airedKeys])];
    return _buildEntry(entry, merged);
  }

  /**
   * Unmark all episodes in a season.
   * For legacy-complete entries pass allAiredKeys to materialise the rest.
   */
  function unmarkSeasonWatched(entry, seasonNum, allAiredKeys) {
    const progress = getProgress(entry);
    let base;

    if (!entry) {
      base = [];
    } else if (!progress) {
      base = (Array.isArray(allAiredKeys) ? allAiredKeys : [])
        .filter((k) => !k.startsWith(`${seasonNum}:`));
    } else {
      base = progress.episodes.filter((k) => !k.startsWith(`${seasonNum}:`));
    }

    return _buildEntry(entry, base);
  }

  /**
   * Mark all aired regular-season episodes as watched (title-level mark-all).
   * Specials (seasonNumber === 0) are excluded.
   * @param allRegularAiredKeys  "s:e" strings from all regular aired episodes.
   */
  function markAllWatched(entry, allRegularAiredKeys) {
    return _buildEntry(entry, [...new Set(allRegularAiredKeys || [])]);
  }

  /**
   * Clear all progress and watched state.
   * Returns null so the caller removes the key from state.watched.
   */
  function clearAllProgress(/* entry */) {
    return null;
  }

  // ─── aired-episode helpers ────────────────────────────────────────────────────

  /**
   * Whether an episode counts toward completion.
   * @param ep  { airDate?: string|Date|null }
   */
  function isAiredEpisode(ep) {
    if (!ep || ep.airDate == null) return true; // unknown → assume aired
    const ms = ep.airDate instanceof Date
      ? ep.airDate.getTime()
      : new Date(ep.airDate).getTime();
    return Number.isFinite(ms) && ms <= Date.now();
  }

  /**
   * Collect "s:e" keys for all aired episodes across the given seasons.
   */
  function airedEpisodeKeys(seasons) {
    const keys = [];
    for (const season of seasons || []) {
      for (const ep of season.episodes || []) {
        if (isAiredEpisode(ep)) {
          keys.push(episodeKey(season.seasonNumber, ep.episodeNumber));
        }
      }
    }
    return keys;
  }

  // ─── private ─────────────────────────────────────────────────────────────────

  function _airedEpisodeKeys(seasons) {
    return airedEpisodeKeys(seasons);
  }

  function _countAiredRegular(seasons) {
    return _airedEpisodeKeys((seasons || []).filter((s) => s.seasonNumber > 0)).length;
  }

  /** Build a new WatchEntry preserving rating/note and setting new progress. */
  function _buildEntry(entry, episodes) {
    const base = entry && entry !== true && typeof entry === "object"
      ? { ...entry }
      : {};
    // Read raw progress BEFORE deleting it — parseProgressObject is lossy for extras.
    const rawProg = base.progress && typeof base.progress === "object" ? base.progress : null;
    delete base.progress;
    const newProgress = { version: PROGRESS_VERSION, episodes };
    // Carry forward stored per-season totals so annotateCompletion can evaluate
    // completion even for seasons that aren't currently loaded in the panel.
    if (rawProg?.seasonTotals && typeof rawProg.seasonTotals === "object") {
      newProgress.seasonTotals = { ...rawProg.seasonTotals };
    }
    if (rawProg?.episodeRatings && typeof rawProg.episodeRatings === "object") {
      newProgress.episodeRatings = { ...rawProg.episodeRatings };
    }
    if (rawProg?.completed === true) {
      newProgress.completed = true;
    }
    if (rawProg?.moviePosition > 0) {
      newProgress.moviePosition = rawProg.moviePosition;
    }
    base.progress = newProgress;
    return base;
  }

  function getEpisodeRating(entry, seasonNum, episodeNum) {
    const prog = getProgress(entry);
    if (!prog?.episodeRatings) return null;
    const val = prog.episodeRatings[episodeKey(seasonNum, episodeNum)];
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0 || num > 10) return null;
    return Math.round(num * 10) / 10;
  }

  function setEpisodeRating(entry, seasonNum, episodeNum, rating) {
    const num = Number(rating);
    if (!Number.isFinite(num) || num < 0 || num > 10) return entry;
    const key = episodeKey(seasonNum, episodeNum);
    let episodes = getProgress(entry)?.episodes;
    if (!Array.isArray(episodes)) episodes = [];
    else episodes = [...episodes];
    if (!episodes.includes(key)) episodes.push(key);
    const next = _buildEntry(entry, episodes);
    if (!next.progress.episodeRatings || typeof next.progress.episodeRatings !== "object") {
      next.progress.episodeRatings = {};
    }
    next.progress.episodeRatings[key] = Math.round(num * 10) / 10;
    return next;
  }

  function clearEpisodeRating(entry, seasonNum, episodeNum) {
    const key = episodeKey(seasonNum, episodeNum);
    const prog = getProgress(entry);
    if (!prog?.episodeRatings || !(key in prog.episodeRatings)) return entry;
    const next = _buildEntry(entry, prog.episodes || []);
    if (!next.progress.episodeRatings || typeof next.progress.episodeRatings !== "object") {
      return next;
    }
    delete next.progress.episodeRatings[key];
    if (Object.keys(next.progress.episodeRatings).length === 0) {
      delete next.progress.episodeRatings;
    }
    return next;
  }

  // ─── export ───────────────────────────────────────────────────────────────────

  window.WatchlistProgress = {
    episodeKey,
    parseProgressObject,
    exportProgressObject,
    getProgress,
    hasGranularProgress,
    isLegacyComplete,
    isEpisodeWatched,
    watchedCountForSeason,
    isSeasonFullyWatched,
    isSeasonPartiallyWatched,
    itemWatchState,
    markEpisodeWatched,
    unmarkEpisodeWatched,
    markSeasonWatched,
    unmarkSeasonWatched,
    markAllWatched,
    clearAllProgress,
    getEpisodeRating,
    setEpisodeRating,
    clearEpisodeRating,
    getMoviePosition,
    setMoviePosition,
    movieWatchState,
    isAiredEpisode,
    airedEpisodeKeys,
  };
})();
