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
      console.warn("[tmdb-service] resolveByImdb failed:", err.message);
      return null;
    }
  }

  /**
   * Fetch per-episode ratings for one season.
   * @returns {Promise<Array<{ episodeNumber: number, rating: number|null, voteCount: number }>|null>}
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
      return result.episodes;
    } catch (err) {
      console.warn("[tmdb-service] fetchSeasonRatings failed:", err.message);
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
      console.warn("[tmdb-service] search failed:", err.message);
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
      console.warn("[tmdb-service] getDetails failed:", err.message);
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
      console.warn("[tmdb-service] fetchTv failed:", err.message);
      return null;
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
    isAvailable,
  };
})();
