/**
 * tvdb-service.js — Browser client for the tvdb-metadata Supabase Edge Function.
 *
 * The website calls this module; the Edge Function holds the secret key.
 * The API key and bearer token never reach the browser.
 *
 * Exposes: window.WatchlistTvdb
 */
(() => {
  "use strict";

  const FUNCTION_NAME = "tvdb-metadata";

  // ── Supabase project endpoint ─────────────────────────────────────────
  function getFunctionUrl() {
    const url = (window.WATCHLIST_CONFIG?.supabaseUrl || "").replace(/\/$/, "");
    if (!url) return null;
    return `${url}/functions/v1/${FUNCTION_NAME}`;
  }

  function getAnonKey() {
    return window.WATCHLIST_CONFIG?.supabaseAnonKey || "";
  }

  // ── Core fetch ────────────────────────────────────────────────────────
  async function callFunction(payload) {
    const url = getFunctionUrl();
    if (!url) throw new Error("Supabase not configured — tvdb-service unavailable");

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
      throw new Error(`tvdb-metadata ${resp.status}: ${text.slice(0, 120)}`);
    }

    return resp.json();
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Resolve a TheTVDB series ID from available external identifiers.
   * Pass at most one of: { tvdbId }, { imdbId }, { tmdbId }.
   * Returns null on any failure or when not found.
   *
   * @param {{ tvdbId?: number, imdbId?: string, tmdbId?: number }} opts
   * @returns {Promise<{ tvdbId: number, matchSource: string, confidence: string } | null>}
   */
  async function resolveId(opts = {}) {
    try {
      const result = await callFunction({ action: "resolve", ...opts });
      if (!result || result.error || !result.tvdbId) return null;
      return result;
    } catch (err) {
      console.warn("[tvdb-service] resolveId failed:", err.message);
      return null;
    }
  }

  /**
   * Fetch series-level metadata from TheTVDB.
   *
   * @param {number} tvdbId
   * @returns {Promise<{
   *   source: "tvdb", tvdbId: number, imdbId: string|null,
   *   title: string, overview: string, poster: string,
   *   status: string, firstAired: string|null
   * } | null>}
   */
  async function fetchSeries(tvdbId, locale = "en") {
    if (!tvdbId) return null;
    try {
      const result = await callFunction({ action: "series", tvdbId, locale });
      if (!result || result.error) return null;
      return result;
    } catch (err) {
      console.warn("[tvdb-service] fetchSeries failed:", err.message);
      return null;
    }
  }

  /**
   * Fetch the season list for a series.
   *
   * @param {number} tvdbId
   * @returns {Promise<Array<{
   *   source: "tvdb", seasonNumber: number, tvdbSeasonId: number,
   *   name: string, poster: string, overview: string,
   *   airDate: string|null, isSpecials: boolean
   * }> | null>}
   */
  async function fetchSeasons(tvdbId, locale = "en") {
    if (!tvdbId) return null;
    try {
      const result = await callFunction({ action: "seasons", tvdbId, locale });
      if (!result || result.error || !Array.isArray(result.seasons)) return null;
      return result.seasons;
    } catch (err) {
      console.warn("[tvdb-service] fetchSeasons failed:", err.message);
      return null;
    }
  }

  /**
   * Fetch normalized episodes for one season (default ordering).
   *
   * @param {number} tvdbId
   * @param {number} season  Season number (0 = Specials)
   * @returns {Promise<Array<{
   *   source: "tvdb", tvdbEpId: number, seriesTvdbId: number,
   *   seasonNumber: number, episodeNumber: number,
   *   title: string, overview: string,
   *   still: string,           // episode-specific image URL or ""
   *   runtimeMinutes: number|null,
   *   airDate: string|null, isAired: boolean,
   *   progressKey: string      // "seasonNumber:episodeNumber"
   * }> | null>}
   */
  async function fetchEpisodes(tvdbId, season, locale = "en") {
    if (!tvdbId || season == null) return null;
    try {
      const result = await callFunction({ action: "episodes", tvdbId, season, locale });
      if (!result || result.error || !Array.isArray(result.episodes)) return null;
      return result.episodes;
    } catch (err) {
      console.warn("[tvdb-service] fetchEpisodes failed:", err.message);
      return null;
    }
  }

  /**
   * Count regular episodes across all official seasons (excludes specials).
   *
   * @param {number} tvdbId
   * @returns {Promise<{ episodeTotal: number, seasonCounts: Record<string, number> } | null>}
   */
  async function fetchEpisodeTotals(tvdbId, locale = "en") {
    if (!tvdbId) return null;
    try {
      const result = await callFunction({ action: "episodeTotals", tvdbId, locale });
      if (!result || result.error) return null;
      const episodeTotal = Number(result.episodeTotal);
      if (!Number.isFinite(episodeTotal) || episodeTotal <= 0) return null;
      return {
        episodeTotal,
        seasonCounts:
          result.seasonCounts && typeof result.seasonCounts === "object"
            ? result.seasonCounts
            : {},
      };
    } catch (err) {
      console.warn("[tvdb-service] fetchEpisodeTotals failed:", err.message);
      return null;
    }
  }

  // ── Expose ────────────────────────────────────────────────────────────
  window.WatchlistTvdb = {
    resolveId,
    fetchSeries,
    fetchSeasons,
    fetchEpisodes,
    fetchEpisodeTotals,
  };
})();
