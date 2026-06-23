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

  window.WatchlistTmdb = {
    resolveByImdb,
    fetchSeasonRatings,
  };
})();
