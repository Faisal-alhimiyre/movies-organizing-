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

  /**
   * Union season numbers from episodeTotals + seasons list.
   * episodeTotals alone can under-report when only the first API page was counted.
   */
  async function collectOfficialSeasonNumbers(tvdbId, locale = "en") {
    const nums = new Set();

    try {
      const totals = await fetchEpisodeTotals(tvdbId, locale);
      if (totals?.seasonCounts) {
        for (const k of Object.keys(totals.seasonCounts)) {
          const n = parseInt(k, 10);
          if (Number.isFinite(n) && n > 0) nums.add(n);
        }
      }
    } catch (_) {}

    try {
      const seasons = await fetchSeasons(tvdbId, locale);
      for (const s of seasons || []) {
        if (!s.isSpecials && Number(s.seasonNumber) > 0) {
          nums.add(Number(s.seasonNumber));
        }
      }
    } catch (_) {}

    return [...nums].sort((a, b) => a - b);
  }

  function dedupeSortTvdbEpisodes(raw, order = "official") {
    const seen = new Set();
    return (raw || [])
      .filter((ep) => {
        const key = ep.progressKey || `${ep.seasonNumber}:${ep.episodeNumber}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        if (order === "absolute") {
          return a.episodeNumber - b.episodeNumber;
        }
        if (a.seasonNumber !== b.seasonNumber) {
          return a.seasonNumber - b.seasonNumber;
        }
        return a.episodeNumber - b.episodeNumber;
      });
  }

  /**
   * All episodes in one list. Anime long-runners use absolute order (1..N block).
   */
  async function fetchAllEpisodes(tvdbId, locale = "en", options = {}) {
    if (!tvdbId) return null;

    const order = options.order || "absolute";
    const minWanted = Number(options.expectedMin) || 0;

    const normalize = (raw) =>
      (raw || []).map((e) => ({
        ...e,
        still: typeof e.still === "string" ? e.still : "",
      }));

    const isEnough = (count) =>
      count > 0 && (!minWanted || count >= Math.ceil(minWanted * 0.85));

    let flat = null;

    try {
      const result = await callFunction({ action: "allEpisodes", tvdbId, locale, order });
      if (result?.episodes?.length) {
        flat = dedupeSortTvdbEpisodes(normalize(result.episodes), order);
        if (isEnough(flat.length)) return flat;
      }
    } catch (err) {
      const msg = String(err?.message || err);
      if (!msg.includes("unsupported_action")) {
        console.warn("[tvdb-service] fetchAllEpisodes failed:", msg);
      }
    }

    try {
      const result = await callFunction({
        action: "episodes",
        tvdbId,
        locale,
        all: true,
        order,
      });
      if (result?.episodes?.length) {
        const next = dedupeSortTvdbEpisodes(normalize(result.episodes), order);
        if (!flat || next.length > flat.length) flat = next;
        if (isEnough(flat.length)) return flat;
      }
    } catch (_) {}

    return flat?.length ? flat : null;
  }

  // ── Expose ────────────────────────────────────────────────────────────
  window.WatchlistTvdb = {
    resolveId,
    fetchSeries,
    fetchSeasons,
    fetchEpisodes,
    fetchEpisodeTotals,
    fetchAllEpisodes,
    collectOfficialSeasonNumbers,
  };
})();
