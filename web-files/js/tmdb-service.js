/**
 * tmdb-service.js — Browser client for the tmdb-metadata Supabase Edge Function.
 *
 * Used for per-episode ratings when no client-side TMDB API key is configured.
 * The TMDB API key stays on the server.
 *
 * Exposes: window.WatchlistTmdb
 */
(() => {
  "use strict";

  const FUNCTION_NAME = "tmdb-metadata";

  function isServiceDebugEnabled() {
    try {
      return localStorage.getItem("watchlist-debug-add") === "1";
    } catch {
      return false;
    }
  }

  function logServiceWarn(label, err) {
    if (!isServiceDebugEnabled()) return;
    console.warn(label, err?.message || err);
  }

  function getFunctionUrl() {
    const url = (window.WATCHLIST_CONFIG?.supabaseUrl || "").replace(/\/$/, "");
    if (!url) return null;
    return `${url}/functions/v1/${FUNCTION_NAME}`;
  }

  function getAnonKey() {
    return window.WATCHLIST_CONFIG?.supabaseAnonKey || "";
  }

  async function callFunction(payload) {
    const url = getFunctionUrl();
    if (!url) throw new Error("Supabase not configured — tmdb-service unavailable");

    const anonKey = getAnonKey();
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`tmdb-metadata ${resp.status}: ${text.slice(0, 120)}`);
    }

    return resp.json();
  }

  /**
   * Resolve a TMDB TV series ID from an IMDb series ID.
   * @param {string} imdbId
   * @returns {Promise<number|null>}
   */
  async function resolveByImdb(imdbId) {
    if (!imdbId) return null;
    try {
      const result = await callFunction({ action: "resolve", imdbId });
      const tmdbId = Number(result?.tmdbId);
      return Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null;
    } catch (err) {
      logServiceWarn("[tmdb-service] resolveByImdb failed:", err);
      return null;
    }
  }

  /**
   * Fetch season-level + per-episode ratings for one season (one edge call).
   * @returns {Promise<{ episodes: Array<{ episodeNumber: number, rating: number|null, voteCount: number }>, seasonRating: number|null }|null>}
   */
  async function fetchSeasonRatings(tmdbId, season, locale = "en") {
    if (!tmdbId || season == null) return null;
    try {
      const result = await callFunction({
        action: "seasonRatings",
        tmdbId,
        season,
        locale,
      });
      if (!result || result.error || !Array.isArray(result.episodes)) return null;
      const seasonVote = Number(result.seasonRating);
      return {
        episodes: result.episodes,
        seasonRating:
          Number.isFinite(seasonVote) && seasonVote > 0 && seasonVote <= 10
            ? Math.round(seasonVote * 10) / 10
            : null,
      };
    } catch (err) {
      logServiceWarn("[tmdb-service] fetchSeasonRatings failed:", err);
      return null;
    }
  }

  /**
   * Search for titles via TMDB multi-search.
   * @param {string} query
   * @param {string} [type]  "multi" | "movie" | "tv"
   * @param {number} [page]
   * @param {string} [locale]  "en" | "ar"
   * @returns {Promise<{ ok: boolean, results: Array, total: number }>}
   */
  async function search(query, type = "multi", page = 1, locale = "en") {
    if (!query || query.trim().length < 2) {
      return { ok: false, error: "query_too_short", results: [] };
    }
    try {
      const result = await callFunction({
        action: "search",
        query: query.trim(),
        type,
        page,
        locale,
      });
      if (!result || result.error) {
        return { ok: false, error: result?.error || "api_failure", results: [] };
      }
      return { ok: true, results: result.results || [], total: result.total || 0 };
    } catch (err) {
      logServiceWarn("[tmdb-service] search failed:", err);
      return { ok: false, error: err.message, results: [] };
    }
  }

  /**
   * Fetch full details for a single title via the edge function.
   * Used when no client-side TMDB API key is configured.
   * @param {string} mediaType  "movie" | "tv"
   * @param {number} tmdbId
   * @param {string} [locale]
   * @returns {Promise<object|null>}  normalized detail object or null
   */
  async function getDetails(mediaType, tmdbId, locale = "en") {
    if (!mediaType || !tmdbId) return null;
    try {
      const result = await callFunction({
        action: "details",
        mediaType,
        tmdbId,
        locale,
      });
      if (!result || result.error || !result.details) return null;
      return result.details;
    } catch (err) {
      logServiceWarn("[tmdb-service] getDetails failed:", err);
      return null;
    }
  }

  /**
   * Fetch raw TMDB TV show or season JSON via the edge function.
   * Used for season lists/episodes when no client-side TMDB API key is set.
   */
  async function fetchTv(tmdbId, { season = null, locale = "en" } = {}) {
    if (!tmdbId) return null;
    try {
      const result = await callFunction({
        action: "tvFetch",
        tmdbId,
        ...(season != null ? { season } : {}),
        locale,
      });
      if (!result || result.error || !result.data) return null;
      return result.data;
    } catch (err) {
      logServiceWarn("[tmdb-service] fetchTv failed:", err);
      return null;
    }
  }

  /**
   * IMDb suggestion search (proxied) — matches alternate titles/AKAs the way
   * IMDb's own search box does (e.g. "seven" → Se7en).
   * @param {string} query
   * @returns {Promise<{ ok: boolean, results: Array }>}
   */
  async function imdbSuggest(query) {
    const q = String(query || "").trim();
    if (q.length < 2) return { ok: false, error: "query_too_short", results: [] };
    try {
      const result = await callFunction({ action: "imdbSuggest", query: q });
      if (!result || result.error) {
        return { ok: false, error: result?.error || "api_failure", results: [] };
      }
      return { ok: true, results: result.results || [] };
    } catch (err) {
      logServiceWarn("[tmdb-service] imdbSuggest failed:", err);
      return { ok: false, error: err.message, results: [] };
    }
  }

  /**
   * Similar / recommended titles for a movie or TV show (TMDB).
   * Pass tmdbId + mediaType ("movie"|"tv"), or imdbId to resolve first.
   */
  async function fetchSimilar({
    tmdbId = null,
    mediaType = "tv",
    imdbId = "",
    locale = "en",
  } = {}) {
    try {
      const result = await callFunction({
        action: "similar",
        tmdbId,
        mediaType,
        imdbId,
        locale,
      });
      if (!result || result.error) {
        return { ok: false, error: result?.error || "api_failure", results: [] };
      }
      return { ok: true, results: result.results || [] };
    } catch (err) {
      logServiceWarn("[tmdb-service] fetchSimilar failed:", err);
      return { ok: false, error: err.message, results: [] };
    }
  }

  /**
   * Franchise / spin-off movies for a TV series (TMDB movie search by series title).
   * Complements TVDB season-0 linked films (e.g. El Camino for Breaking Bad).
   */
  async function fetchRelatedMovies({
    tmdbId = null,
    imdbId = "",
    title = "",
    locale = "en",
  } = {}) {
    try {
      const result = await callFunction({
        action: "relatedMovies",
        tmdbId,
        imdbId,
        title,
        locale,
      });
      if (!result || result.error || !Array.isArray(result.movies)) {
        return { ok: false, error: result?.error || "api_failure", movies: [] };
      }
      return { ok: true, movies: result.movies };
    } catch (err) {
      logServiceWarn("[tmdb-service] fetchRelatedMovies failed:", err);
      return { ok: false, error: err.message, movies: [] };
    }
  }

  /** True when Supabase is configured so the edge function is reachable. */
  function isAvailable() {
    return !!getFunctionUrl();
  }

  window.WatchlistTmdb = {
    resolveByImdb,
    fetchSeasonRatings,
    search,
    getDetails,
    fetchTv,
    imdbSuggest,
    fetchSimilar,
    fetchRelatedMovies,
    isAvailable,
  };
})();
